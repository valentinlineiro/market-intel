import type { Signal } from '../../domain/types.js';

const HEADERS = (apiKey: string): HeadersInit => ({
  'User-Agent':    'Mozilla/5.0 (compatible; market-intel/0.1)',
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type':  'application/json',
});

const QUERY = `
  query($first: Int!, $after: String) {
    posts(first: $first, after: $after, order: VOTES) {
      edges { node { id name tagline url votesCount commentsCount topics { edges { node { name } } } } }
    }
  }
`;

export async function collectProductHunt(
  keywords: string[],
  segment: string,
  apiKey: string,
): Promise<Signal[]> {
  if (!apiKey) return [];

  let nodes: Array<{ id: string; name: string; tagline: string; url: string; votesCount?: number }> = [];
  try {
    const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method:  'POST',
      headers: HEADERS(apiKey),
      body:    JSON.stringify({ query: QUERY, variables: { first: 30 } }),
    });
    if (!res.ok) return [];
    const body = await res.json() as { data?: { posts?: { edges: Array<{ node: typeof nodes[0] }> } } };
    nodes = (body.data?.posts?.edges ?? []).map(e => e.node);
  } catch { return []; }

  return nodes
    .filter(n => keywords.some(kw => (n.name + n.tagline).toLowerCase().includes(kw.toLowerCase())))
    .map(n => ({
      id:              crypto.randomUUID(),
      source:          'github' as const,
      collected_at:    new Date().toISOString(),
      segment,
      location:        null,
      raw_text:        `${n.name}. ${n.tagline}`.slice(0, 2000),
      url:             n.url,
      pain_keywords:   ['__solution__', ...keywords.filter(kw => (n.name + n.tagline).toLowerCase().includes(kw.toLowerCase()))],
      sentiment_score: 0,
      salary_mean:     null,
      income_tier:     null,
      signal_strength: Math.min(Math.log2((n.votesCount ?? 0) + 2) / 12, 0.8),
      has_deadline:    false,
      friction_analysis: null,
    } satisfies Signal));
}
