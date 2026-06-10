import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { D1Repo } from '../../infrastructure/db/d1-repo.js';
import type { Signal, Opportunity, DiscoveryCandidate, SignalSnapshot } from '../../domain/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:              `sig-${Math.random().toString(36).slice(2, 8)}`,
    source:          'gnews',
    collected_at:    new Date().toISOString(),
    segment:         'dentista',
    location:        null,
    raw_text:        'Sample raw text about dental software pain',
    url:             `https://example.com/${Math.random()}`,
    pain_keywords:   ['verifactu', 'hacienda'],
    sentiment_score: -0.5,
    salary_mean:     66500,
    income_tier:     'high',
    signal_strength: 0.8,
    has_deadline:    true,
    ...overrides,
  };
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  const id = `opp-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    segment:             'dentista',
    pain_summary:        'Software fiscal pain for dentists',
    score:               7.5,
    score_breakdown:     {
      dolor: 8, capacidad_pago: 7, volumen: 6, competencia: 5, urgencia: 10,
    },
    signal_ids:          ['sig1', 'sig2'],
    signal_count:        2,
    first_seen:          new Date().toISOString(),
    last_updated:        new Date().toISOString(),
    status:              'watching',
    landing_url:         null,
    emails_captured:     0,
    validation_deadline: null,
    telegram_alerted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema setup — apply all migrations before each test
// ---------------------------------------------------------------------------

async function applyMigrations(db: D1Database): Promise<void> {
  // Use prepare().run() for DDL — exec() requires a trailing semicolon in some miniflare versions
  const ddl: string[] = [
    `CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, source TEXT NOT NULL, collected_at TEXT NOT NULL, segment TEXT NOT NULL, location TEXT, raw_text TEXT, url TEXT, pain_keywords TEXT, sentiment_score REAL, salary_mean INTEGER, income_tier TEXT, signal_strength REAL, has_deadline INTEGER DEFAULT 0)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_url_seg ON signals(url, segment)`,
    `CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, segment TEXT NOT NULL, pain_summary TEXT, score REAL, score_breakdown TEXT, signal_ids TEXT, signal_count INTEGER DEFAULT 0, first_seen TEXT, last_updated TEXT, status TEXT DEFAULT 'watching', landing_url TEXT, emails_captured INTEGER DEFAULT 0, validation_deadline TEXT, alerted_at TEXT, gap_score REAL)`,
    `CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, segment TEXT NOT NULL, captured_at TEXT NOT NULL, ip TEXT, ua TEXT, price_tier TEXT, UNIQUE(email, segment))`,
    `CREATE TABLE IF NOT EXISTS landing_pages (segment TEXT NOT NULL, page_slug TEXT NOT NULL DEFAULT 'index', html TEXT NOT NULL, copy TEXT, title TEXT, deployed_at TEXT NOT NULL, PRIMARY KEY (segment, page_slug))`,
    `CREATE TABLE IF NOT EXISTS discovery_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, profile TEXT NOT NULL, pain TEXT NOT NULL, keywords TEXT NOT NULL, source_urls TEXT NOT NULL DEFAULT '[]', post_count INTEGER DEFAULT 0, discovery_score REAL DEFAULT 0, income_est TEXT, has_deadline INTEGER DEFAULT 0, source TEXT DEFAULT 'reddit', run_id TEXT NOT NULL, discovered_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS market_tests (id TEXT PRIMARY KEY, description TEXT NOT NULL, generated_config TEXT, status TEXT NOT NULL DEFAULT 'pending', result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS signal_snapshots (segment TEXT NOT NULL, week TEXT NOT NULL, count INTEGER NOT NULL, avg_pain REAL NOT NULL, solution_ratio REAL NOT NULL DEFAULT 0, PRIMARY KEY (segment, week))`,
  ];

  for (const stmt of ddl) {
    await db.prepare(stmt).run();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D1Repo', () => {
  let repo: D1Repo;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    // Clear tables before each test to ensure isolation
    for (const table of ['signals', 'opportunities', 'leads', 'landing_pages', 'discovery_candidates', 'market_tests', 'signal_snapshots']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    repo = new D1Repo(env.DB);
  });

  // ── ISignalRepo ────────────────────────────────────────────────────────

  describe('ISignalRepo', () => {
    it('saves a signal and retrieves it by segment', async () => {
      const signal = makeSignal({ segment: 'dentista' });
      const inserted = await repo.save(signal);
      expect(inserted).toBe(true);

      const results = await repo.get('dentista', 10);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(signal.id);
      expect(results[0]!.pain_keywords).toEqual(['verifactu', 'hacienda']);
      expect(results[0]!.has_deadline).toBe(true);
    });

    it('returns false (duplicate) when saving the same url+segment twice', async () => {
      const signal = makeSignal({ url: 'https://example.com/fixed', segment: 'dentista' });
      const first = await repo.save(signal);
      const second = await repo.save(signal);
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it('getAll returns signals across all segments', async () => {
      await repo.save(makeSignal({ segment: 'dentista' }));
      await repo.save(makeSignal({ segment: 'arquitecto' }));

      const all = await repo.getAll(100);
      expect(all).toHaveLength(2);
    });

    it('count returns total signals when no segment given', async () => {
      await repo.save(makeSignal({ segment: 'dentista' }));
      await repo.save(makeSignal({ segment: 'arquitecto' }));

      const total = await repo.count();
      expect(total).toBe(2);
    });

    it('count returns segment-specific count when segment is given', async () => {
      await repo.save(makeSignal({ segment: 'dentista' }));
      await repo.save(makeSignal({ segment: 'dentista' }));
      await repo.save(makeSignal({ segment: 'arquitecto' }));

      const dentista = await repo.count('dentista');
      expect(dentista).toBe(2);

      const arquitecto = await repo.count('arquitecto');
      expect(arquitecto).toBe(1);
    });
  });

  // ── IOpportunityRepo ───────────────────────────────────────────────────

  describe('IOpportunityRepo', () => {
    it('upserts an opportunity and retrieves it via getAll', async () => {
      const opp = makeOpportunity({ segment: 'dentista', score: 7.5 });
      await repo.upsert(opp);

      const all = await repo.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(opp.id);
      expect(all[0]!.score_breakdown.dolor).toBe(8);
      expect(all[0]!.signal_ids).toEqual(['sig1', 'sig2']);
    });

    it('upsert updates score on conflict', async () => {
      const opp = makeOpportunity({ score: 5.0 });
      await repo.upsert(opp);
      await repo.upsert({ ...opp, score: 9.0 });

      const all = await repo.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.score).toBe(9.0);
    });

    it('getBySegment returns the opportunity for a given segment', async () => {
      const opp = makeOpportunity({ segment: 'abogado' });
      await repo.upsert(opp);

      const found = await repo.getBySegment('abogado');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(opp.id);

      const notFound = await repo.getBySegment('nonexistent');
      expect(notFound).toBeNull();
    });

    it('markAlerted sets alerted_at on the opportunity', async () => {
      const opp = makeOpportunity();
      await repo.upsert(opp);

      const alertedAt = new Date().toISOString();
      await repo.markAlerted(opp.id, alertedAt);

      const updated = await repo.getBySegment(opp.segment);
      expect(updated!.telegram_alerted_at).toBe(alertedAt);
    });
  });

  // ── ILeadRepo ──────────────────────────────────────────────────────────

  describe('ILeadRepo', () => {
    it('saves a lead and retrieves it', async () => {
      await repo.saveLead('user@example.com', 'dentista');

      const leads = await repo.getLeads('dentista');
      expect(leads).toHaveLength(1);
      expect(leads[0]!.email).toBe('user@example.com');
      expect(leads[0]!.segment).toBe('dentista');
    });

    it('getLeads without segment returns all leads', async () => {
      await repo.saveLead('a@example.com', 'dentista');
      await repo.saveLead('b@example.com', 'arquitecto');

      const all = await repo.getLeads();
      expect(all).toHaveLength(2);
    });

    it('duplicate email+segment is silently ignored', async () => {
      await repo.saveLead('dup@example.com', 'dentista');
      await repo.saveLead('dup@example.com', 'dentista');

      const leads = await repo.getLeads('dentista');
      expect(leads).toHaveLength(1);
    });

    it('savePriceTier updates price_tier on existing lead', async () => {
      await repo.saveLead('price@test.es', 'dentista');
      const before = await repo.getLeads('dentista');
      const lead = before.find(l => l.email === 'price@test.es');
      expect(lead).toBeDefined();
      expect(lead!.price_tier).toBeNull();

      await repo.savePriceTier('price@test.es', 'dentista', '30-50');
      const after = await repo.getLeads('dentista');
      const updated = after.find(l => l.email === 'price@test.es');
      expect(updated!.price_tier).toBe('30-50');
    });

    it('savePriceTier on unknown email is a no-op', async () => {
      await expect(
        repo.savePriceTier('nobody@test.es', 'dentista', '50+')
      ).resolves.toBeUndefined();
    });
  });

  // ── IDiscoveryRepo ─────────────────────────────────────────────────────

  describe('IDiscoveryRepo', () => {
    it('saveCandidates then getLatestCandidates returns them', async () => {
      const candidates: DiscoveryCandidate[] = [
        {
          segment:         'Fisioterapeuta autónomo',
          pain_summary:    'Burocracia con seguros médicos',
          discovery_score: 7.0,
          source_urls:     ['https://reddit.com/r/fisio/1'],
          raw_signals:     ['post1', 'post2'],
          discovered_at:   new Date().toISOString(),
        },
        {
          segment:         'Veterinario clínica',
          pain_summary:    'Software de gestión caro y lento',
          discovery_score: 5.5,
          source_urls:     [],
          raw_signals:     [],
          discovered_at:   new Date().toISOString(),
        },
      ];

      await repo.saveCandidates(candidates);

      const result = await repo.getLatestCandidates();
      expect(result).not.toBeNull();
      expect(result!.candidates).toHaveLength(2);
      // Results ordered by discovery_score DESC
      expect(result!.candidates[0]!.segment).toBe('fisioterapeuta_aut_nomo');
      expect(result!.candidates[0]!.label).toBe('Fisioterapeuta autónomo');
      expect(result!.candidates[0]!.pain_summary).toBe('Burocracia con seguros médicos');
      expect(result!.discovered_at).toBeTruthy();
    });

    it('getLatestCandidates returns null when no candidates exist', async () => {
      const result = await repo.getLatestCandidates();
      expect(result).toBeNull();
    });

    it('getSegmentsToScore returns segments from latest discovery run', async () => {
      const candidates: DiscoveryCandidate[] = [
        {
          segment:         'Farmacéutico',
          pain_summary:    'Gestión de stock compleja',
          discovery_score: 8.0,
          source_urls:     ['kw1', 'kw2'],
          raw_signals:     [],
          discovered_at:   new Date().toISOString(),
        },
      ];
      await repo.saveCandidates(candidates);

      const segs = await repo.getSegmentsToScore(10, 1.0);
      expect(segs).toHaveLength(1);
      const farmaceutico = segs.find((s) => s.label === 'Farmacéutico');
      expect(farmaceutico).toBeDefined();
      expect(farmaceutico!.discovery_score).toBe(8.0);
    });

    it('getSegmentsToScore filters by minScore', async () => {
      const candidates: DiscoveryCandidate[] = [
        {
          segment: 'HighScore', pain_summary: 'pain', discovery_score: 9.0,
          source_urls: [], raw_signals: [], discovered_at: new Date().toISOString(),
        },
        {
          segment: 'LowScore', pain_summary: 'pain', discovery_score: 0.5,
          source_urls: [], raw_signals: [], discovered_at: new Date().toISOString(),
        },
      ];
      await repo.saveCandidates(candidates);

      const segs = await repo.getSegmentsToScore(10, 2.0);
      const labels = segs.map((s) => s.label);
      expect(labels).toContain('HighScore');
      expect(labels).not.toContain('LowScore');
    });
  });

  // ── Extra methods ──────────────────────────────────────────────────────

  describe('Extra methods', () => {
    it('saveLanding then getLandingHtml returns html', async () => {
      await repo.saveLanding('seg1', 'index', '<h1>test</h1>', null, 'Test');
      const html = await repo.getLandingHtml('seg1');
      expect(html).toBe('<h1>test</h1>');
    });

    it('getLandingHtml returns null for unknown segment', async () => {
      const html = await repo.getLandingHtml('unknown-segment');
      expect(html).toBeNull();
    });

    it('getLandingHtml with explicit slug returns correct page', async () => {
      await repo.saveLanding('seg2', 'precios', '<h1>precios</h1>', null, 'Precios');
      const html = await repo.getLandingHtml('seg2', 'precios');
      expect(html).toBe('<h1>precios</h1>');
      const missing = await repo.getLandingHtml('seg2', 'index');
      expect(missing).toBeNull();
    });

    it('listLandingPages returns all pages for a segment', async () => {
      const copy = { headline: 'H', subheadline: 'S', pain_points: ['p1'], cta: 'CTA' };
      await repo.saveLanding('seg3', 'index', '<h1>index</h1>', copy, 'Index');
      await repo.saveLanding('seg3', 'about', '<h1>about</h1>', null, 'About');
      const pages = await repo.listLandingPages('seg3');
      expect(pages).toHaveLength(2);
      const index = pages.find(p => p.page_slug === 'index');
      expect(index?.copy?.headline).toBe('H');
      expect(index?.copy?.pain_points).toEqual(['p1']);
      const about = pages.find(p => p.page_slug === 'about');
      expect(about?.copy).toBeNull();
    });

    it('listLandingPages returns empty array for unknown segment', async () => {
      const pages = await repo.listLandingPages('no-such-segment');
      expect(pages).toHaveLength(0);
    });

    it('deleteLandingPage removes the row, others unaffected', async () => {
      await repo.saveLanding('seg4', 'index', '<h1>i</h1>', null, 'i');
      await repo.saveLanding('seg4', 'about', '<h1>a</h1>', null, 'a');
      await repo.deleteLandingPage('seg4', 'index');
      const pages = await repo.listLandingPages('seg4');
      expect(pages).toHaveLength(1);
      expect(pages[0]!.page_slug).toBe('about');
    });

    it('deleteLandingPage on non-existent row is a no-op', async () => {
      await expect(
        repo.deleteLandingPage('no-seg', 'no-slug')
      ).resolves.toBeUndefined();
    });

    it('saveLanding upserts on duplicate segment+slug', async () => {
      await repo.saveLanding('seg5', 'index', '<h1>v1</h1>', null, 'v1');
      await repo.saveLanding('seg5', 'index', '<h1>v2</h1>', null, 'v2');
      const html = await repo.getLandingHtml('seg5', 'index');
      expect(html).toBe('<h1>v2</h1>');
    });

    it('getStats returns counts across tables', async () => {
      await repo.save(makeSignal());
      await repo.save(makeSignal());
      await repo.upsert(makeOpportunity());
      await repo.saveLead('stats@example.com', 'dentista');

      const stats = await repo.getStats();
      expect(stats.signals).toBe(2);
      expect(stats.opportunities).toBe(1);
      expect(stats.leads).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Market test repo
// ---------------------------------------------------------------------------

describe('D1Repo — market tests', () => {
  let repo: D1Repo;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    for (const table of ['signals', 'opportunities', 'leads', 'landing_pages', 'discovery_candidates', 'market_tests', 'signal_snapshots']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    repo = new D1Repo(env.DB);
  });

  it('createMarketTest inserts a pending row', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-1', 'dentists in pain', now);
    const test = await repo.getMarketTest('mt-1');
    expect(test).not.toBeNull();
    expect(test!.id).toBe('mt-1');
    expect(test!.description).toBe('dentists in pain');
    expect(test!.status).toBe('pending');
    expect(test!.generated_config).toBeNull();
    expect(test!.result).toBeNull();
  });

  it('claimMarketTest transitions pending → running and returns true', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-2', 'lawyers', now);
    const claimed = await repo.claimMarketTest('mt-2', now);
    expect(claimed).toBe(true);
    const test = await repo.getMarketTest('mt-2');
    expect(test!.status).toBe('running');
  });

  it('claimMarketTest returns false when status is not pending', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-3', 'architects', now);
    await repo.claimMarketTest('mt-3', now);
    const second = await repo.claimMarketTest('mt-3', now);
    expect(second).toBe(false);
  });

  it('updateMarketTestConfig stores the generated config JSON', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-4', 'professors', now);
    await repo.claimMarketTest('mt-4', now);
    const config = {
      label: 'Docente universitario',
      queries: ['ANECA acreditación problema'],
      keywords: ['aneca', 'sexenios'],
      salary_mean: 42000,
      income_tier: 'medium_high' as const,
      has_deadline: false,
    };
    await repo.updateMarketTestConfig('mt-4', config, now);
    const test = await repo.getMarketTest('mt-4');
    expect(test!.generated_config).toEqual(config);
  });

  it('completeMarketTest stores result and sets status=done', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-5', 'dentists', now);
    await repo.claimMarketTest('mt-5', now);
    const result = {
      score: 7.5,
      breakdown: { dolor: 8, capacidad_pago: 7, volumen: 5, competencia: 5, urgencia: 10 },
      pain_summary: 'verifactu software pain',
      signal_count: 3,
      signals: [],
    };
    await repo.completeMarketTest('mt-5', result, now);
    const test = await repo.getMarketTest('mt-5');
    expect(test!.status).toBe('done');
    expect(test!.result).toEqual(result);
  });

  it('failMarketTest stores error and sets status=failed', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-6', 'architects', now);
    await repo.claimMarketTest('mt-6', now);
    await repo.failMarketTest('mt-6', 'LLM unavailable', now);
    const test = await repo.getMarketTest('mt-6');
    expect(test!.status).toBe('failed');
    expect(test!.error).toBe('LLM unavailable');
  });

  it('getMarketTest returns null for unknown id', async () => {
    const test = await repo.getMarketTest('does-not-exist');
    expect(test).toBeNull();
  });

  it('completeMarketTest is a no-op for unknown id (internal invariant)', async () => {
    const result = {
      score: 5.0,
      breakdown: { dolor: 5, capacidad_pago: 5, volumen: 5, competencia: 5, urgencia: 5 },
      pain_summary: '',
      signal_count: 0,
      signals: [],
    };
    // Should not throw — caller guarantees id exists after claimMarketTest
    await expect(repo.completeMarketTest('no-such-id', result, new Date().toISOString())).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Signal snapshots repo
// ---------------------------------------------------------------------------

describe('D1Repo — signal_snapshots', () => {
  let repo: D1Repo;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    for (const table of ['signals', 'opportunities', 'leads', 'landing_pages', 'discovery_candidates', 'market_tests', 'signal_snapshots']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    repo = new D1Repo(env.DB);
  });

  // ── signal_snapshots ──────────────────────────────────────────────────────

  describe('ISignalSnapshotRepo', () => {
    it('upserts and retrieves a snapshot', async () => {
      const snap: SignalSnapshot = {
        segment: 'test_seg', week: '2026-W23',
        count: 10, avg_pain: 7.5, solution_ratio: 0.2,
      };
      await repo.upsertSnapshot(snap);
      const results = await repo.getSnapshots('test_seg', 5);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject(snap);
    });

    it('upserts are idempotent', async () => {
      const snap: SignalSnapshot = { segment: 'seg2', week: '2026-W23', count: 5, avg_pain: 5.0, solution_ratio: 0.1 };
      await repo.upsertSnapshot(snap);
      await repo.upsertSnapshot({ ...snap, count: 8 }); // re-run same week
      const results = await repo.getSnapshots('seg2', 5);
      expect(results).toHaveLength(1);
      expect(results[0]!.count).toBe(8); // latest wins
    });

    it('getSnapshots returns ordered newest-first up to weeksBack', async () => {
      await repo.upsertSnapshot({ segment: 'seg3', week: '2026-W20', count: 3, avg_pain: 4.0, solution_ratio: 0.0 });
      await repo.upsertSnapshot({ segment: 'seg3', week: '2026-W21', count: 5, avg_pain: 5.0, solution_ratio: 0.0 });
      await repo.upsertSnapshot({ segment: 'seg3', week: '2026-W22', count: 7, avg_pain: 6.0, solution_ratio: 0.0 });
      const results = await repo.getSnapshots('seg3', 2);
      expect(results).toHaveLength(2);
      expect(results[0]!.week).toBe('2026-W22');
      expect(results[1]!.week).toBe('2026-W21');
    });

    it('getLatestSnapshotAllSegments returns one row per segment', async () => {
      await repo.upsertSnapshot({ segment: 'segA', week: '2026-W22', count: 2, avg_pain: 3.0, solution_ratio: 0.0 });
      await repo.upsertSnapshot({ segment: 'segA', week: '2026-W23', count: 4, avg_pain: 5.0, solution_ratio: 0.0 });
      await repo.upsertSnapshot({ segment: 'segB', week: '2026-W23', count: 1, avg_pain: 2.0, solution_ratio: 0.5 });
      const all = await repo.getLatestSnapshotAllSegments();
      const segA = all.find(s => s.segment === 'segA');
      expect(segA?.week).toBe('2026-W23');
    });
  });

  // ── IOpportunityRepo.updateGapScore ──────────────────────────────────────

  describe('updateGapScore', () => {
    it('sets gap_score on an existing opportunity', async () => {
      const opp: Opportunity = {
        id: 'opp-gap-1', segment: 'gap_seg', pain_summary: 'test',
        score: 7.5, score_breakdown: { dolor: 7, capacidad_pago: 7, volumen: 7, competencia: 7, urgencia: 7 },
        signal_ids: [], signal_count: 5,
        first_seen: '2026-01-01T00:00:00.000Z', last_updated: '2026-01-01T00:00:00.000Z',
        status: 'watching', landing_url: null, emails_captured: 0,
        validation_deadline: null, telegram_alerted_at: null,
      };
      await repo.upsert(opp);
      await repo.updateGapScore('gap_seg', 82);
      const fetched = await repo.getBySegment('gap_seg');
      expect(fetched?.gap_score).toBe(82);
    });
  });

  // ── ISignalRepo.getSignalsInRange ─────────────────────────────────────────

  describe('getSignalsInRange', () => {
    it('returns signals within the date range', async () => {
      const makeSignal = (id: string, at: string): Signal => ({
        id, source: 'reddit' as const, collected_at: at,
        segment: 'range_seg', location: null,
        raw_text: 'test', url: `https://example.com/${id}`,
        pain_keywords: [], sentiment_score: null, salary_mean: null,
        income_tier: null, signal_strength: 0.5, has_deadline: false, friction_analysis: null,
      });
      await repo.save(makeSignal('r1', '2026-06-09T10:00:00Z'));
      await repo.save(makeSignal('r2', '2026-06-10T10:00:00Z'));
      await repo.save(makeSignal('r3', '2026-06-15T10:00:00Z'));
      const results = await repo.getSignalsInRange('2026-06-09T00:00:00Z', '2026-06-11T00:00:00Z');
      const ids = results.map(s => s.id);
      expect(ids).toContain('r1');
      expect(ids).toContain('r2');
      expect(ids).not.toContain('r3');
    });
  });
});
