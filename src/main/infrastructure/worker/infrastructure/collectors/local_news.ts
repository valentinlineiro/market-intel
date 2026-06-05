import type { Signal, Config } from '../../domain/types.js';

const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface FeedItem {
  title: string;
  link: string;
  desc: string;
}

function sentimentScore(text: string, painKeywords: string[]): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter((w) => painKeywords.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKeywords: number, sentScore: number, textLength: number): number {
  const kwScore  = Math.min(matchedKeywords / 5, 1.0);
  const sScore   = Math.min(Math.abs(sentScore), 1.0);
  const lenScore = Math.min(textLength / 500, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.50 + sScore * 0.35 + lenScore * 0.15) * 1000) / 1000);
}

async function fetchFeed(url: string): Promise<FeedItem[]> {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return [];
  const xml = await r.text();

  const items: FeedItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1] ?? '';
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) ?? /<title>(.*?)<\/title>/.exec(block) ?? [])[1] ?? '';
    const link  = (/<link>(.*?)<\/link>/.exec(block) ?? [])[1] ?? '';
    const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) ?? /<description>(.*?)<\/description>/.exec(block) ?? [])[1] ?? '';
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.trim() });
  }
  return items.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function collectLocalNews(
  cfg: Config['collectors']['local_news'],
): Promise<Signal[]> {
  const { feeds, pain_keywords: painKeywords } = cfg;

  if (!feeds || feeds.length === 0) {
    console.warn('collectLocalNews: no feeds configured — skipping');
    return [];
  }

  const results: Signal[] = [];

  for (const feed of feeds) {
    try {
      const items = await fetchFeed(feed.url);
      for (const item of items) {
        const text    = `${item.title}. ${item.desc}`;
        const sent    = sentimentScore(text, painKeywords);
        const matched = painKeywords.filter((kw) => text.toLowerCase().includes(kw));

        if (matched.length === 0 && sent > -0.03) continue;

        const signal: Signal = {
          id:              crypto.randomUUID(),
          source:          'local_news',
          collected_at:    new Date().toISOString(),
          segment:         'general',
          location:        feed.location,
          raw_text:        text.slice(0, 2000),
          url:             item.link || `local_news://${crypto.randomUUID()}`,
          pain_keywords:   matched,
          sentiment_score: sent,
          salary_mean:     null,
          income_tier:     null,
          signal_strength: signalStrength(matched.length, sent, text.length),
          has_deadline:    false,
        };

        results.push(signal);
      }
      // Small delay between feeds to be polite to upstream
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`collectLocalNews feed "${feed.url}": ${msg}`);
    }
  }

  return results;
}
