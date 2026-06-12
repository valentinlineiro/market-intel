import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig,
  GnewsSegmentConfig, MarketTest, MarketTestResult, FrictionProfile,
  CollectorStat, SignalSnapshot, CronRun, CronStep, CronStepName, CronStepStatus } from '../domain/types.js';

export interface ISignalRepo {
  save(signal: Signal): Promise<boolean>;
  get(segment: string, limit: number): Promise<Signal[]>;
  getAll(limit: number): Promise<Signal[]>;
  count(segment?: string): Promise<number>;
  updateFriction(id: string, strength: number, profile: FrictionProfile): Promise<void>;
  getSignalsInRange(from: string, to: string): Promise<Signal[]>;
  getUnanalyzed(limit?: number): Promise<Signal[]>;
}

export interface IOpportunityRepo {
  upsert(opp: Opportunity): Promise<void>;
  getAll(): Promise<Opportunity[]>;
  getBySegment(segment: string): Promise<Opportunity | null>;
  markAlerted(id: string, at: string): Promise<void>;
  updateGapScore(segment: string, score: number): Promise<void>;
}

export interface ILeadRepo {
  saveLead(email: string, segment: string): Promise<void>;
  savePriceTier(email: string, segment: string, priceTier: string): Promise<void>;
  getLeads(segment?: string): Promise<Lead[]>;
}

export interface IDiscoveryRepo {
  saveCandidates(candidates: DiscoveryCandidate[], runId?: string): Promise<void>;
  getLatestCandidates(): Promise<{ candidates: DiscoveryCandidate[]; discovered_at: string } | null>;
  hasCandidates(): Promise<boolean>;
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

export interface ISignalSnapshotRepo {
  upsertSnapshot(snapshot: SignalSnapshot): Promise<void>;
  getSnapshots(segment: string, weeksBack: number): Promise<SignalSnapshot[]>;
  getLatestSnapshotAllSegments(): Promise<SignalSnapshot[]>;
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

export interface ICronLogRepo {
  insertCronRun(run: CronRun): Promise<void>;
  finishCronRun(id: string, fields: { fresh_signals: number; analyzed_signals: number; opps_updated: number; error?: string }): Promise<void>;
  getRecentCronRuns(limit?: number): Promise<CronRun[]>;
  upsertCronStep(
    runId: string,
    step: CronStepName,
    status: CronStepStatus,
    startedAt: string,
    finishedAt?: string | null,
    detail?: Record<string, unknown>,
  ): Promise<void>;
  getCronSteps(runId: string): Promise<CronStep[]>;
}

export interface ICronRepos {
  signals:         ISignalRepo;
  opportunities:   IOpportunityRepo;
  discovery:       IDiscoveryRepo;
  collectorHealth: ICollectorHealthRepo;
  cronLog:         ICronLogRepo;
  snapshots:       ISignalSnapshotRepo;
}
