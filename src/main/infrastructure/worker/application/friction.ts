import type { Signal, FrictionProfile } from '../domain/types.js';
import type { ILLMProvider, ISignalRepo } from './ports.js';

const FRICTION_PROMPT = `Eres un analista de pain points de profesionales. Analiza este texto y extrae el perfil de fricción.

Fuente: {source}
Texto: {raw_text}

Devuelve SOLO un JSON válido:
{
  "problem_type": "regulation|process|software|cost|time|complexity|unknown",
  "intensity": <0-10>,
  "frequency": "daily|weekly|monthly|yearly|one-time|unknown",
  "workaround": <true|false|null>,
  "has_solution": <true|false|null>,
  "regulatory_body": "<nombre o null>",
  "affected_role": "<rol profesional o null>",
  "pain_summary": "<frase corta describiendo el problema>",
  "confidence": <0.0-1.0>
}`;

function shouldAnalyze(signal: Signal): boolean {
  if (signal.friction_analysis != null) return false;
  if (signal.source === 'github') return true;
  return (signal.signal_strength ?? 0) >= 0.35;
}

export async function analyzeFriction(
  signals: Signal[],
  llm: ILLMProvider,
  repo: ISignalRepo,
): Promise<void> {
  const eligible = signals.filter(shouldAnalyze);
  for (const signal of eligible) {
    try {
      const prompt = FRICTION_PROMPT
        .replace('{source}', signal.source)
        .replace('{raw_text}', signal.raw_text.slice(0, 1000));
      let raw = await llm.complete(prompt, 300);
      raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1) continue;
      const profile = JSON.parse(raw.slice(start, end + 1)) as FrictionProfile;
      const quality = Math.min(1, (profile.intensity / 10) * (0.6 + 0.4 * profile.confidence));
      await repo.updateFriction(signal.id, quality, profile);
    } catch {
      // original signal_strength preserved on any failure
    }
  }
}
