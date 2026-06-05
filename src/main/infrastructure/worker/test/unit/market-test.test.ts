import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMarketTest, InMemorySignalRepo } from '../../application/market-test.js';
import type { ILLMProvider, IMarketTestRepo } from '../../application/ports.js';
import type { GnewsSegmentConfig, MarketTest, MarketTestResult, Signal } from '../../domain/types.js';

vi.mock('../../infrastructure/collectors/gnews.js', () => ({
  collectGnews: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:              `sig-${Math.random().toString(36).slice(2, 8)}`,
    source:          'gnews',
    collected_at:    new Date().toISOString(),
    segment:         'market-test',
    location:        null,
    raw_text:        'Software fiscal pain is real and ongoing for professionals',
    url:             `https://example.com/${Math.random()}`,
    pain_keywords:   ['software', 'fiscal'],
    sentiment_score: -0.4,
    salary_mean:     40000,
    income_tier:     'medium',
    signal_strength: 0.6,
    has_deadline:    false,
    ...overrides,
  };
}

const VALID_CONFIG: GnewsSegmentConfig = {
  label: 'Test segment',
  queries: ['test query Spain'],
  keywords: ['test', 'pain', 'software'],
  salary_mean: 40000,
  income_tier: 'medium',
  has_deadline: false,
};

function makeMockLlm(config: GnewsSegmentConfig = VALID_CONFIG): ILLMProvider {
  return { complete: vi.fn().mockResolvedValue(JSON.stringify(config)) };
}

class InMemoryMarketTestRepo implements IMarketTestRepo {
  readonly store = new Map<string, Partial<MarketTest>>();

  async createMarketTest(id: string, description: string, now: string): Promise<void> {
    this.store.set(id, { id, description, status: 'pending', created_at: now, updated_at: now, generated_config: null, result: null, error: null });
  }

  async claimMarketTest(id: string, now: string): Promise<boolean> {
    const t = this.store.get(id);
    if (!t || t.status !== 'pending') return false;
    t.status = 'running';
    t.updated_at = now;
    return true;
  }

  async updateMarketTestConfig(id: string, config: GnewsSegmentConfig, now: string): Promise<void> {
    const t = this.store.get(id)!;
    t.generated_config = config;
    t.updated_at = now;
  }

  async completeMarketTest(id: string, result: MarketTestResult, now: string): Promise<void> {
    const t = this.store.get(id)!;
    t.status = 'done';
    t.result = result;
    t.updated_at = now;
  }

  async failMarketTest(id: string, error: string, now: string): Promise<void> {
    const t = this.store.get(id)!;
    t.status = 'failed';
    t.error = error;
    t.updated_at = now;
  }

  async getMarketTest(id: string): Promise<MarketTest | null> {
    return (this.store.get(id) as MarketTest) ?? null;
  }
}

// ---------------------------------------------------------------------------
// InMemorySignalRepo
// ---------------------------------------------------------------------------

describe('InMemorySignalRepo', () => {
  it('save stores a signal and count increments', async () => {
    const repo = new InMemorySignalRepo();
    expect(await repo.count()).toBe(0);
    const sig = makeSignal();
    await repo.save(sig);
    expect(await repo.count()).toBe(1);
  });

  it('get returns the last N signals', async () => {
    const repo = new InMemorySignalRepo();
    for (let i = 0; i < 5; i++) await repo.save(makeSignal());
    const result = await repo.get('any', 3);
    expect(result).toHaveLength(3);
  });

  it('getAll returns all signals up to limit', async () => {
    const repo = new InMemorySignalRepo();
    for (let i = 0; i < 4; i++) await repo.save(makeSignal());
    expect(await repo.getAll(10)).toHaveLength(4);
    expect(await repo.getAll(2)).toHaveLength(2);
  });

  it('getSignals returns a copy of all stored signals', async () => {
    const repo = new InMemorySignalRepo();
    const sig = makeSignal();
    await repo.save(sig);
    const signals = repo.getSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0].id).toBe(sig.id);
  });
});

// ---------------------------------------------------------------------------
// runMarketTest
// ---------------------------------------------------------------------------

describe('runMarketTest', () => {
  let repo: InMemoryMarketTestRepo;

  beforeEach(() => {
    repo = new InMemoryMarketTestRepo();
    const now = new Date().toISOString();
    repo.store.set('t1', { id: 't1', description: 'dentists in pain', status: 'pending', created_at: now, updated_at: now, generated_config: null, result: null, error: null });
  });

  it('transitions status to done and populates result', async () => {
    await runMarketTest('t1', 'dentists in pain', makeMockLlm(), repo);
    const test = repo.store.get('t1');
    expect(test?.status).toBe('done');
    expect(test?.result).toBeDefined();
    expect(typeof test?.result?.score).toBe('number');
    expect(test?.result?.score).toBeGreaterThanOrEqual(0);
    expect(test?.result?.score).toBeLessThanOrEqual(10);
    expect(test?.generated_config).toEqual(VALID_CONFIG);
  });

  it('exits without mutation if test is already claimed (not pending)', async () => {
    const now = new Date().toISOString();
    repo.store.set('t2', { id: 't2', description: 'lawyers', status: 'running', created_at: now, updated_at: now, generated_config: null, result: null, error: null });
    await runMarketTest('t2', 'lawyers', makeMockLlm(), repo);
    expect(repo.store.get('t2')?.status).toBe('running');
  });

  it('sets status=failed and stores error message when LLM throws', async () => {
    const failLlm: ILLMProvider = { complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')) };
    await runMarketTest('t1', 'dentists in pain', failLlm, repo);
    const test = repo.store.get('t1');
    expect(test?.status).toBe('failed');
    expect(test?.error).toBe('LLM unavailable');
  });

  it('sets status=failed when LLM returns malformed JSON', async () => {
    const badLlm: ILLMProvider = { complete: vi.fn().mockResolvedValue('not json at all') };
    await runMarketTest('t1', 'dentists in pain', badLlm, repo);
    const test = repo.store.get('t1');
    expect(test?.status).toBe('failed');
    expect(test?.error).toBeDefined();
  });
});
