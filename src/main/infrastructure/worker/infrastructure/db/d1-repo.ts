import type {
  Signal,
  Opportunity,
  Lead,
  DiscoveryCandidate,
  SegmentConfig,
  ScoreBreakdown,
  OpportunityStatus,
  GnewsSegmentConfig,
  MarketTest,
  MarketTestResult,
  FrictionProfile,
  CollectorStat,
  SignalSnapshot,
  CronRun,
} from '../../domain/types.js';
import type {
  ISignalRepo,
  IOpportunityRepo,
  ILeadRepo,
  IDiscoveryRepo,
  IMarketTestRepo,
  ICollectorHealthRepo,
  ISignalSnapshotRepo,
  ICronLogRepo,
} from '../../application/ports.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function profileToSlug(profile: string): string {
  return profile
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

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
    friction_analysis: (r['friction_analysis'] as string | null) ?? null,
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
    gap_score:           (r['gap_score'] as number | null) ?? null,
    score_narrative:     (r['score_narrative'] as string | null) ?? null,
  };
}

function rowToSnapshot(row: Record<string, unknown>): SignalSnapshot {
  return {
    segment:        row['segment'] as string,
    week:           row['week'] as string,
    count:          row['count'] as number,
    avg_pain:       row['avg_pain'] as number,
    solution_ratio: row['solution_ratio'] as number,
  };
}

