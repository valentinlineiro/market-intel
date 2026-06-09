import type { ILLMProvider, INotifier } from './ports.js';
import type { DiscoveryCandidate, Config } from '../domain/types.js';

const CLUSTER_PROMPT = `Analiza estos textos de noticias y foros profesionales.
Identifica perfiles profesionales con dolores recurrentes NO incluidos en: {known}.

TEXTOS:
{posts}

Para cada perfil nuevo devuelve JSON:
{"profile":"...","pain":"...","keywords":["..."],"post_count":N,"income_estimate":"high|medium_high|medium|low","has_deadline":true|false}

Devuelve SOLO un array JSON válido. Si no hay perfiles nuevos devuelve [].`;

interface RawCluster {
  profile: string;
  pain: string;
  keywords: string[];
  post_count: number;
  income_estimate: string | null;
  has_deadline: boolean;
}

interface MergedCluster extends RawCluster {
  batch_count: number;
}

export async function runDiscovery(
  llm: ILLMProvider,
  notifier: INotifier,
  cfg: Config['discover'],
  texts: string[],
  knownSegments: string[] = [],
): Promise<DiscoveryCandidate[]> {
  if (!texts.length) return [];

  const allClusters: RawCluster[] = [];
  const batchSize = 15;
  const toProcess = texts.slice(0, 60);

  for (let i = 0; i < toProcess.length; i += batchSize) {
    const batch = toProcess.slice(i, i + batchSize);
    const clusters = await clusterBatch(batch, knownSegments, llm);
    allClusters.push(...clusters);
  }

  const candidates = aggregate(allClusters);

  // Send notification for top 5 if notifier is provided
  const top5 = candidates.slice(0, 5);
  if (top5.length) {
    const textLines = ['Segmentos ocultos detectados\n'];
    const htmlLines = ['<h2>Segmentos ocultos detectados</h2>'];
    for (const [i, c] of top5.entries()) {
      textLines.push(`${i + 1}. ${c.pain_summary} — Score: ${c.discovery_score}`);
      htmlLines.push(`<p><strong>${i + 1}. ${c.pain_summary}</strong><br>Score: ${c.discovery_score}</p>`);
    }
    await notifier.send(
      'Segmentos ocultos detectados',
      htmlLines.join('\n'),
      textLines.join('\n'),
    );
  }

  // Apply max_clusters limit
  return candidates.slice(0, cfg.max_clusters);
}

async function clusterBatch(
  texts: string[],
  knownSegments: string[],
  llm: ILLMProvider,
): Promise<RawCluster[]> {
  const prompt = CLUSTER_PROMPT
    .replace('{known}', knownSegments.join(', '))
    .replace('{posts}', texts.map((t, i) => `${i + 1}. ${t}`).join('\n'));

  try {
    let raw = await llm.complete(prompt, 600);
    raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as RawCluster[];
    }
    return [parsed as RawCluster];
  } catch (e) {
    console.error('cluster batch failed:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

function aggregate(clusters: RawCluster[]): DiscoveryCandidate[] {
  const merged: MergedCluster[] = [];

  for (const c of clusters) {
    if (!c.profile) continue;
    const keywords = c.keywords || [];
    const kwLower = keywords.map(k => k.toLowerCase());
    const existing = merged.find(
      m =>
        kwLower.filter(k =>
          (m.keywords || []).map(x => x.toLowerCase()).includes(k),
        ).length >= 2,
    );
    if (existing) {
      existing.post_count = (existing.post_count || 0) + Math.min(c.post_count || 1, 15);
      existing.batch_count = existing.batch_count + 1;
    } else {
      merged.push({ ...c, keywords, batch_count: 1, post_count: Math.min(c.post_count || 1, 15) });
    }
  }

  const now = new Date().toISOString();

  return merged
    .map(m => ({
      segment: m.profile,
      pain_summary: m.pain,
      discovery_score:
        Math.round((m.post_count || 1) * (1 + (m.batch_count || 1) * 0.5) * 10) / 10,
      source_urls: [],
      raw_signals: m.keywords || [],
      post_count:   m.post_count ?? 0,
      income_est:   m.income_estimate ?? null,
      has_deadline: m.has_deadline ?? false,
      discovered_at: now,
    }))
    .sort((a, b) => b.discovery_score - a.discovery_score);
}
