import type { ISignalRepo, ILLMProvider, IMarketTestRepo } from './ports.js';
import type { Signal, GnewsSegmentConfig, MarketTestResult } from '../domain/types.js';
import { collectGnews } from '../infrastructure/collectors/gnews.js';
import { runCollect } from './collect.js';
import {
  dolorScore,
  incomeTierScore,
  volumeScore,
  urgencyScore,
  computeOpportunityScore,
} from '../domain/scoring.js';
import { DEFAULT_COMPETENCIA_SCORE } from '../domain/rules.js';

const CONFIG_PROMPT = `Eres un analista de mercado. A partir de esta descripción, genera una configuración de búsqueda para encontrar señales de dolor en Google News.

Descripción: {description}

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "label": "nombre del segmento profesional",
  "queries": ["3 a 5 queries de búsqueda en español para Google News"],
  "keywords": ["5 a 10 palabras clave de dolor o dominio"],
  "salary_mean": <salario anual medio en EUR, número entero>,
  "income_tier": "high|medium_high|medium|low",
  "has_deadline": <true si existe un deadline regulatorio externo, false si no>
}`;

export class InMemorySignalRepo implements ISignalRepo {
  private readonly signals: Signal[] = [];

  async save(signal: Signal): Promise<boolean> {
    this.signals.push(signal);
    return true;
  }

  async get(_segment: string, limit: number): Promise<Signal[]> {
    return this.signals.slice(-limit);
  }

  async getAll(limit: number): Promise<Signal[]> {
    return this.signals.slice(-limit);
  }

  async count(_segment?: string): Promise<number> {
    return this.signals.length;
  }

  getSignals(): Signal[] {
    return [...this.signals];
  }
}

async function generateSegmentConfig(
  description: string,
  llm: ILLMProvider,
): Promise<GnewsSegmentConfig> {
  const prompt = CONFIG_PROMPT.replace('{description}', description);
  let raw = await llm.complete(prompt, 400);
  raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(raw) as GnewsSegmentConfig;
}

export async function runMarketTest(
  id: string,
  description: string,
  llm: ILLMProvider,
  repo: IMarketTestRepo,
): Promise<void> {
  const now = () => new Date().toISOString();

  const claimed = await repo.claimMarketTest(id, now());
  if (!claimed) return;

  try {
    const config = await generateSegmentConfig(description, llm);
    await repo.updateMarketTestConfig(id, config, now());

    const signalRepo = new InMemorySignalRepo();
    await runCollect(signalRepo, [() => collectGnews({ 'market-test': config }, '')]);

    const signals = signalRepo.getSignals();
    const [dolor, painSummary] = dolorScore(signals);
    const breakdown = {
      dolor,
      capacidad_pago: incomeTierScore(config.income_tier),
      volumen:        volumeScore(5.0),
      competencia:    DEFAULT_COMPETENCIA_SCORE,
      urgencia:       urgencyScore(config.has_deadline),
    };
    const score = computeOpportunityScore(breakdown);

    const result: MarketTestResult = {
      score,
      breakdown,
      pain_summary: painSummary,
      signal_count: signals.length,
      signals,
    };

    await repo.completeMarketTest(id, result, now());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await repo.failMarketTest(id, message, now());
  }
}
