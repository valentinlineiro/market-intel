import type {
  Signal,
  Opportunity,
  Lead,
  DiscoveryCandidate,
  SegmentConfig,
  ScoreBreakdown,
  OpportunityStatus,
} from '../../domain/types.js';
import type {
  ISignalRepo,
  IOpportunityRepo,
  ILeadRepo,
  IDiscoveryRepo,
} from '../../application/ports.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function rowToSignal(r: Record<string, unknown>): Signal {
  return {
    id:               r['id'] as string,
    source:           r['source'] as Signal['source'],
    collected_at:     r['collected_at'] as string,
    segment:          r['segment'] as string,
    location:         (r['location'] as string | null) ?? null,
    raw_text:         r['raw_text'] as string,
    url:              r['url'] as string,
    pain_keywords:    parseJson<string[]>(r['pain_keywords'], []),
    sentiment_score:  (r['sentiment_score'] as number | null) ?? null,
    salary_mean:      (r['salary_mean'] as number | null) ?? null,
    income_tier:      (r['income_tier'] as string | null) ?? null,
    signal_strength:  (r['signal_strength'] as number | null) ?? null,
    has_deadline:     r['has_deadline'] === 1 || r['has_deadline'] === true,
  };
}

function rowToOpportunity(r: Record<string, unknown>): Opportunity {
  return {
    id:                  r['id'] as string,
    segment:             r['segment'] as string,
    pain_summary:        (r['pain_summary'] as string) ?? '',
    score:               r['score'] as number,
    score_breakdown:     parseJson<ScoreBreakdown>(r['score_breakdown'], {
      dolor: 0, capacidad_pago: 0, volumen: 0, competencia: 0, urgencia: 0,
    }),
    signal_ids:          parseJson<string[]>(r['signal_ids'], []),
    signal_count:        (r['signal_count'] as number) ?? 0,
    first_seen:          r['first_seen'] as string,
    last_updated:        r['last_updated'] as string,
    status:              (r['status'] as OpportunityStatus) ?? 'watching',
    landing_url:         (r['landing_url'] as string | null) ?? null,
    emails_captured:     (r['emails_captured'] as number) ?? 0,
    validation_deadline: (r['validation_deadline'] as string | null) ?? null,
    telegram_alerted_at: (r['alerted_at'] as string | null) ?? null,
  };
}

function rowToLead(r: Record<string, unknown>): Lead {
  return {
    id:          String(r['id'] as number),
    email:       r['email'] as string,
    segment:     r['segment'] as string,
    created_at:  (r['captured_at'] as string) ?? (r['created_at'] as string),
  };
}

// ---------------------------------------------------------------------------
// D1Repo — implements all four repository interfaces
// ---------------------------------------------------------------------------

// TypeScript does not allow two methods with the same name but different signatures
// when implementing multiple interfaces.  We satisfy both ISignalRepo.getAll(limit)
// and IOpportunityRepo.getAll() via overloads.
export class D1Repo implements ISignalRepo, IOpportunityRepo, ILeadRepo, IDiscoveryRepo {
  constructor(private readonly db: D1Database) {}

  // ── ISignalRepo ──────────────────────────────────────────────────────────

  async save(signal: Signal): Promise<boolean> {
    const existing = await this.db
      .prepare('SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1')
      .bind(signal.url, signal.segment)
      .first<Record<string, unknown>>();

    if (existing) return false;

    await this.db
      .prepare(`
        INSERT INTO signals
          (id, source, collected_at, segment, location, raw_text, url,
           pain_keywords, sentiment_score, salary_mean, income_tier,
           signal_strength, has_deadline)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        signal.id,
        signal.source,
        signal.collected_at,
        signal.segment,
        signal.location ?? null,
        (signal.raw_text ?? '').slice(0, 2000),
        signal.url,
        JSON.stringify(signal.pain_keywords ?? []),
        signal.sentiment_score ?? null,
        signal.salary_mean ?? null,
        signal.income_tier ?? null,
        signal.signal_strength ?? null,
        signal.has_deadline ? 1 : 0,
      )
      .run();

    return true;
  }

  async get(segment: string, limit: number): Promise<Signal[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM signals WHERE segment = ? ORDER BY collected_at DESC LIMIT ?')
      .bind(segment, limit)
      .all<Record<string, unknown>>();
    return (results ?? []).map(rowToSignal);
  }

  getAll(limit: number): Promise<Signal[]>;
  getAll(): Promise<Opportunity[]>;
  async getAll(limit?: number): Promise<Signal[] | Opportunity[]> {
    if (limit !== undefined) {
      const { results } = await this.db
        .prepare('SELECT * FROM signals ORDER BY collected_at DESC LIMIT ?')
        .bind(limit)
        .all<Record<string, unknown>>();
      return (results ?? []).map(rowToSignal);
    }
    const { results } = await this.db
      .prepare('SELECT * FROM opportunities ORDER BY score DESC')
      .all<Record<string, unknown>>();
    return (results ?? []).map(rowToOpportunity);
  }

  async count(segment?: string): Promise<number> {
    const row = segment
      ? await this.db
          .prepare('SELECT COUNT(*) as n FROM signals WHERE segment = ?')
          .bind(segment)
          .first<Record<string, unknown>>()
      : await this.db
          .prepare('SELECT COUNT(*) as n FROM signals')
          .first<Record<string, unknown>>();
    return (row?.['n'] as number) ?? 0;
  }

  // ── IOpportunityRepo ─────────────────────────────────────────────────────

  async upsert(opp: Opportunity): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO opportunities
          (id, segment, pain_summary, score, score_breakdown, signal_ids,
           signal_count, first_seen, last_updated, status, landing_url,
           emails_captured, validation_deadline, alerted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          score=excluded.score,
          score_breakdown=excluded.score_breakdown,
          signal_ids=excluded.signal_ids,
          signal_count=excluded.signal_count,
          last_updated=excluded.last_updated,
          status=excluded.status,
          emails_captured=excluded.emails_captured,
          landing_url=excluded.landing_url,
          validation_deadline=excluded.validation_deadline,
          alerted_at=excluded.alerted_at
      `)
      .bind(
        opp.id,
        opp.segment,
        opp.pain_summary ?? null,
        opp.score,
        typeof opp.score_breakdown === 'string'
          ? opp.score_breakdown
          : JSON.stringify(opp.score_breakdown ?? {}),
        typeof opp.signal_ids === 'string'
          ? opp.signal_ids
          : JSON.stringify(opp.signal_ids ?? []),
        opp.signal_count ?? 0,
        opp.first_seen,
        opp.last_updated,
        opp.status ?? 'watching',
        opp.landing_url ?? null,
        opp.emails_captured ?? 0,
        opp.validation_deadline ?? null,
        opp.telegram_alerted_at ?? null,
      )
      .run();
  }

