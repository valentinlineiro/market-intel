import type { Signal, FrictionProfile } from '../domain/types.js';
import type { ILLMProvider, ISignalRepo } from './ports.js';
import { clusterSignals } from '../domain/cluster.js';

const BATCH_SIZE = 6;

const BATCH_PROMPT = `Eres un analista de pain points de profesionales. Analiza cada señal y extrae su perfil de fricción.

{signals}

Devuelve SOLO un array JSON válido (sin markdown, sin explicación). Cada elemento:
{
  "index": <número de la señal>,
  "problem_type": "regulation|process|software|cost|time|complexity|unknown",
  "intensity": <0-10>,
  "frequency": "daily|weekly|monthly|yearly|one-time|unknown",
  "workaround": <true|false|null>,
  "has_solution": <true|false|null>,
  "regulatory_body": "<nombre o null>",
  "affected_role": "<rol profesional o null>",
  "pain_summary": "<frase corta describiendo el problema>",
  "confidence": <0.0-1.0>
}

Debes responder con TODAS las señales. Cada "index" debe coincidir exactamente con el listado.`;

function shouldAnalyze(signal: Signal, minStrength: number): boolean {
  if (signal.friction_analysis != null) return false;
  return (signal.signal_strength ?? 0) >= minStrength;
}

function formatBatch(signals: Signal[]): string {
  return signals.map((s, i) =>
    `[${i}] Fuente: ${s.source}\n    Texto: ${s.raw_text.slice(0, 600)}`
  ).join('\n\n');
}

function extractArray(raw: string): unknown[] | null {
  const arrStart = raw.indexOf('[');
  const arrEnd = raw.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1) {
    const parsed = JSON.parse(raw.slice(arrStart, arrEnd + 1));
    if (Array.isArray(parsed)) return parsed;
  }
  // Fallback: LLM returned a bare object instead of a single-element array.
  const objStart = raw.indexOf('{');
  const objEnd = raw.lastIndexOf('}');
  if (objStart === -1 || objEnd === -1) return null;
  const parsed = JSON.parse(raw.slice(objStart, objEnd + 1));
  return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? [parsed] : null;
}

export async function analyzeFriction(
  signals: Signal[],
  llm: ILLMProvider,
  repo: ISignalRepo,
  clusterThreshold = 0.85,
  minStrength = 0,
): Promise<void> {
  const eligible = signals.filter(s => shouldAnalyze(s, minStrength));
  if (!eligible.length) return;

  // Cluster similar signals so only one representative per cluster hits the LLM.
  const clusters = clusterSignals(eligible, clusterThreshold);
  const representatives = clusters.map(cluster =>
    cluster.reduce((best, s) => (s.signal_strength ?? 0) >= (best.signal_strength ?? 0) ? s : best)
  );

  for (let offset = 0; offset < representatives.length; offset += BATCH_SIZE) {
    const batchReps = representatives.slice(offset, offset + BATCH_SIZE);
    const batchClusters = clusters.slice(offset, offset + BATCH_SIZE);
    const prompt = BATCH_PROMPT.replace('{signals}', formatBatch(batchReps));

    try {
      let raw = await llm.complete(prompt, 250 * batchReps.length);
      raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      const entries = extractArray(raw);
      if (!entries) continue;

      for (const entry of entries) {
        try {
          const obj = entry as Record<string, unknown>;
          if (typeof obj.index !== 'number') continue;
          const members = batchClusters[obj.index];
          if (!members) continue;

          const profile: FrictionProfile = {
            problem_type: String(obj.problem_type ?? 'unknown') as FrictionProfile['problem_type'],
            intensity: Number(obj.intensity) || 0,
            frequency: String(obj.frequency ?? 'unknown') as FrictionProfile['frequency'],
            workaround: obj.workaround === null ? null : Boolean(obj.workaround),
            has_solution: obj.has_solution === null ? null : Boolean(obj.has_solution),
            regulatory_body: obj.regulatory_body == null ? null : String(obj.regulatory_body),
            affected_role: obj.affected_role == null ? null : String(obj.affected_role),
            pain_summary: String(obj.pain_summary ?? ''),
            confidence: Number(obj.confidence) || 0,
          };
          const quality = Math.min(1, (profile.intensity / 10) * (0.6 + 0.4 * profile.confidence));
          for (const member of members) {
            await repo.updateFriction(member.id, quality, profile);
          }
        } catch (e) {
          console.error('[friction] LLM parse failed for cluster:', e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error('[friction] batch LLM call failed, skipping batch:', e instanceof Error ? e.message : e);
    }
  }
}
