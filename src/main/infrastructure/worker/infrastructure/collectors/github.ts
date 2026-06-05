import type { Signal } from '../../domain/types.js';

interface GitHubIssue {
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  score: number;
  comments: number;
  labels: Array<{ name: string }>;
  reactions: { total_count: number } | null;
  created_at: string;
  repository_url: string;
}

interface GitHubResponse {
  total_count: number;
  items: GitHubIssue[];
}

function sentimentScore(text: string): number {
  const neg = [
    'problema', 'bug', 'error', 'fallo', 'broken', 'crash', 'fail', 'urgent',
    'critical', 'blocker', 'impossible', 'wrong', 'incorrect', 'issue', 'pain',
    'frustrat', 'horrible', 'terrible', 'stupid', 'wtf', 'help', 'issue',
  ];
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => neg.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(
  matchedKeywords: number,
  sentScore: number,
  textLength: number,
  commentCount: number,
): number {
  const kwScore = Math.min(matchedKeywords / 5, 1.0);
  const sScore  = Math.min(Math.abs(sentScore), 1.0);
  const lenScore = Math.min(textLength / 500, 1.0);
  // Log scale: 100+ comments = near-max engagement
  const engScore = Math.min(Math.log2(commentCount + 2) / Math.log2(100), 1.0);

  return Math.min(1.0, Math.round(
    (kwScore * 0.25 + engScore * 0.40 + sScore * 0.20 + lenScore * 0.15) * 1000,
  ) / 1000);
}

export async function collectGitHub(
  keywords: string[],
  segment: string,
  token?: string,
): Promise<Signal[]> {
  const results: Signal[] = [];
  const seen = new Set<string>();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'market-intel/0.1',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Use single keywords as queries; multi-word GNews queries don't work on GitHub
  const searchTerms = [...new Set(keywords.map(k => k.trim()).filter(k => k.length > 2))];

  for (const term of searchTerms) {
    try {
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(term + ' is:issue')}&sort=comments&order=desc&per_page=5`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error(`github term "${term}": HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as GitHubResponse;
      for (const issue of (body.items ?? [])) {
        if (!issue.html_url || seen.has(issue.html_url)) continue;
        seen.add(issue.html_url);

        const fullText = `${issue.title}. ${issue.body ?? ''}`;
        const text = fullText.slice(0, 2000);
        const sent = sentimentScore(text);
        const matched = keywords.filter(kw => text.toLowerCase().includes(kw));

        if (matched.length === 0 && sent > -0.03) continue;

        const signal: Signal = {
          id: crypto.randomUUID(),
          source: 'github',
          collected_at: new Date().toISOString(),
          segment,
          location: null,
          raw_text: text,
          url: issue.html_url,
          pain_keywords: matched,
          sentiment_score: sent,
          salary_mean: null,
          income_tier: null,
          signal_strength: signalStrength(matched.length, sent, text.length, issue.comments),
          has_deadline: false,
        };
        results.push(signal);
      }
    } catch (e) {
      console.error(`github term "${term}":`, e instanceof Error ? e.message : String(e));
    }
  }

  return results;
}