  async getBySegment(segment: string): Promise<Opportunity | null> {
    const row = await this.db
      .prepare('SELECT * FROM opportunities WHERE segment = ? LIMIT 1')
      .bind(segment)
      .first<Record<string, unknown>>();
    return row ? rowToOpportunity(row) : null;
  }

  async markAlerted(id: string, at: string): Promise<void> {
    await this.db
      .prepare('UPDATE opportunities SET alerted_at = ? WHERE id = ?')
      .bind(at, id)
      .run();
  }

  // ── ILeadRepo ────────────────────────────────────────────────────────────

  async saveLead(email: string, segment: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT OR IGNORE INTO leads (email, segment, captured_at)
        VALUES (?, ?, ?)
      `)
      .bind(email, segment, now)
      .run();
  }

  async getLeads(segment?: string): Promise<Lead[]> {
    const { results } = segment
      ? await this.db
          .prepare(
            'SELECT id, email, segment, captured_at FROM leads WHERE segment = ? ORDER BY captured_at DESC LIMIT 200',
          )
          .bind(segment)
          .all<Record<string, unknown>>()
      : await this.db
          .prepare(
            'SELECT id, email, segment, captured_at FROM leads ORDER BY captured_at DESC LIMIT 200',
          )
          .all<Record<string, unknown>>();
    return (results ?? []).map(rowToLead);
  }

  // ── IDiscoveryRepo ───────────────────────────────────────────────────────

  async saveCandidates(candidates: DiscoveryCandidate[], run_id?: string): Promise<void> {
    if (!candidates.length) return;

    const effectiveRunId = run_id ?? new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO discovery_candidates
        (profile, pain, keywords, source_urls, post_count, discovery_score, income_est,
         has_deadline, source, run_id, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await this.db.batch(
      candidates.map((c) =>
        stmt.bind(
          c.segment,
          c.pain_summary,
          JSON.stringify(c.raw_signals ?? []),
          JSON.stringify(c.source_urls ?? []),
          c.raw_signals?.length ?? 0,
          c.discovery_score ?? 0,
          null,
          0,
          'discovery',
          effectiveRunId,
          c.discovered_at ?? effectiveRunId,
        ),
      ),
    );
  }

  async getLatestCandidates(): Promise<{
    candidates: DiscoveryCandidate[];
    discovered_at: string;
  } | null> {
    const latest = await this.db
      .prepare(
        'SELECT run_id, discovered_at FROM discovery_candidates ORDER BY id DESC LIMIT 1',
      )
      .first<Record<string, unknown>>();

    if (!latest) return null;

    const { results } = await this.db
      .prepare(
        'SELECT * FROM discovery_candidates WHERE run_id = ? ORDER BY discovery_score DESC LIMIT 20',
      )
      .bind(latest['run_id'])
      .all<Record<string, unknown>>();

    const candidates: DiscoveryCandidate[] = (results ?? []).map((r) => ({
      segment:         r['profile'] as string,
      pain_summary:    r['pain'] as string,
      discovery_score: r['discovery_score'] as number,
      source_urls:     parseJson<string[]>(r['source_urls'], []),
      raw_signals:     [],
      discovered_at:   r['discovered_at'] as string,
    }));

    return {
      candidates,
      discovered_at: latest['discovered_at'] as string,
    };
  }

  async getSegmentsToScore(topN: number, minScore: number): Promise<SegmentConfig[]> {
    const segments = new Map<string, SegmentConfig>();

    // Pull from latest discovery run
    const latestRun = await this.db
      .prepare('SELECT run_id FROM discovery_candidates ORDER BY id DESC LIMIT 1')
      .first<Record<string, unknown>>();

    if (latestRun) {
      const { results: candidates } = await this.db
        .prepare(`
          SELECT * FROM discovery_candidates
          WHERE run_id = ? AND discovery_score >= ?
          ORDER BY discovery_score DESC LIMIT ?
        `)
        .bind(latestRun['run_id'], minScore, topN)
        .all<Record<string, unknown>>();

      for (const c of candidates ?? []) {
        const profile = c['profile'] as string;
        const key = profile
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
          .slice(0, 48);
        segments.set(key, {
          key,
          label:           profile,
          keywords:        parseJson<string[]>(c['keywords'], []),
          income_tier:     (c['income_est'] as string) || 'medium',
          has_deadline:    c['has_deadline'] === 1 || c['has_deadline'] === true,
          discovery_score: (c['discovery_score'] as number) ?? 0,
        });
      }
    }

    // Also include segments that have leads (discovered organically)
    const { results: leadSegs } = await this.db
      .prepare('SELECT DISTINCT segment FROM leads')
      .all<Record<string, unknown>>();

    for (const r of leadSegs ?? []) {
      const seg = r['segment'] as string;
      if (!segments.has(seg)) {
        segments.set(seg, {
          key:             seg,
          label:           seg,
          keywords:        [],
          income_tier:     'medium',
          has_deadline:    false,
          discovery_score: 0,
        });
      }
    }

    return Array.from(segments.values());
  }

  // ── Extra methods (used by index.ts routing) ─────────────────────────────

  async updateOpportunityLanding(segment: string, landingUrl: string, status: string, now: string): Promise<void> {
    await this.db.prepare(
      'UPDATE opportunities SET landing_url = ?, status = ?, last_updated = ? WHERE segment = ?'
    ).bind(landingUrl, status, now, segment).run();
  }

  async replaceCandidatesWithRunId(runId: string, candidates: Array<{
    profile?: string;
    pain?: string;
    keywords?: string[];
    post_count?: number;
    discovery_score?: number;
    income_est?: string | null;
    has_deadline?: boolean;
    source?: string;
  }>): Promise<void> {
    if (!candidates.length) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO discovery_candidates
       (profile, pain, keywords, post_count, discovery_score, income_est, has_deadline, source, run_id, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await this.db.batch(
      candidates.map(c => stmt.bind(
        c.profile, c.pain,
        JSON.stringify(c.keywords ?? []),
        c.post_count ?? 0, c.discovery_score ?? 0,
        c.income_est ?? null, c.has_deadline ? 1 : 0,
        c.source ?? 'reddit', runId, now
      ))
    );
  }

  async getLandingHtml(segment: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT html FROM landing_pages WHERE segment = ?')
      .bind(segment)
      .first<Record<string, unknown>>();
    return row ? (row['html'] as string) : null;
  }

  async saveLanding(segment: string, html: string, title: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO landing_pages (segment, html, title, deployed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(segment) DO UPDATE SET
          html=excluded.html, title=excluded.title, deployed_at=excluded.deployed_at
      `)
      .bind(segment, html, title, now)
      .run();
  }

  async getStatsBySegment(): Promise<Array<{ segment: string; count: number }>> {
    const rows = await this.db.prepare(
      'SELECT segment, COUNT(*) as count FROM signals GROUP BY segment ORDER BY count DESC'
    ).all<Record<string, unknown>>();
    return (rows.results ?? []).map(r => ({
      segment: r['segment'] as string,
      count: Number(r['count']),
    }));
  }

  async getTopOpportunity(): Promise<{ segment: string; score: number; pain_summary: string | null } | null> {
    const row = await this.db.prepare(
      'SELECT segment, score, pain_summary FROM opportunities ORDER BY score DESC LIMIT 1'
    ).first<Record<string, unknown>>();
    if (!row) return null;
    return {
      segment: row['segment'] as string,
      score: Number(row['score']),
      pain_summary: (row['pain_summary'] as string | null) ?? null,
    };
  }

  async getStats(): Promise<{
    signals: number;
    opportunities: number;
    leads: number;
  }> {
    const [sigRow, oppRow, leadRow] = await Promise.all([
      this.db.prepare('SELECT COUNT(*) as n FROM signals').first<Record<string, unknown>>(),
      this.db.prepare('SELECT COUNT(*) as n FROM opportunities').first<Record<string, unknown>>(),
      this.db.prepare('SELECT COUNT(*) as n FROM leads').first<Record<string, unknown>>(),
    ]);
    return {
      signals:       (sigRow?.['n'] as number)  ?? 0,
      opportunities: (oppRow?.['n'] as number)  ?? 0,
      leads:         (leadRow?.['n'] as number) ?? 0,
    };
  }
}
