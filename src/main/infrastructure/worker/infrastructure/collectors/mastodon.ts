import type { Signal } from '../../domain/types.js';

const NEG_WORDS = [
  'problema', 'horrible', 'imposible', 'multa', 'burocracia', 'lento', 'caro',
  'queja', 'odio', 'caos', 'frustrado', 'harto', 'fallo', 'error',
  'urge', 'emergencia', 'peor', 'difícil', 'complicado',
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sentimentScore(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => NEG_WORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKw: number, sent: number, reblogs: number, favs: number, replies: number): number {
  const kwScore  = Math.min(matchedKw / 3, 1.0);
  const sScore   = Math.min(Math.abs(sent), 1.0);
  const engScore = Math.min((Math.log2(reblogs + 2) + Math.log2(favs + 2) + Math.log2(replies + 2)) / 9, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sScore * 0.35 + engScore * 0.20) * 1000) / 1000);
}

interface MastodonStatus {
  id: string;
  url: string;
  content: string;
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  account: { acct: string };
  created_at: string;
}

export async function collectMastodon(
  keywords: string[],
  segment: string,
  instances: string[],
  maxResults = 20,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const seen = new Set<string>();

  for (const instance of instances) {
    for (const keyword of keywords) {
      try {
        const url = new URL(`https://${instance}/api/v2/search`);
        url.searchParams.set('q', keyword);
        url.searchParams.set('type', 'statuses');
        url.searchParams.set('limit', String(maxResults));

        const res = await fetch(url.toString(), {
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) continue;

        const body = await res.json() as { statuses?: MastodonStatus[] };
        for (const status of body.statuses ?? []) {
          if (seen.has(status.url)) continue;
          seen.add(status.url);

          const text = stripHtml(status.content).slice(0, 1000);
          const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
          const sent = sentimentScore(text);

          if (matched.length === 0 && sent > -0.03) continue;

          signals.push({
            id:              crypto.randomUUID(),
            source:          'mastodon',
            collected_at:    status.created_at,
            segment,
            location:        null,
            raw_text:        text,
            url:             status.url,
            pain_keywords:   matched,
            sentiment_score: sent,
            salary_mean:     null,
            income_tier:     null,
            signal_strength: signalStrength(matched.length, sent, status.reblogs_count, status.favourites_count, status.replies_count),
            has_deadline:    false,
          });
        }
      } catch {
        // skip this instance/keyword pair on error
      }
    }
  }

  return signals;
}
