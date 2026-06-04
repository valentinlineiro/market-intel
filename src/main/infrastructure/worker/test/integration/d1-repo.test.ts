import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { D1Repo } from '../../infrastructure/db/d1-repo.js';
import type { Signal, Opportunity, DiscoveryCandidate } from '../../domain/types.js';

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
    `CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, segment TEXT NOT NULL, pain_summary TEXT, score REAL, score_breakdown TEXT, signal_ids TEXT, signal_count INTEGER DEFAULT 0, first_seen TEXT, last_updated TEXT, status TEXT DEFAULT 'watching', landing_url TEXT, emails_captured INTEGER DEFAULT 0, validation_deadline TEXT, alerted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, segment TEXT NOT NULL, captured_at TEXT NOT NULL, ip TEXT, ua TEXT, UNIQUE(email, segment))`,
    `CREATE TABLE IF NOT EXISTS landing_pages (segment TEXT PRIMARY KEY, html TEXT NOT NULL, title TEXT, deployed_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS discovery_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, profile TEXT NOT NULL, pain TEXT NOT NULL, keywords TEXT NOT NULL, source_urls TEXT NOT NULL DEFAULT '[]', post_count INTEGER DEFAULT 0, discovery_score REAL DEFAULT 0, income_est TEXT, has_deadline INTEGER DEFAULT 0, source TEXT DEFAULT 'reddit', run_id TEXT NOT NULL, discovered_at TEXT NOT NULL)`,
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
    for (const table of ['signals', 'opportunities', 'leads', 'landing_pages', 'discovery_candidates']) {
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
      expect(result!.candidates[0]!.segment).toBe('Fisioterapeuta autónomo');
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
      await repo.saveLanding('dentista', '<html>test</html>', 'https://example.com/dentista');
      const html = await repo.getLandingHtml('dentista');
      expect(html).toBe('<html>test</html>');
    });

    it('getLandingHtml returns null for unknown segment', async () => {
      const html = await repo.getLandingHtml('unknown-segment');
      expect(html).toBeNull();
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
