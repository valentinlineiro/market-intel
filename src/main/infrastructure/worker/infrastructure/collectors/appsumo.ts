import type { Signal } from '../../domain/types.js';

const APPSUMO_URL = 'https://appsumo.com/browse/';
const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

export async function collectAppSumo(keywords: string[], segment: string): Promise<Signal[]> {
  let html = '';
  try {
    const res = await fetch(APPSUMO_URL, { headers: HEADERS });
    if (!res.ok) return [];
    html = await res.text();
  } catch { return []; }

  let titles: string[] = [];

  const primary = [...html.matchAll(/<h2[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/h2>/gi)];
  if (primary.length > 0) {
    titles = primary.map(m => m[1]?.replace(/<[^>]+>/g, '').trim() ?? '').filter(Boolean);
  } else {
    const fallback = [...html.matchAll(/<(?:h2|h3)[^>]*>([\s\S]*?)<\/(?:h2|h3)>/gi)];
    titles = fallback.map(m => m[1]?.replace(/<[^>]+>/g, '').trim() ?? '').filter(t => t.length > 5 && t.length < 100);
  }

  titles = titles.slice(0, 20);

  return titles
    .filter(title => keywords.some(kw => title.toLowerCase().includes(kw.toLowerCase())))
    .map(title => ({
      id:              crypto.randomUUID(),
      source:          'github' as const,
      collected_at:    new Date().toISOString(),
      segment,
      location:        null,
      raw_text:        title,
      url:             APPSUMO_URL,
      pain_keywords:   ['__solution__', ...keywords.filter(kw => title.toLowerCase().includes(kw.toLowerCase()))],
      sentiment_score: 0,
      salary_mean:     null,
      income_tier:     null,
      signal_strength: 0.4,
      has_deadline:    false,
      friction_analysis: null,
    } satisfies Signal));
}
