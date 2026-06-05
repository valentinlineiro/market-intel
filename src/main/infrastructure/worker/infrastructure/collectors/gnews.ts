import type { Signal, GnewsSegmentConfig } from '../../domain/types.js';

const GNEWS_BASE = 'https://news.google.com/rss/search?hl=es&gl=ES&ceid=ES:es&q=';
const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface FeedItem {
  title: string;
  link: string;
  desc: string;
}

function sentimentScore(text: string): number {
  const neg = [
    'problema', 'horrible', 'imposible', 'multa', 'burocracia', 'lento', 'caro',
    'queja', 'odio', 'caos', 'frustrado', 'harto', 'fallo',
  ];
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter((w) => neg.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKeywords: number, sentScore: number, textLength: number): number {
  // Require ≥2 keywords for a meaningful match; 1 keyword alone is weak evidence
  const kwScore  = Math.min(matchedKeywords / 5, 1.0);
  const sScore   = Math.min(Math.abs(sentScore), 1.0);
  const lenScore = Math.min(textLength / 500, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.50 + sScore * 0.35 + lenScore * 0.15) * 1000) / 1000);
}

async function fetchFeed(query: string): Promise<FeedItem[]> {
  const url = GNEWS_BASE + encodeURIComponent(query);
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

export async function collectGnews(
  segments: Record<string, GnewsSegmentConfig>,
  _apiKey: string,
): Promise<Signal[]> {
  const results: Signal[] = [];

  for (const [segment, config] of Object.entries(segments)) {
    for (const query of config.queries) {
      try {
        const items = await fetchFeed(query);
        for (const item of items) {
          const text    = `${item.title}. ${item.desc}`;
          const sent    = sentimentScore(text);
          const matched = config.keywords.filter((kw) => text.toLowerCase().includes(kw));

          if (matched.length === 0 && sent > -0.03) continue;

          const signal: Signal = {
            id:              crypto.randomUUID(),
            source:          'gnews',
            collected_at:    new Date().toISOString(),
            segment,
            location:        null,
            raw_text:        text.slice(0, 2000),
            url:             item.link || `gnews://${crypto.randomUUID()}`,
            pain_keywords:   matched,
            sentiment_score: sent,
            salary_mean:     config.salary_mean,
            income_tier:     config.income_tier,
            signal_strength: signalStrength(matched.length, sent, text.length),
            has_deadline:    config.has_deadline,
          };

          results.push(signal);
        }
        // Small delay between queries to be polite to the upstream
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`collectGnews ${segment} "${query}": ${msg}`);
      }
    }
  }

  return results;
}
