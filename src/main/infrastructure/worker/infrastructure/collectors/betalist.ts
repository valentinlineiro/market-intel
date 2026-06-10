import type { Signal } from '../../domain/types.js';

const BETALIST_RSS = 'https://betalist.com/feed';
const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

function parseRssItems(xml: string): Array<{ title: string; link: string; desc: string }> {
  const items: Array<{ title: string; link: string; desc: string }> = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1] ?? '';
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(b) ?? /<title>(.*?)<\/title>/.exec(b) ?? [])[1] ?? '';
    const link  = (/<link>(.*?)<\/link>/.exec(b) ?? [])[1] ?? '';
    const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(b) ?? /<description>(.*?)<\/description>/.exec(b) ?? [])[1] ?? '';
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.trim() });
    if (items.length >= 20) break;
  }
  return items;
}

export async function collectBetaList(keywords: string[], segment: string): Promise<Signal[]> {
  let xml = '';
  try {
    const res = await fetch(BETALIST_RSS, { headers: HEADERS });
    if (!res.ok) return [];
    xml = await res.text();
  } catch { return []; }

  return parseRssItems(xml)
    .filter(item => keywords.some(kw => (item.title + item.desc).toLowerCase().includes(kw.toLowerCase())))
    .map(item => ({
      id:              crypto.randomUUID(),
      source:          'github' as const,
      collected_at:    new Date().toISOString(),
      segment,
      location:        null,
      raw_text:        `${item.title}. ${item.desc}`.slice(0, 2000),
      url:             item.link,
      pain_keywords:   ['__solution__', ...keywords.filter(kw => (item.title + item.desc).toLowerCase().includes(kw.toLowerCase()))],
      sentiment_score: 0,
      salary_mean:     null,
      income_tier:     null,
      signal_strength: 0.4,
      has_deadline:    false,
      friction_analysis: null,
    } satisfies Signal));
}
