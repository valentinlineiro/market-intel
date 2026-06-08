import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig, GnewsSegmentConfig, MarketTest, MarketTestResult, FrictionProfile, CollectorStat } from '../domain/types.js';

export interface ISignalRepo {
  save(signal: Signal): Promise<boolean>;
  get(segment: string, limit: number): Promise<Signal[]>;
  getAll(limit: number): Promise<Signal[]>;
  count(segment?: string): Promise<number>;
  updateFriction(id: string, strength: number, profile: FrictionProfile): Promise<void>;
}

export interface IOpportunityRepo {
  upsert(opp: Opportunity): Promise<void>;
  getAll(): Promise<Opportunity[]>;
  getBySegment(segment: string): Promise<Opportunity | null>;
  markAlerted(id: string, at: string): Promise<void>;
}

export interface ILeadRepo {
  saveLead(email: string, segment: string): Promise<void>;
  getLeads(segment?: string): Promise<Lead[]>;
}

export interface IDiscoveryRepo {
  saveCandidates(candidates: DiscoveryCandidate[]): Promise<void>;
  getLatestCandidates(): Promise<{ candidates: DiscoveryCandidate[]; discovered_at: string } | null>;
  getSegmentsToScore(topN: number, minScore: number): Promise<SegmentConfig[]>;
}

export interface ILLMProvider {
  complete(prompt: string, maxTokens: number): Promise<string>;
}

export interface INotifier {
  send(subject: string, html: string, text: string): Promise<boolean>;
}

export interface IMarketTestRepo {
  createMarketTest(id: string, description: string, now: string): Promise<void>;
  claimMarketTest(id: string, now: string): Promise<boolean>;
  updateMarketTestConfig(id: string, config: GnewsSegmentConfig, now: string): Promise<void>;
  completeMarketTest(id: string, result: MarketTestResult, now: string): Promise<void>;
  failMarketTest(id: string, error: string, now: string): Promise<void>;
  getMarketTest(id: string): Promise<MarketTest | null>;
}

export interface Collector {
  id: string;
  collect(): Promise<Signal[]>;
}

export interface ICollectorHealthRepo {
  upsertHealth(stat: CollectorStat, runAt: string): Promise<void>;
  getCollectorHealth(): Promise<Array<{
    collector_id:  string;
    last_run_at:   string;
    signal_count:  number;
    error:         string | null;
  }>>;
}
