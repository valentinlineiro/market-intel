import type { Signal, FrictionProfile } from '../../domain/types.js';

const BOJA_RSS = 'https://www.juntadeandalucia.es/boja/boja.rss';
const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

const REGULATION_PROFILE: FrictionProfile = {
  problem_type: 'regulation', intensity: 6, frequency: 'one-time',
  workaround: false, has_solution: false, regulatory_body: 'BOJA',
  affected_role: null, pain_summary: 'Nueva regulación publicada en el BOJA', confidence: 0.85,
};

function parseRssItems(xml: string): Array<{ title: string; link: string; description: string }> {
  const items: Array<{ title: string; link: string; description: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1] ?? '';
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) ?? /<title>(.*?)<\/title>/.exec(block) ?? [])[1] ?? '';
    const link  = (/<link>(.*?)<\/link>/.exec(block) ?? [])[1] ?? '';
    const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) ?? /<description>(.*?)<\/description>/.exec(block) ?? [])[1] ?? '';
    if (title) items.push({ title: title.trim(), link: link.trim(), description: desc.trim() });
  }
  return items.slice(0, 15);
}

export async function collectBOJA(keywords: string[], segment: string): Promise<Signal[]> {
  let xml = '';
  try {
    const res = await fetch(BOJA_RSS, { headers: HEADERS });
    if (!res.ok) return [];
    xml = await res.text();
  } catch { return []; }

  return parseRssItems(xml)
    .filter(item => keywords.some(kw => (item.title + item.description).toLowerCase().includes(kw.toLowerCase())))
    .map(item => ({
      id:               crypto.randomUUID(),
      source:           'local_news' as const,
      collected_at:     new Date().toISOString(),
      segment,
      location:         'ES-AN',
      raw_text:         `${item.title}. ${item.description}`.slice(0, 2000),
      url:              item.link,
      pain_keywords:    keywords.filter(kw => (item.title + item.description).toLowerCase().includes(kw.toLowerCase())),
      sentiment_score:  -0.5,
      salary_mean:      null,
      income_tier:      null,
      signal_strength:  0.75,
      has_deadline:     true,
      friction_analysis: JSON.stringify(REGULATION_PROFILE),
    } satisfies Signal));
}
