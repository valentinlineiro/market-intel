import type { Signal, FrictionProfile } from '../../domain/types.js';

const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

const COMMUNITY_FEEDS: Array<{ url: string; name: string; location: string }> = [
  { url: 'https://portaldogc.gencat.cat/utilsEADOP/PDF/RSS/rss_DOGC.xml', name: 'DOGC', location: 'ES-CT' },
  { url: 'https://www.dogv.gva.es/portal/rss.jsp',                        name: 'DOCV', location: 'ES-VC' },
  { url: 'https://www.borm.es/borm/document/rss.jsp',                     name: 'BORM', location: 'ES-MU' },
  { url: 'https://bocyl.jcyl.es/boletines/rss.do',                        name: 'BOCyL', location: 'ES-CL' },
];

function makeProfile(body: string): FrictionProfile {
  return {
    problem_type: 'regulation', intensity: 6, frequency: 'one-time',
    workaround: false, has_solution: false, regulatory_body: body,
    affected_role: null, pain_summary: `Nueva regulación — ${body}`, confidence: 0.8,
  };
}

function parseRssItems(xml: string, maxItems = 10): Array<{ title: string; link: string; desc: string }> {
  const items: Array<{ title: string; link: string; desc: string }> = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1] ?? '';
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(b) ?? /<title>(.*?)<\/title>/.exec(b) ?? [])[1] ?? '';
    const link  = (/<link>(.*?)<\/link>/.exec(b) ?? [])[1] ?? '';
    const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(b) ?? /<description>(.*?)<\/description>/.exec(b) ?? [])[1] ?? '';
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.trim() });
    if (items.length >= maxItems) break;
  }
  return items;
}

export async function collectBOCAs(keywords: string[], segment: string): Promise<Signal[]> {
  const results: Signal[] = [];
  for (const feed of COMMUNITY_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: HEADERS });
      if (!res.ok) continue;
      const xml  = await res.text();
      const items = parseRssItems(xml);
      for (const item of items) {
        const text = `${item.title}. ${item.desc}`;
        const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
        if (matched.length === 0) continue;
        results.push({
          id:              crypto.randomUUID(),
          source:          'local_news' as const,
          collected_at:    new Date().toISOString(),
          segment,
          location:        feed.location,
          raw_text:        text.slice(0, 2000),
          url:             item.link,
          pain_keywords:   matched,
          sentiment_score: -0.4,
          salary_mean:     null,
          income_tier:     null,
          signal_strength: 0.7,
          has_deadline:    true,
          friction_analysis: JSON.stringify(makeProfile(feed.name)),
        });
      }
    } catch { continue; }
  }
  return results;
}
