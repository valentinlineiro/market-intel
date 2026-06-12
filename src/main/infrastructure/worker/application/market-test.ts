import type { ISignalRepo, ILLMProvider, IMarketTestRepo } from './ports.js';
import type { Signal, GnewsSegmentConfig, MarketTestResult, FrictionProfile } from '../domain/types.js';
import { extractJsonObject } from '../domain/llm-json.js';
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

  async updateFriction(id: string, strength: number, profile: FrictionProfile): Promise<void> {
    const s = this.signals.find(sig => sig.id === id);
    if (s) {
      s.signal_strength = strength;
      s.friction_analysis = JSON.stringify(profile);
    }
  }

  async getSignalsInRange(from: string, to: string): Promise<Signal[]> {
    return this.signals.filter(s => s.collected_at >= from && s.collected_at < to);
  }

  async getUnanalyzed(limit = 200): Promise<Signal[]> {
    return this.signals.filter(s => s.friction_analysis == null).slice(0, limit);
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
  const raw = await llm.complete(prompt, 400);
  const obj = extractJsonObject(raw);
  if (!obj) throw new Error(`LLM returned no JSON object: ${raw.slice(0, 80)}`);
  return obj as unknown as GnewsSegmentConfig;
}

export async function runMarketTest(
  id: string,
  description: string,
  llm: ILLMProvider,
  repo: IMarketTestRepo,
  collectSignals: (config: GnewsSegmentConfig) => Promise<Signal[]>,
): Promise<void> {
  const now = () => new Date().toISOString();

  const claimed = await repo.claimMarketTest(id, now());
  if (!claimed) return;

  try {
    const config = await generateSegmentConfig(description, llm);
    await repo.updateMarketTestConfig(id, config, now());

    const signalRepo = new InMemorySignalRepo();
    const { stats } = await runCollect(signalRepo, [
      { id: 'gnews', collect: () => collectSignals(config) },
    ]);

    // Check if any collector failed
    const failedStat = stats.find(s => s.error);
    if (failedStat) throw new Error(failedStat.error);

    const signals = signalRepo.getSignals();
    const [dolor, painSummary] = dolorScore(signals);
    const breakdown = {
      dolor,
      capacidad_pago: incomeTierScore(config.income_tier),
      volumen:        volumeScore(signals.length),
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
    try {
      await repo.failMarketTest(id, message, now());
    } catch (persistErr) {
      console.error('market-test: failed to persist failure for', id, persistErr);
    }
  }
}
