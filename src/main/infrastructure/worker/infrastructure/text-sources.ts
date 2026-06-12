/**
 * infrastructure/text-sources.ts
 *
 * External text collection for the discovery pipeline (HN, Google News RSS).
 */

export async function collectDiscoveryTexts(limit = 60): Promise<string[]> {
  const texts: string[] = [];

  const hnQueries = [
    'freelancer pain problem',
    'professional software problem',
    'pequeña empresa problema gestión',
    'autónomo problema hacienda',
  ];

  const newsQueries = [
    'autónomos problema España',
    'profesionales freelance queja',
    'pyme gestión problema',
  ];

  for (const query of hnQueries) {
    if (texts.length >= limit) break;
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story,ask_hn&hitsPerPage=12`;
      const res = await fetch(url, { headers: { 'User-Agent': 'market-intel/0.1' } });
      if (!res.ok) continue;
      const data = await res.json() as { hits?: Array<{ title?: string; story_text?: string }> };
      for (const hit of data.hits ?? []) {
        const title = (hit.title ?? '').trim();
        const body  = (hit.story_text ?? '').slice(0, 200).trim();
        if (title) texts.push(body ? `${title} — ${body}` : title);
      }
    } catch (e) {
      console.error(`HN broad '${query}':`, e instanceof Error ? e.message : String(e));
    }
  }

  for (const query of newsQueries) {
    if (texts.length >= limit) break;
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=ES&ceid=ES:es`;
      const res = await fetch(url, { headers: { 'User-Agent': 'market-intel/0.1' } });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = [...text.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g)];
      for (const m of matches.slice(1, 11)) {
        const title = ((m[1] ?? m[2] ?? '') as string).trim();
        if (title) texts.push(title);
      }
    } catch (e) {
      console.error(`News RSS '${query}':`, e instanceof Error ? e.message : String(e));
    }
  }

  return texts.slice(0, limit);
}
