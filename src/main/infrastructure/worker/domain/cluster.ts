import type { Signal } from './types.js';

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const setA = new Set(a.map(k => k.toLowerCase()));
  const setB = new Set(b.map(k => k.toLowerCase()));
  let intersection = 0;
  for (const k of setA) if (setB.has(k)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function parseKeywords(s: Signal): string[] {
  try {
    const raw = s.pain_keywords;
    return Array.isArray(raw) ? raw : (JSON.parse(raw as unknown as string) as string[]);
  } catch {
    return [];
  }
}

export function clusterSignals(signals: Signal[], threshold = 0.85): Signal[][] {
  const clusters: Array<{ members: Signal[]; repKws: string[]; repSS: number }> = [];
  for (const signal of signals) {
    const sigKws = parseKeywords(signal);
    const sigSS = signal.signal_strength ?? 0;
    let placed = false;
    for (const cluster of clusters) {
      if (jaccardSimilarity(sigKws, cluster.repKws) >= threshold) {
        cluster.members.push(signal);
        // Keep repKws pointing at the highest-strength signal so later signals
        // are compared against the best representative, not the founding member.
        if (sigSS > cluster.repSS) {
          cluster.repKws = sigKws;
          cluster.repSS = sigSS;
        }
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [signal], repKws: sigKws, repSS: sigSS });
  }
  return clusters.map(c => c.members);
}
