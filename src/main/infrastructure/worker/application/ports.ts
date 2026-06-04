import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig } from '../domain/types.js';

export interface ISignalRepo {
  save(signal: Signal): Promise<boolean>;
  get(segment: string, limit: number): Promise<Signal[]>;
  getAll(limit: number): Promise<Signal[]>;
  count(segment?: string): Promise<number>;
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
