import type { Signal } from '../../domain/types.js';

interface RedditPost {
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  permalink: string;
  created_utc: number;
  over_18: boolean;
}

interface RedditResponse {
  data: {
    children: Array<{ data: RedditPost }>;
  };
}

function sentimentScore(text: string): number {
  const neg = [
    'problema', 'horrible', 'imposible', 'multa', 'burocracia', 'lento', 'caro',
    'queja', 'odio', 'caos', 'frustrado', 'harto', 'fallo', 'ayuda', 'duda',
    'urge', 'emergencia', 'estafado', 'peor', 'puto', 'mierda',
  ];
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => neg.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(
  matchedKeywords: number,
  sentScore: number,
  textLength: number,
  upvotes: number,
  comments: number,
): number {
  // Engagement bonus: upvotes and comments indicate real pain
  const kwScore  = Math.min(matchedKeywords / 5, 1.0);
  const sScore   = Math.min(Math.abs(sentScore), 1.0);
  const lenScore = Math.min(textLength / 500, 1.0);
  const engScore = Math.min((Math.log2(upvotes + 2) + Math.log2(comments + 2)) / 8, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.35 + sScore * 0.30 + lenScore * 0.10 + engScore * 0.25) * 1000) / 1000);
}

export async function collectReddit(
  subreddits: string[],
  keywords: string[],
  segment: string,
): Promise<Signal[]> {
  const results: Signal[] = [];

  for (const sub of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}.json?limit=25`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' },
      });
      if (!res.ok) {
        console.error(`reddit /r/${sub}: HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as RedditResponse;
      const posts = body.data?.children?.map(c => c.data) ?? [];

      for (const post of posts) {
        const fullText = `${post.title}. ${post.selftext ?? ''}`;
        const text    = fullText.slice(0, 2000);
        const sent    = sentimentScore(text);
        const matched = keywords.filter(kw => text.toLowerCase().includes(kw));

        if (matched.length === 0 && sent > -0.03) continue;

        const signal: Signal = {
          id:              crypto.randomUUID(),
          source:          'reddit',
          collected_at:    new Date().toISOString(),
          segment,
          location:        null,
          raw_text:        text,
          url:             `https://reddit.com${post.permalink}`,
          pain_keywords:   matched,
          sentiment_score: sent,
          salary_mean:     null,
          income_tier:     null,
          signal_strength: signalStrength(matched.length, sent, text.length, post.score, post.num_comments),
          has_deadline:    false,
        };

        results.push(signal);
      }
    } catch (e) {
      console.error(`reddit /r/${sub}:`, e instanceof Error ? e.message : String(e));
    }
  }

  return results;
}
