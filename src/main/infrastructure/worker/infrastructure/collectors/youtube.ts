import type { Signal } from '../../domain/types.js';

const NEG_WORDS = [
  'problema', 'horrible', 'imposible', 'multa', 'burocracia', 'lento', 'caro',
  'queja', 'odio', 'caos', 'frustrado', 'harto', 'fallo', 'error', 'bug',
  'urge', 'emergencia', 'peor', 'difícil', 'complicado', 'tardanza', 'retraso',
];

function sentimentScore(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => NEG_WORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKw: number, sent: number, textLen: number, likes: number): number {
  const kwScore  = Math.min(matchedKw / 3, 1.0);
  const sScore   = Math.min(Math.abs(sent), 1.0);
  const lenScore = Math.min(textLen / 300, 1.0);
  const engScore = Math.min(Math.log2(likes + 2) / 5, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.40 + sScore * 0.30 + lenScore * 0.15 + engScore * 0.15) * 1000) / 1000);
}

interface YTSearchItem {
  id: { videoId: string };
  snippet: { title: string };
}

interface YTCommentSnippet {
  textDisplay: string;
  likeCount: number;
  publishedAt: string;
}

export async function collectYouTube(
  keywords: string[],
  segment: string,
  apiKey: string,
  maxVideos = 5,
  maxCommentsPerVideo = 20,
): Promise<Signal[]> {
  if (!apiKey) return [];
  const signals: Signal[] = [];
  const seen = new Set<string>();
  const query = keywords.slice(0, 4).join(' ');

  try {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', String(maxVideos));
    searchUrl.searchParams.set('relevanceLanguage', 'es');
    searchUrl.searchParams.set('key', apiKey);

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) return [];
    const searchBody = await searchRes.json() as { items?: YTSearchItem[] };
    const videos = searchBody.items ?? [];

    for (const video of videos) {
      const videoId = video.id.videoId;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      try {
        const commentsUrl = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
        commentsUrl.searchParams.set('part', 'snippet');
        commentsUrl.searchParams.set('videoId', videoId);
        commentsUrl.searchParams.set('maxResults', String(maxCommentsPerVideo));
        commentsUrl.searchParams.set('order', 'relevance');
        commentsUrl.searchParams.set('key', apiKey);

        const commentsRes = await fetch(commentsUrl.toString());
        if (!commentsRes.ok) continue;
        const commentsBody = await commentsRes.json() as {
          items?: Array<{ snippet: { topLevelComment: { snippet: YTCommentSnippet } } }>;
        };

        for (const item of commentsBody.items ?? []) {
          const cs = item.snippet.topLevelComment.snippet;
          const text = cs.textDisplay.slice(0, 1000);
          const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
          const sent = sentimentScore(text);

          if (matched.length === 0 && sent > -0.03) continue;

          const dedupeKey = `${videoId}:${text.slice(0, 80)}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          signals.push({
            id:              crypto.randomUUID(),
            source:          'youtube',
            collected_at:    new Date(cs.publishedAt).toISOString(),
            segment,
            location:        null,
            raw_text:        text,
            url:             videoUrl,
            pain_keywords:   matched,
            sentiment_score: sent,
            salary_mean:     null,
            income_tier:     null,
            signal_strength: signalStrength(matched.length, sent, text.length, cs.likeCount),
            has_deadline:    false,
          });
        }
      } catch {
        // skip this video on error
      }
    }
  } catch {
    // return what we have
  }

  return signals;
}
