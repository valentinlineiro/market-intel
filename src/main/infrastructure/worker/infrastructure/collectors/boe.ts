import type { Signal, FrictionProfile } from '../../domain/types.js';

const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

const REGULATION_PROFILE: FrictionProfile = {
  problem_type:    'regulation',
  intensity:       7,
  frequency:       'one-time',
  workaround:      false,
  has_solution:    false,
  regulatory_body: 'BOE',
  affected_role:   null,
  pain_summary:    'Nueva regulación publicada en el BOE',
  confidence:      0.9,
};

interface BOEResult {
  titulo:   string;
  url:      string;
  fecha_publicacion: string;
  texto?:   string;
}

export async function collectBOE(keywords: string[], segment: string): Promise<Signal[]> {
  const today    = new Date();
  const dateStr  = today.toISOString().slice(0, 10).replace(/-/g, '');
  const sevenAgo = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const query    = keywords.slice(0, 2).join(' ');
  const url      = `https://www.boe.es/datosabiertos/api/search?q=${encodeURIComponent(query)}&dateini=${sevenAgo}&datefin=${dateStr}`;

  let items: BOEResult[] = [];
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const body = await res.json() as { data?: { results?: BOEResult[] } };
    items = body.data?.results ?? [];
  } catch {
    return [];
  }

  return items.slice(0, 10).map(item => ({
    id:              crypto.randomUUID(),
    source:          'local_news' as const,
    collected_at:    new Date().toISOString(),
    segment,
    location:        'ES',
    raw_text:        `${item.titulo}. ${item.texto ?? ''}`.slice(0, 2000),
    url:             item.url,
    pain_keywords:   keywords.filter(kw => item.titulo.toLowerCase().includes(kw.toLowerCase())),
    sentiment_score: -0.5,
    salary_mean:     null,
    income_tier:     null,
    signal_strength: 0.8,
    has_deadline:    true,
    friction_analysis: JSON.stringify(REGULATION_PROFILE),
  } satisfies Signal));
}
