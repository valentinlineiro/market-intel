export type SignalSource = 'gnews' | 'local_news';
export type OpportunityStatus = 'watching' | 'testing' | 'scaling' | 'killed';

export interface ScoreBreakdown {
  dolor: number;
  capacidad_pago: number;
  volumen: number;
  competencia: number;
  urgencia: number;
}

export interface Opportunity {
  id: string;
  segment: string;
  pain_summary: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  signal_count: number;
  status: OpportunityStatus;
  landing_url: string | null;
  emails_captured: number;
  last_updated: string;
}

export interface DiscoveryCandidate {
  profile: string;
  pain: string;
  keywords: string[];
  post_count: number;
  discovery_score: number;
  income_est: string | null;
  has_deadline: boolean;
}

export interface Lead {
  email: string;
  segment: string;
  captured_at: string;
  price_tier: string | null;
  lead_score: number;
}

export interface Stats {
  total_signals: number;
  total_opportunities: number;
  analyzed_count: number;
  by_segment: Record<string, number>;
  top_opportunity: { score: number; pain_summary: string } | null;
}

export interface DiscoveryResult {
  run_id: string | null;
  candidates: DiscoveryCandidate[];
  discovered_at: string | null;
}

export interface Config {
  segments: Record<string, unknown>;
  score: Record<string, unknown>;
  llm: Record<string, unknown>;
  discover: Record<string, unknown>;
  notifications: Record<string, unknown>;
  collectors?: Record<string, unknown>;
  synthesis_segments?: Record<string, unknown>;
}

export interface LandingCopy {
  headline: string;
  subheadline: string;
  pain_points: string[];
  cta: string;
}

export interface GapEntry {
  segment:        string;
  label:          string;
  avg_pain:       number;
  whitespace:     number;
  gap_score:      number;
  has_landing:    boolean;
  opportunity_id: string | null;
}

export interface SignalRow {
  id: string;
  segment: string;
  source: string;
  raw_text: string;
  collected_at: string;
  signal_strength: number | null;
}

export interface PainProfile {
  segment: string;
  problem_type: string;
  intensity: number;
  pain_summary: string;
  confidence: number;
  count: number;
}
