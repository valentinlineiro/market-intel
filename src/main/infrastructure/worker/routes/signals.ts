/**
 * routes/signals.ts
 *
 * Route handlers for signals (GET /signals, POST /signals, count, debug).
 */

import { D1Repo } from '../infrastructure/db/d1-repo.js';
import { collectGitHub } from '../infrastructure/collectors/github.js';
import { buildRegistry } from '../infrastructure/collectors/registry.js';
import { analyzeFriction } from '../application/friction.js';
import { LLMChain } from '../infrastructure/llm/chain.js';
import { DEFAULT_CONFIG } from '../infrastructure/config.js';
import type { Config, FrictionProfile } from '../domain/types.js';
import type { ISignalRepo } from '../application/ports.js';
import { json, authCors, PUBLIC_CORS } from '../index.js';
import type { Env } from '../index.js';

export async function handleGetSignals(db: D1Database, params: URLSearchParams, cors = PUBLIC_CORS): Promise<Response> {
  const segment = params.get('segment') || null;
  const source  = params.get('source')  || null;
  const q       = params.get('q')       || null;
  const validSorts = new Set(['collected_at', 'signal_strength', 'segment', 'source']);
  const sortCol = validSorts.has(params.get('sort') ?? '') ? params.get('sort')! : 'collected_at';
  const sortDir = params.get('order') === 'asc' ? 'ASC' : 'DESC';
  const limit   = Math.min(Math.max(1, parseInt(params.get('limit') ?? '50') || 50), 200);
  const offset  = Math.max(0, parseInt(params.get('offset') ?? '0') || 0);

  const conds: string[]  = [];
  const vals: unknown[]  = [];
  if (segment) { conds.push('segment = ?');     vals.push(segment); }
  if (source)  { conds.push('source = ?');      vals.push(source); }
  if (q)       { conds.push('raw_text LIKE ?'); vals.push(`%${q}%`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const [countRow, { results }, { results: sourceRows }] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n FROM signals ${where}`).bind(...vals).first<{ n: number }>(),
    db.prepare(`SELECT * FROM signals ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`).bind(...vals, limit, offset).all(),
    db.prepare('SELECT DISTINCT source FROM signals ORDER BY source').all<{ source: string }>(),
  ]);

  return json({ results, total: countRow?.n ?? 0, sources: (sourceRows ?? []).map(r => r.source) }, 200, cors);
}

export async function handleInsertSignal(db: D1Database, signal: Record<string, unknown>, cors = PUBLIC_CORS): Promise<Response> {
  const existing = await db.prepare(
    'SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1'
  ).bind(signal['url'], signal['segment']).first();
  if (existing) return json({ inserted: false, reason: 'duplicate' }, 200, cors);

  await db.prepare(`
    INSERT INTO signals
    (id, source, collected_at, segment, location, raw_text, url,
     pain_keywords, sentiment_score, salary_mean, income_tier,
     signal_strength, has_deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    signal['id'], signal['source'], signal['collected_at'], signal['segment'],
    signal['location'] ?? null,
    (typeof signal['raw_text'] === 'string' ? signal['raw_text'] : '').slice(0, 2000),
    signal['url'],
    JSON.stringify(Array.isArray(signal['pain_keywords']) ? signal['pain_keywords'] : []),
    signal['sentiment_score'] ?? null, signal['salary_mean'] ?? null,
    signal['income_tier'] ?? null, signal['signal_strength'] ?? null,
    signal['has_deadline'] ? 1 : 0,
  ).run();
  return json({ inserted: true }, 200, cors);
}

export async function handleCountSignals(db: D1Database, params: URLSearchParams, cors = PUBLIC_CORS): Promise<Response> {
  const segment = params.get('segment');
  const row = segment
    ? await db.prepare('SELECT COUNT(*) as n FROM signals WHERE segment = ?').bind(segment).first<Record<string, unknown>>()
    : await db.prepare('SELECT COUNT(*) as n FROM signals').first<Record<string, unknown>>();
  return json({ count: row?.['n'] ?? 0 }, 200, cors);
}

// ---------------------------------------------------------------------------
// Debug routes
// ---------------------------------------------------------------------------

export async function handleCollectGithubDebug(env: Env): Promise<Response> {
  const keywords = [
    'verifactu', 'hacienda', 'facturación', 'rrsif', 'multa', 'gestión clínica',
    'aneca', 'acreditación', 'sexenio', 'docentia', 'plaza',
    'lexnet', 'irpf', 'turno oficio', 'honorarios',
    'visado colegial', 'licencia obras', 'burocracia', 'certificado energético',
  ];
  const signals = await collectGitHub(keywords, 'debug', env.GITHUB_TOKEN);
  const ss: number[] = signals.map(s => s.signal_strength ?? 0);
  const buckets: Record<string, number> = { '0-0.2': 0, '0.2-0.4': 0, '0.4-0.6': 0, '0.6-0.8': 0, '0.8-1.0': 0 };
  for (const v of ss) {
    if (v < 0.2) buckets['0-0.2']++;
    else if (v < 0.4) buckets['0.2-0.4']++;
    else if (v < 0.6) buckets['0.4-0.6']++;
    else if (v < 0.8) buckets['0.6-0.8']++;
    else buckets['0.8-1.0']++;
  }
  const avg = ss.length ? (ss.reduce((a, b) => a + b, 0) / ss.length) : 0;
  const top = signals.sort((a, b) => (b.signal_strength ?? 0) - (a.signal_strength ?? 0)).slice(0, 5).map(s => ({
    ss: s.signal_strength ?? 0, kw: s.pain_keywords, sent: s.sentiment_score,
    url: s.url, excerpt: s.raw_text.slice(0, 100),
  }));
  return json({ signal_count: signals.length, ss_mean: avg, ss_distribution: buckets, top }, 200, authCors(env));
}

export async function handleDebugCollectAll(env: Env): Promise<Response> {
  const testCfg: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!testCfg.segments || !Object.keys(testCfg.segments).length) {
    testCfg.segments = {
      dentista: {
        label: 'Dentista',
        queries: ['verifactu dentista'],
        keywords: ['verifactu', 'hacienda', 'facturación', 'rrsif', 'multa'],
        income_tier: 'high',
        has_deadline: true,
      },
    };
  }
  const collectors = buildRegistry(testCfg, env);
  const results: Array<{ id: string; signals: number; error?: string }> = [];
  for (const c of collectors) {
    try {
      const signals = await c.collect();
      results.push({ id: c.id, signals: signals.length });
    } catch (e) {
      results.push({ id: c.id, signals: 0, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
    }
  }
  return json(results, 200, authCors(env));
}

export async function handleDebugFriction(env: Env): Promise<Response> {
  const keywords = [
    'verifactu', 'hacienda', 'facturación', 'rrsif', 'multa', 'gestión clínica',
    'aneca', 'acreditación', 'sexenio', 'docentia', 'plaza',
    'lexnet', 'irpf', 'turno oficio', 'honorarios',
    'visado colegial', 'licencia obras', 'burocracia', 'certificado energético',
  ];
  const signals = await collectGitHub(keywords, 'debug', env.GITHUB_TOKEN);
  const before = signals.map(s => ({ url: s.url, ss: s.signal_strength ?? 0 }));

  const llm = new LLMChain(
    { provider: 'groq', model: 'llama-3.1-8b-instant', temperature: 0.1, max_tokens: 5000 },
    env.GROQ_API_KEY,
    env.OPENROUTER_API_KEY,
    env.NIM_API_KEY,
    env.MISTRAL_API_KEY,
  );

  const captured: Array<{ id: string; strength: number; profile: FrictionProfile }> = [];
  const memRepo: ISignalRepo = {
    save: async () => true,
    get: async () => [],
    getAll: async () => [],
    count: async () => 0,
    updateFriction: async (id, strength, profile) => { captured.push({ id, strength, profile }); },
    getSignalsInRange: async () => [],
    getUnanalyzed: async () => [],
  };

  await analyzeFriction(signals, llm, memRepo);

  const signalMap = new Map(signals.map(s => [s.id, s]));
  const enriched = captured.map(c => {
    const s = signalMap.get(c.id);
    return {
      url: s?.url ?? c.id,
      before: s?.signal_strength ?? 0,
      after: c.strength,
      profile: c.profile,
    };
  });

  const afterAll = enriched.map(e => e.after);
  const afterBuckets: Record<string, number> = { '0-0.2': 0, '0.2-0.4': 0, '0.4-0.6': 0, '0.6-0.8': 0, '0.8-1.0': 0 };
  for (const v of afterAll) {
    if (v < 0.2) afterBuckets['0-0.2']++;
    else if (v < 0.4) afterBuckets['0.2-0.4']++;
    else if (v < 0.6) afterBuckets['0.4-0.6']++;
    else if (v < 0.8) afterBuckets['0.6-0.8']++;
    else afterBuckets['0.8-1.0']++;
  }
  const afterMean = afterAll.length ? (afterAll.reduce((a, b) => a + b, 0) / afterAll.length) : 0;
  return json({
    total_signals: signals.length,
    enriched_count: enriched.length,
    batch_count: Math.ceil(signals.length / 10),
    before_mean: before.length ? (before.reduce((a, b) => a + b.ss, 0) / before.length) : 0,
    after_mean: afterMean,
    after_distribution: afterBuckets,
    detail: enriched.sort((a, b) => b.after - a.after).slice(0, 10),
  }, 200, authCors(env));
}
