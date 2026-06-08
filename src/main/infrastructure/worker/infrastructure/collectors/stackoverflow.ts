import type { Signal } from '../../domain/types.js';

interface SOQuestion {
  question_id: number;
  title: string;
  body?: string;
  link: string;
  score: number;
  answer_count: number;
  view_count: number;
  creation_date: number;
  tags: string[];
}

interface SOResponse {
  items: SOQuestion[];
  has_more: boolean;
}

function signalStrength(score: number, views: number, answers: number): number {
  // Unanswered questions with views = unsolved pain with audience
  const viewScore = Math.min(views / 1000, 1.0);
  const answerPenalty = answers === 0 ? 1.0 : Math.max(0, 1 - answers * 0.3);
  const voteScore = score > 0 ? Math.min(score / 10, 1.0) : 0.3;
  return Math.min((viewScore * 0.4 + answerPenalty * 0.4 + voteScore * 0.2), 1.0);
}

export async function collectStackOverflow(
  keywords: string[],
  tags: string[],
  segment: string,
  location: string,
  maxResults = 25,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const seen = new Set<string>();

  // Fetch unanswered questions matching tags
  const tagParam = tags.slice(0, 3).join(';');
  const url = new URL('https://api.stackexchange.com/2.3/questions');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('sort', 'votes');
  url.searchParams.set('tagged', tagParam);
  url.searchParams.set('site', 'stackoverflow');
  url.searchParams.set('filter', 'withbody');
  url.searchParams.set('answers', '0'); // unanswered only — strongest pain signal
  url.searchParams.set('pagesize', String(Math.min(maxResults, 30)));

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    if (!resp.ok) return signals;
  } catch {
    return signals;
  }

  const data = await resp.json() as SOResponse;

  for (const q of data.items ?? []) {
    if (seen.has(q.link)) continue;
    seen.add(q.link);

    const text = `${q.title} ${q.body ?? ''}`.toLowerCase();
    const matchedKeywords = keywords.filter(kw => text.includes(kw.toLowerCase())).length;
    if (matchedKeywords === 0) continue; // must match at least one keyword

    const strength = signalStrength(q.score, q.view_count, q.answer_count);

    signals.push({
      id: `so-${q.question_id}`,
      source: 'stackoverflow',
      collected_at: new Date(q.creation_date * 1000).toISOString(),
      segment,
      location,
      raw_text: q.title + (q.body ? `\n${q.body.slice(0, 500)}` : ''),
      url: q.link,
      pain_keywords: keywords.filter(kw => text.includes(kw.toLowerCase())),
      sentiment_score: -0.6, // unanswered questions are inherently frustrated
      salary_mean: null,
      income_tier: null,
      signal_strength: strength,
      has_deadline: false,
    });
  }

  return signals;
}
