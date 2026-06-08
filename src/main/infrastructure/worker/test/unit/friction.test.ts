import { describe, it, expect, vi } from 'vitest';
import { analyzeFriction } from '../../application/friction.js';
import type { ILLMProvider, ISignalRepo } from '../../application/ports.js';
import type { Signal, FrictionProfile } from '../../domain/types.js';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:              'sig-1',
    source:          'github',
    collected_at:    new Date().toISOString(),
    segment:         'test',
    location:        null,
    raw_text:        'Implementing SII is causing serious issues with 701 comments discussing workarounds',
    url:             'https://github.com/OCA/l10n-spain/issues/123',
    pain_keywords:   ['sii'],
    sentiment_score: -0.5,
    salary_mean:     null,
    income_tier:     null,
    signal_strength: 0.6,
    has_deadline:    false,
    ...overrides,
  };
}

const VALID_PROFILE: FrictionProfile = {
  problem_type:    'regulation',
  intensity:       8,
  frequency:       'monthly',
  workaround:      true,
  has_solution:    false,
  regulatory_body: 'AEAT',
  affected_role:   'gestor',
  pain_summary:    'SII reporting requires complex integration',
  confidence:      0.9,
};

function asBatch(...profiles: Array<{ profile: FrictionProfile; idx: number }>): string {
  return JSON.stringify(profiles.map(p => ({ ...p.profile, index: p.idx })));
}

function makeLlm(response: string): ILLMProvider {
  return { complete: vi.fn().mockResolvedValue(response) };
}

interface TrackingRepo extends ISignalRepo {
  calls: Array<{ id: string; strength: number; profile: FrictionProfile }>;
}

function makeRepo(): TrackingRepo {
  const calls: Array<{ id: string; strength: number; profile: FrictionProfile }> = [];
  return {
    save:    vi.fn().mockResolvedValue(true),
    get:     vi.fn().mockResolvedValue([]),
    getAll:  vi.fn().mockResolvedValue([]),
    count:   vi.fn().mockResolvedValue(0),
    updateFriction: vi.fn().mockImplementation(
      async (id: string, strength: number, profile: FrictionProfile) => {
        calls.push({ id, strength, profile });
      }
    ),
    calls,
  };
}

describe('analyzeFriction', () => {
  it('enriches github signal and calls updateFriction with computed quality', async () => {
    const repo = makeRepo();
    await analyzeFriction([makeSignal()], makeLlm(asBatch({ profile: VALID_PROFILE, idx: 0 })), repo);

    expect(repo.calls).toHaveLength(1);
    // quality = (8/10) * (0.6 + 0.4 * 0.9) = 0.8 * 0.96 = 0.768
    expect(repo.calls[0]!.strength).toBeCloseTo(0.768, 2);
    expect(repo.calls[0]!.id).toBe('sig-1');
    expect(repo.calls[0]!.profile.problem_type).toBe('regulation');
  });

  it('skips gnews signal with ss below 0.35', async () => {
    const repo = makeRepo();
    const signal = makeSignal({ source: 'gnews', signal_strength: 0.28 });
    await analyzeFriction([signal], makeLlm(JSON.stringify(VALID_PROFILE)), repo);
    expect(repo.calls).toHaveLength(0);
  });

  it('analyzes gnews signal at ss >= 0.35', async () => {
    const repo = makeRepo();
    const signal = makeSignal({ source: 'gnews', signal_strength: 0.40 });
    await analyzeFriction([signal], makeLlm(asBatch({ profile: VALID_PROFILE, idx: 0 })), repo);
    expect(repo.calls).toHaveLength(1);
  });

  it('skips local_news signal with ss below 0.35', async () => {
    const repo = makeRepo();
    const signal = makeSignal({ source: 'local_news', signal_strength: 0.30 });
    await analyzeFriction([signal], makeLlm(JSON.stringify(VALID_PROFILE)), repo);
    expect(repo.calls).toHaveLength(0);
  });

  it('skips already-analyzed signal', async () => {
    const repo = makeRepo();
    const signal = makeSignal({ friction_analysis: JSON.stringify(VALID_PROFILE) });
    await analyzeFriction([signal], makeLlm(JSON.stringify(VALID_PROFILE)), repo);
    expect(repo.calls).toHaveLength(0);
  });

  it('silently skips signal when LLM returns no JSON object', async () => {
    const repo = makeRepo();
    await analyzeFriction([makeSignal()], makeLlm('not valid json at all'), repo);
    expect(repo.calls).toHaveLength(0);
  });

  it('handles LLM returning a bare object instead of an array (single-signal batch)', async () => {
    const repo = makeRepo();
    const bare = JSON.stringify({ ...VALID_PROFILE, index: 0 });
    await analyzeFriction([makeSignal()], makeLlm(bare), repo);
    expect(repo.calls).toHaveLength(1);
    expect(repo.calls[0]!.strength).toBeCloseTo(0.768, 2);
  });

  it('handles LLM preamble before JSON', async () => {
    const repo = makeRepo();
    const llm = makeLlm(`Aquí el análisis: ${asBatch({ profile: VALID_PROFILE, idx: 0 })}`);
    await analyzeFriction([makeSignal()], llm, repo);
    expect(repo.calls).toHaveLength(1);
  });

  it('processes multiple signals independently', async () => {
    const repo = makeRepo();
    const s1 = makeSignal({ id: 'sig-1' });
    const s2 = makeSignal({ id: 'sig-2', signal_strength: 0.5 });
    await analyzeFriction([s1, s2], makeLlm(asBatch({ profile: VALID_PROFILE, idx: 0 }, { profile: VALID_PROFILE, idx: 1 })), repo);
    expect(repo.calls).toHaveLength(2);
    expect(repo.calls.map(c => c.id)).toContain('sig-1');
    expect(repo.calls.map(c => c.id)).toContain('sig-2');
  });
});
