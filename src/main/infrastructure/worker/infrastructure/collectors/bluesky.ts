import type { Signal } from '../../domain/types.js';

const NEG_WORDS = [
  'problema', 'horrible', 'imposible', 'multa', 'burocracia', 'lento', 'caro',
  'queja', 'odio', 'caos', 'frustrado', 'harto', 'fallo', 'error',
  'urge', 'emergencia', 'peor', 'difícil', 'complicado',
];

function sentimentScore(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => NEG_WORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKw: number, sent: number, likes: number, replies: number, reposts: number): number {
  const kwScore  = Math.min(matchedKw / 3, 1.0);
  const sScore   = Math.min(Math.abs(sent), 1.0);
  const engScore = Math.min((Math.log2(likes + 2) + Math.log2(replies + 2) + Math.log2(reposts + 2)) / 9, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sScore * 0.35 + engScore * 0.20) * 1000) / 1000);
}

interface BskyPost {
  uri: string;
  author: { did: string; handle: string };
  record: { text: string; createdAt: string };
  likeCount: number;
  replyCount: number;
  repostCount: number;
}

function buildUrl(uri: string, handle: string): string {
  // at://did:plc:xxx/app.bsky.feed.post/rkey → https://bsky.app/profile/handle/post/rkey
  const rkey = uri.split('/').at(-1) ?? '';
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export async function collectBluesky(
  keywords: string[],
  segment: string,
  maxResults = 25,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    try {
      const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
      url.searchParams.set('q', keyword);
      url.searchParams.set('limit', String(maxResults));
      url.searchParams.set('lang', 'es');

      const res = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) continue;

      const body = await res.json() as { posts?: BskyPost[] };
      for (const post of body.posts ?? []) {
        if (seen.has(post.uri)) continue;
        seen.add(post.uri);

        const text = post.record.text.slice(0, 1000);
        const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
        const sent = sentimentScore(text);

        if (matched.length === 0 && sent > -0.03) continue;

        signals.push({
          id:              crypto.randomUUID(),
          source:          'bluesky',
          collected_at:    post.record.createdAt,
          segment,
          location:        null,
          raw_text:        text,
          url:             buildUrl(post.uri, post.author.handle),
          pain_keywords:   matched,
          sentiment_score: sent,
          salary_mean:     null,
          income_tier:     null,
          signal_strength: signalStrength(matched.length, sent, post.likeCount, post.replyCount, post.repostCount),
          has_deadline:    false,
        });
      }
    } catch {
      // skip this keyword on error
    }
  }

  return signals;
}
