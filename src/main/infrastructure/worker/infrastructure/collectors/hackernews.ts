import type { Signal } from '../../domain/types.js';

const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

interface HNHit {
  objectID: string;
  title:    string;
  story_text: string | null;
  url:      string | null;
  created_at: string;
  points:   number;
  num_comments: number;
}

export async function collectHackerNews(
  keywords: string[],
  segment: string,
  maxResults: number,
): Promise<Signal[]> {
  const query = keywords.slice(0, 3).join(' ');
  const url   = `https://hn.algolia.com/api/v1/search?tags=story,ask_hn&query=${encodeURIComponent(query)}&hitsPerPage=${maxResults}`;

  let hits: HNHit[] = [];
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const body = await res.json() as { hits: HNHit[] };
    hits = body.hits ?? [];
  } catch {
    return [];
  }

  return hits
    .filter(h => h.title || h.story_text)
    .map(h => {
      const text = `${h.title ?? ''}. ${h.story_text ?? ''}`.slice(0, 2000);
      const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
      const strength = Math.min(
        (matched.length / 5) * 0.5 +
        Math.min(Math.log2((h.points ?? 0) + 2) / 8, 0.25) +
        Math.min(Math.log2((h.num_comments ?? 0) + 2) / 8, 0.25),
        1.0,
      );
      return {
        id:              crypto.randomUUID(),
        source:          'github' as const,
        collected_at:    new Date().toISOString(),
        segment,
        location:        null,
        raw_text:        text,
        url:             h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        pain_keywords:   matched,
        sentiment_score: matched.length > 0 ? -0.3 : 0,
        salary_mean:     null,
        income_tier:     null,
        signal_strength: Math.round(strength * 1000) / 1000,
        has_deadline:    false,
        friction_analysis: null,
      } satisfies Signal;
    });
}
