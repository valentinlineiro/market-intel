export type SignalSource =
  | 'gnews' | 'local_news' | 'reddit' | 'github' | 'stackoverflow'
  | 'youtube' | 'bluesky' | 'mastodon';

export interface CollectorStat {
  id:     string;
  count:  number;
  error?: string;
}

export type OpportunityStatus = 'watching' | 'testing' | 'scaling' | 'killed';

export interface ScoreBreakdown {
  dolor: number;
  capacidad_pago: number;
  volumen: number;
  competencia: number;
  urgencia: number;
}

export interface Signal {
  id: string;
  source: SignalSource;
  collected_at: string;
  segment: string;
  location: string | null;
  raw_text: string;
  url: string;
  pain_keywords: string[];
  sentiment_score: number | null;
  salary_mean: number | null;
  income_tier: string | null;
  signal_strength: number | null;
  has_deadline: boolean;
  friction_analysis?: string | null;   // JSON FrictionProfile; null = not yet analyzed
}

export interface Opportunity {
  id: string;
  segment: string;
  pain_summary: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  signal_ids: string[];
  signal_count: number;
  first_seen: string;
  last_updated: string;
  status: OpportunityStatus;
  landing_url: string | null;
  emails_captured: number;
  validation_deadline: string | null;
  telegram_alerted_at: string | null;
}

export interface Lead {
  id: string;
  email: string;
  segment: string;
  created_at: string;
  price_tier: string | null;
}

export interface DiscoveryCandidate {
  segment: string;
  label: string;
  pain_summary: string;
  discovery_score: number;
  source_urls: string[];
  raw_signals: string[];
  discovered_at: string;
  post_count?: number;
  income_est?: string | null;
  has_deadline?: boolean;
}

export interface SegmentConfig {
  key: string;
  label: string;
  keywords: string[];
  income_tier: string;
  has_deadline: boolean;
  discovery_score: number;
}

export interface GnewsSegmentConfig {
  label: string;
  queries: string[];
  keywords: string[];
  salary_mean: number;
  income_tier: string;
  has_deadline: boolean;
}

export interface Config {
  score: {
    top_n: number;
    min_score: number;
    dry_run: boolean;
  };
  llm: {
    provider: string;
    model: string;
    temperature: number;
    max_tokens: number;
  };
  discover: {
    max_clusters: number;
    min_signals: number;
  };
  notifications: {
    from_email: string;
    to_email: string;
    alert_score_threshold: number;
  };
  collectors: {
    gnews: {
      enabled: boolean;
      max_results: number;
      segments: Record<string, GnewsSegmentConfig>;
    };
    local_news: {
      enabled: boolean;
      feeds: Array<{ url: string; location: string }>;
      pain_keywords: string[];
    };
    reddit: {
      enabled: boolean;
      subreddits: string[];
    };
    youtube: {
      enabled: boolean;
      max_videos: number;
      max_comments_per_video: number;
    };
    bluesky: {
      enabled: boolean;
      max_results: number;
    };
    mastodon: {
      enabled: boolean;
      instances: string[];
      max_results: number;
    };
  };
  synthesis_segments: Record<string, SegmentConfig>;
}

export interface MarketTestResult {
  score: number;
  breakdown: ScoreBreakdown;
  pain_summary: string;
  signal_count: number;
  signals: Signal[];
}

export interface MarketTest {
  id: string;
  description: string;
  generated_config: GnewsSegmentConfig | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  result: MarketTestResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type ProblemType =
  | 'regulation' | 'process' | 'software'
  | 'cost' | 'time' | 'complexity' | 'unknown';

export type PainFrequency =
  | 'daily' | 'weekly' | 'monthly'
  | 'yearly' | 'one-time' | 'unknown';

export interface FrictionProfile {
  problem_type: ProblemType;
  intensity: number;           // 0–10
  frequency: PainFrequency;
  workaround: boolean | null;
  has_solution: boolean | null;
  regulatory_body: string | null;
  affected_role: string | null;
  pain_summary: string;
  confidence: number;          // 0–1
}