function rowToLead(r: Record<string, unknown>): Lead {
  return {
    id:         String(r['id'] as number),
    email:      r['email'] as string,
    segment:    r['segment'] as string,
    created_at: (r['captured_at'] as string) ?? (r['created_at'] as string),
    price_tier: (r['price_tier'] as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// D1Repo — implements all four repository interfaces
// ---------------------------------------------------------------------------

// TypeScript does not allow two methods with the same name but different signatures
// when implementing multiple interfaces.  We satisfy both ISignalRepo.getAll(limit)
// and IOpportunityRepo.getAll() via overloads.
export class D1Repo implements ISignalRepo, IOpportunityRepo, ILeadRepo, IDiscoveryRepo, IMarketTestRepo, ICollectorHealthRepo, ISignalSnapshotRepo, ICronLogRepo {
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
      .prepare('SELECT * FROM opportunities ORDER BY score DESC LIMIT 200')
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

  async updateFriction(id: string, strength: number, profile: FrictionProfile): Promise<void> {
    await this.db
      .prepare(
        `UPDATE signals SET signal_strength = ?, friction_analysis = ?, updated_at = ? WHERE id = ?`
      )
      .bind(strength, JSON.stringify(profile), new Date().toISOString(), id)
      .run();
  }

  async getSignalsInRange(from: string, to: string): Promise<Signal[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM signals WHERE collected_at >= ? AND collected_at < ? ORDER BY collected_at DESC`
      )
      .bind(from, to)
      .all<Record<string, unknown>>();
    return (results ?? []).map(rowToSignal);
  }

  async getUnanalyzed(limit = 200): Promise<Signal[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM signals WHERE friction_analysis IS NULL ORDER BY collected_at DESC LIMIT ?`
      )
      .bind(limit)
      .all<Record<string, unknown>>();
    return (results ?? []).map(rowToSignal);
  }

  // ── IOpportunityRepo ─────────────────────────────────────────────────────

  async upsert(opp: Opportunity): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO opportunities
          (id, segment, pain_summary, score, score_breakdown, signal_ids,
           signal_count, first_seen, last_updated, status, landing_url,
           emails_captured, validation_deadline, alerted_at, score_narrative)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          alerted_at=excluded.alerted_at,
          score_narrative=COALESCE(excluded.score_narrative, score_narrative)
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
        opp.score_narrative ?? null,
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

  async updateGapScore(segment: string, score: number): Promise<void> {
    await this.db
      .prepare('UPDATE opportunities SET gap_score = ? WHERE segment = ?')
      .bind(score, segment)
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

  async savePriceTier(email: string, segment: string, priceTier: string): Promise<void> {
    await this.db
      .prepare('UPDATE leads SET price_tier = ? WHERE email = ? AND segment = ?')
      .bind(priceTier, email, segment)
      .run();
  }

  async getLeads(segment?: string): Promise<Lead[]> {
    const { results } = segment
      ? await this.db
          .prepare(
            'SELECT id, email, segment, captured_at, price_tier FROM leads WHERE segment = ? ORDER BY captured_at DESC LIMIT 200',
          )
          .bind(segment)
          .all<Record<string, unknown>>()
      : await this.db
          .prepare(
            'SELECT id, email, segment, captured_at, price_tier FROM leads ORDER BY captured_at DESC LIMIT 200',
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
          c.post_count ?? c.raw_signals?.length ?? 0,
          c.discovery_score ?? 0,
          c.income_est ?? null,
          c.has_deadline ? 1 : 0,
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

    const candidates: DiscoveryCandidate[] = (results ?? []).map((r) => {
      const profile = r['profile'] as string;
      const slug = profileToSlug(profile);
      return {
      segment:         slug,
      label:           profile,
      pain_summary:    r['pain'] as string,
      discovery_score: r['discovery_score'] as number,
      source_urls:     parseJson<string[]>(r['source_urls'], []),
      raw_signals:     parseJson<string[]>(r['keywords'], []),
      post_count:      (r['post_count'] as number) ?? 0,
      income_est:      (r['income_est'] as string | null),
      has_deadline:    r['has_deadline'] === 1 || r['has_deadline'] === true,
      discovered_at:   r['discovered_at'] as string,
      };
    });

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
        const key = profileToSlug(profile);
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

  async hasCandidates(): Promise<boolean> {
    const row = await this.db.prepare('SELECT COUNT(*) as n FROM discovery_candidates').first<{ n: number }>();
    return (row?.n ?? 0) > 0;
  }

  // ── Extra methods (used by index.ts routing) ─────────────────────────────

  async updateOpportunityStatus(segment: string, status: string, now: string): Promise<void> {
    await this.db
      .prepare('UPDATE opportunities SET status = ?, last_updated = ? WHERE segment = ?')
      .bind(status, now, segment)
      .run();
  }

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

  async getLandingHtml(segment: string, pageSlug = 'index'): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT html FROM landing_pages WHERE segment = ? AND page_slug = ?')
      .bind(segment, pageSlug)
      .first<Record<string, unknown>>();
    return row ? (row['html'] as string) : null;
  }

  async listLandingPages(segment: string): Promise<Array<{
    page_slug: string;
    title: string | null;
    deployed_at: string;
    copy: { headline: string; subheadline: string; pain_points: string[]; cta: string } | null;
  }>> {
    const { results } = await this.db
      .prepare('SELECT page_slug, title, deployed_at, copy FROM landing_pages WHERE segment = ? ORDER BY deployed_at DESC')
      .bind(segment)
      .all<Record<string, unknown>>();
    return (results ?? []).map(r => ({
      page_slug:   r['page_slug'] as string,
      title:       (r['title'] as string | null) ?? null,
      deployed_at: r['deployed_at'] as string,
      copy:        r['copy'] ? JSON.parse(r['copy'] as string) : null,
    }));
  }

  async deleteLandingPage(segment: string, pageSlug: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM landing_pages WHERE segment = ? AND page_slug = ?')
      .bind(segment, pageSlug)
      .run();
  }

  async saveLanding(
    segment: string,
    pageSlug: string,
    html: string,
    copy: { headline: string; subheadline: string; pain_points: string[]; cta: string } | null,
    title: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO landing_pages (segment, page_slug, html, copy, title, deployed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(segment, page_slug) DO UPDATE SET
          html=excluded.html, copy=excluded.copy, title=excluded.title, deployed_at=excluded.deployed_at
      `)
      .bind(segment, pageSlug, html, copy ? JSON.stringify(copy) : null, title, now)
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
    analyzed_count: number;
  }> {
    const [sigRow, oppRow, leadRow, analyzedRow] = await Promise.all([
      this.db.prepare('SELECT COUNT(*) as n FROM signals').first<Record<string, unknown>>(),
      this.db.prepare('SELECT COUNT(*) as n FROM opportunities').first<Record<string, unknown>>(),
      this.db.prepare('SELECT COUNT(*) as n FROM leads').first<Record<string, unknown>>(),
      this.db.prepare('SELECT COUNT(*) as n FROM signals WHERE friction_analysis IS NOT NULL').first<Record<string, unknown>>(),
    ]);
    return {
      signals:        (sigRow?.['n']      as number) ?? 0,
      opportunities:  (oppRow?.['n']      as number) ?? 0,
      leads:          (leadRow?.['n']     as number) ?? 0,
      analyzed_count: (analyzedRow?.['n'] as number) ?? 0,
    };
  }

  async getPainProfiles(): Promise<Array<{
    segment: string;
    problem_type: string;
    intensity: number;
    pain_summary: string;
    confidence: number;
    count: number;
  }>> {
    const { results } = await this.db
      .prepare(`
        SELECT
          segment,
          json_extract(friction_analysis, '$.problem_type') as problem_type,
          AVG(json_extract(friction_analysis, '$.intensity')) as intensity,
          json_extract(friction_analysis, '$.pain_summary') as pain_summary,
          AVG(json_extract(friction_analysis, '$.confidence')) as confidence,
          COUNT(*) as count
        FROM signals
        WHERE friction_analysis IS NOT NULL
        GROUP BY segment, json_extract(friction_analysis, '$.pain_summary')
        ORDER BY segment, intensity DESC
        LIMIT 100
      `)
      .all<Record<string, unknown>>();
    return (results ?? []).map(r => ({
      segment:      (r['segment']      as string | null) ?? '',
      problem_type: (r['problem_type'] as string | null) ?? 'unknown',
      intensity:    Number(r['intensity'])   || 0,
      pain_summary: (r['pain_summary'] as string | null) ?? '',
      confidence:   Number(r['confidence'])  || 0,
      count:        Number(r['count'])       || 0,
    }));
  }

  // ── IMarketTestRepo ──────────────────────────────────────────────────────

  async createMarketTest(id: string, description: string, now: string): Promise<void> {
    await this.db
      .prepare(`INSERT INTO market_tests (id, description, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`)
      .bind(id, description, now, now)
      .run();
  }

  async claimMarketTest(id: string, now: string): Promise<boolean> {
    const result = await this.db
      .prepare(`UPDATE market_tests SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'`)
      .bind(now, id)
      .run();
    return result.meta.changes > 0;
  }

  async updateMarketTestConfig(id: string, config: GnewsSegmentConfig, now: string): Promise<void> {
    await this.db
      .prepare(`UPDATE market_tests SET generated_config = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(config), now, id)
      .run();
  }

  async completeMarketTest(id: string, result: MarketTestResult, now: string): Promise<void> {
    await this.db
      .prepare(`UPDATE market_tests SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(result), now, id)
      .run();
  }

  async failMarketTest(id: string, error: string, now: string): Promise<void> {
    await this.db
      .prepare(`UPDATE market_tests SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
      .bind(error, now, id)
      .run();
  }

  async getMarketTest(id: string): Promise<MarketTest | null> {
    const row = await this.db
      .prepare(`SELECT * FROM market_tests WHERE id = ?`)
      .bind(id)
      .first<{
        id: string; description: string; generated_config: string | null;
        status: string; result: string | null; error: string | null;
        created_at: string; updated_at: string;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      description: row.description,
      generated_config: row.generated_config ? (JSON.parse(row.generated_config) as GnewsSegmentConfig) : null,
      status: row.status as MarketTest['status'],
      result: row.result ? (JSON.parse(row.result) as MarketTestResult) : null,
      error: row.error,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // ── ICollectorHealthRepo ─────────────────────────────────────────────────

  async upsertHealth(stat: CollectorStat, runAt: string): Promise<void> {
    await this.db
      .prepare(
        'INSERT OR REPLACE INTO collector_health (collector_id, last_run_at, signal_count, error) VALUES (?, ?, ?, ?)'
      )
      .bind(stat.id, runAt, stat.count, stat.error ?? null)
      .run();
  }

  async getCollectorHealth(): Promise<Array<{
    collector_id:  string;
    last_run_at:   string;
    signal_count:  number;
    error:         string | null;
  }>> {
    const result = await this.db
      .prepare('SELECT collector_id, last_run_at, signal_count, error FROM collector_health ORDER BY collector_id')
      .all<{ collector_id: string; last_run_at: string; signal_count: number; error: string | null }>();
    return result.results;
  }

  // ── ISignalSnapshotRepo ───────────────────────────────────────────────────

  async upsertSnapshot(snapshot: SignalSnapshot): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO signal_snapshots (segment, week, count, avg_pain, solution_ratio)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(segment, week) DO UPDATE SET
          count=excluded.count,
          avg_pain=excluded.avg_pain,
          solution_ratio=excluded.solution_ratio
      `)
      .bind(snapshot.segment, snapshot.week, snapshot.count, snapshot.avg_pain, snapshot.solution_ratio)
      .run();
  }

  async getSnapshots(segment: string, weeksBack: number): Promise<SignalSnapshot[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM signal_snapshots WHERE segment = ? ORDER BY week DESC LIMIT ?`
      )
      .bind(segment, weeksBack)
      .all<Record<string, unknown>>();
    return (results ?? []).map(rowToSnapshot);
  }

  async getLatestSnapshotAllSegments(): Promise<SignalSnapshot[]> {
    const { results } = await this.db
      .prepare(`
        SELECT s.* FROM signal_snapshots s
        INNER JOIN (
          SELECT segment, MAX(week) as max_week FROM signal_snapshots GROUP BY segment
        ) latest ON s.segment = latest.segment AND s.week = latest.max_week
      `)
      .all<Record<string, unknown>>();
    return (results ?? []).map(rowToSnapshot);
  }

  async getGapRadar(limit = 50): Promise<Array<{
    segment:        string;
    avg_pain:       number;
    count:          number;
    solution_ratio: number;
    gap_score:      number | null;
    opportunity_id: string | null;
    has_landing:    boolean;
  }>> {
    const { results } = await this.db
      .prepare(`
        SELECT
          s.segment,
          s.avg_pain,
          s.count,
          s.solution_ratio,
          o.gap_score,
          o.id        AS opportunity_id,
          CASE WHEN lp.segment IS NOT NULL THEN 1 ELSE 0 END AS has_landing
        FROM signal_snapshots s
        INNER JOIN (
          SELECT segment, MAX(week) AS max_week FROM signal_snapshots GROUP BY segment
        ) latest ON s.segment = latest.segment AND s.week = latest.max_week
        LEFT JOIN opportunities o ON o.segment = s.segment
        LEFT JOIN (SELECT DISTINCT segment FROM landing_pages) lp ON lp.segment = s.segment
        ORDER BY COALESCE(o.gap_score, 0) DESC, s.avg_pain DESC
        LIMIT ?
      `)
      .bind(limit)
      .all<Record<string, unknown>>();

    return (results ?? []).map(r => ({
      segment:        r['segment'] as string,
      avg_pain:       r['avg_pain'] as number,
      count:          r['count'] as number,
      solution_ratio: r['solution_ratio'] as number,
      gap_score:      r['gap_score'] as number | null,
      opportunity_id: r['opportunity_id'] as string | null,
      has_landing:    r['has_landing'] === 1,
    }));
  }

  // ── Signal velocity ──────────────────────────────────────────────────────────

  async getSignalVelocity(weeks = 12): Promise<Array<{ week: string; segment: string; count: number }>> {
    const { results } = await this.db
      .prepare(`
        SELECT
          strftime('%Y-W%W', collected_at) AS week,
          segment,
          COUNT(*)                         AS count
        FROM signals
        WHERE collected_at >= date('now', ? || ' days')
        GROUP BY week, segment
        ORDER BY week ASC, count DESC
      `)
      .bind(-(weeks * 7))
      .all<{ week: string; segment: string; count: number }>();
    return results ?? [];
  }

  // ── ICronLogRepo ─────────────────────────────────────────────────────────────

  async insertCronRun(run: CronRun): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO cron_log (id, started_at, trigger) VALUES (?, ?, ?)'
      )
      .bind(run.id, run.started_at, run.trigger)
      .run();
  }

  async finishCronRun(id: string, fields: { fresh_signals: number; analyzed_signals: number; opps_updated: number; error?: string }): Promise<void> {
    await this.db
      .prepare(
        'UPDATE cron_log SET finished_at = ?, fresh_signals = ?, analyzed_signals = ?, opps_updated = ?, error = ? WHERE id = ?'
      )
      .bind(new Date().toISOString(), fields.fresh_signals, fields.analyzed_signals, fields.opps_updated, fields.error ?? null, id)
      .run();
  }

  async getRecentCronRuns(limit = 5): Promise<CronRun[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM cron_log ORDER BY started_at DESC LIMIT ?')
      .bind(limit)
      .all<Record<string, unknown>>();
    return (results ?? []).map(r => ({
      id:               r['id'] as string,
      started_at:       r['started_at'] as string,
      finished_at:      (r['finished_at'] as string | null) ?? null,
      trigger:          (r['trigger'] as 'scheduled' | 'manual') ?? 'scheduled',
      fresh_signals:    (r['fresh_signals'] as number | null) ?? null,
      analyzed_signals: (r['analyzed_signals'] as number | null) ?? null,
      opps_updated:     (r['opps_updated'] as number | null) ?? null,
      error:            (r['error'] as string | null) ?? null,
    }));
  }
}
