/**
 * routes/discovery.ts
 *
 * Route handlers for discovery candidates, leads, landing pages, and synthesis.
 */

import { D1Repo, profileToSlug } from '../infrastructure/db/d1-repo.js';
import { computeLeadScore } from '../application/lead-score.js';
import { getConfig, setConfig, invalidateCache } from '../infrastructure/config.js';
import { synthesizeCopy, buildHtml } from '../application/synthesize.js';
import { runFocusedSync } from '../application/cron.js';
import { runDiscovery } from '../application/discover.js';
import { EmailNotifier } from '../infrastructure/notify.js';
import { buildRegistry } from '../infrastructure/collectors/registry.js';
import { collectDiscoveryTexts } from '../infrastructure/text-sources.js';
import { extractJsonArray } from '../domain/llm-json.js';
import { json, makeLlm, hasLlmKey, authCors, PUBLIC_CORS } from '../index.js';
import type { ICronRepos } from '../application/ports.js';
import type { Env } from '../index.js';

export async function handleGetDiscovery(d1repo: D1Repo): Promise<Response> {
  const latest = await d1repo.getLatestCandidates();
  if (!latest) return json({ run_id: null, candidates: [], discovered_at: null });
  const candidates = latest.candidates.map(c => ({
    profile:         c.segment,
    pain:            c.pain_summary,
    keywords:        c.raw_signals,
    post_count:      c.post_count ?? 0,
    discovery_score: c.discovery_score,
    income_est:      c.income_est ?? null,
    has_deadline:    c.has_deadline ?? false,
  }));
  return json({ run_id: null, candidates, discovered_at: latest.discovered_at });
}

export async function handleGetLeads(d1repo: D1Repo, params: URLSearchParams): Promise<Response> {
  const segment = params.get('segment') ?? undefined;
  const [leads, opportunities] = await Promise.all([
    d1repo.getLeads(segment),
    d1repo.getAll(),
  ]);
  const oppScores = new Map<string, number>(
    opportunities.map(o => [o.segment, o.score]),
  );
  const bySegment: Record<string, Array<{
    email: string;
    captured_at: string;
    price_tier: string | null;
    lead_score: number;
  }>> = {};
  for (const r of leads) {
    if (!bySegment[r.segment]) bySegment[r.segment] = [];
    bySegment[r.segment].push({
      email:       r.email,
      captured_at: r.created_at,
      price_tier:  r.price_tier,
      lead_score:  computeLeadScore(r.price_tier, r.created_at, oppScores.get(r.segment) ?? null),
    });
  }
  for (const seg of Object.keys(bySegment)) {
    bySegment[seg].sort((a, b) => b.lead_score - a.lead_score);
  }
  return json({ total: leads.length, by_segment: bySegment });
}

export async function handleGetPainProfiles(d1repo: D1Repo): Promise<Response> {
  const profiles = await d1repo.getPainProfiles();
  return json(profiles);
}

export async function handleGetLandingHtml(d1repo: D1Repo, path: string): Promise<Response> {
  const rest = path.slice('/public/landings/'.length);
  const slashIdx = rest.indexOf('/');
  const segment  = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const pageSlug = slashIdx === -1 ? 'index' : rest.slice(slashIdx + 1);
  if (!segment) return new Response('Not Found', { status: 404 });
  const html = await d1repo.getLandingHtml(segment, pageSlug);
  if (!html) return new Response('Not Found', { status: 404 });
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
}

export async function handlePublicSignup(d1repo: D1Repo, body: { email?: string; segment?: string }): Promise<Response> {
  if (!body.email || !body.segment) {
    return json({ error: 'email and segment required' }, 400);
  }
  await d1repo.saveLead(body.email, body.segment);
  return json({ ok: true });
}

export async function handlePublicSignupPrice(d1repo: D1Repo, body: { email?: string; segment?: string; price_tier?: string }): Promise<Response> {
  const validTiers = ['0-10', '10-30', '30-50', '50+'];
  if (!body.email || !body.segment || !body.price_tier) {
    return json({ error: 'email, segment and price_tier required' }, 400);
  }
  if (!validTiers.includes(body.price_tier)) {
    return json({ error: 'invalid price_tier' }, 400);
  }
  await d1repo.savePriceTier(body.email, body.segment, body.price_tier);
  return json({ ok: true });
}

export async function handleSynthesize(env: Env, body: { segment?: string }): Promise<Response> {
  const cors = authCors(env);
  const { segment } = body;
  if (!segment) return json({ error: 'segment required' }, 400, cors);
  if (!hasLlmKey(env)) {
    return json({ error: 'No LLM key configured (set GROQ_API_KEY, OPENROUTER_API_KEY, NIM_API_KEY, or MISTRAL_API_KEY)' }, 503, cors);
  }
  const cfg = await getConfig(env.DB);
  let segmentConfig = cfg.synthesis_segments[segment];
  if (!segmentConfig) {
    const d1repo = new D1Repo(env.DB);
    const discovery = await d1repo.getLatestCandidates();
    const candidate = discovery?.candidates.find(c => c.segment === segment);
    if (!candidate) return json({ error: `segment '${segment}' not found` }, 404, cors);
    segmentConfig = {
      key:             segment,
      label:           candidate.label ?? segment.replace(/_/g, ' '),
      keywords:        candidate.raw_signals ?? [],
      income_tier:     candidate.income_est ?? 'medium',
      has_deadline:    candidate.has_deadline ?? false,
      discovery_score: candidate.discovery_score,
    };
  }
  const llm = makeLlm(cfg.llm, env);
  const copy = await synthesizeCopy(segment, segmentConfig, llm);
  const html = buildHtml(segment, copy);
  return json({ segment, copy, html }, 200, cors);
}

export async function handleDeploy(env: Env, body: {
  segment?: string;
  page_slug?: string;
  html?: string;
  copy?: { headline?: string; subheadline?: string; pain_points?: string[]; cta?: string };
}): Promise<Response> {
  const cors = authCors(env);
  const { segment, page_slug = 'index' } = body;
  if (!segment) return json({ error: 'segment required' }, 400, cors);
  const copy = body.copy ?? null;
  const html = body.html ?? (copy ? buildHtml(segment, copy as Parameters<typeof buildHtml>[1]) : null);
  if (!html) return json({ error: 'html or copy required' }, 400, cors);
  const now   = new Date().toISOString();
  const title = copy?.headline ?? segment;
  const d1repo = new D1Repo(env.DB);
  await d1repo.saveLanding(segment, page_slug, html, copy as Parameters<typeof d1repo.saveLanding>[3], title);
  const landingUrl = page_slug === 'index'
    ? `https://market-intel.pages.dev/landings/${segment}`
    : `https://market-intel.pages.dev/landings/${segment}/${page_slug}`;
  await d1repo.updateOpportunityLanding(segment, landingUrl, 'testing', now);
  return json({ url: landingUrl }, 200, cors);
}

export async function handleRender(body: {
  segment?: string;
  copy?: Parameters<typeof buildHtml>[1];
}, cors = PUBLIC_CORS): Promise<Response> {
  const { segment, copy } = body;
  if (!segment || !copy) return json({ error: 'segment and copy required' }, 400, cors);
  return json({ html: buildHtml(segment, copy) }, 200, cors);
}

export async function handleListLandingPages(db: D1Database, segment: string, cors = PUBLIC_CORS): Promise<Response> {
  const d1repo = new D1Repo(db);
  const pages = await d1repo.listLandingPages(segment);
  return json({ pages }, 200, cors);
}

export async function handleDeleteLandingPage(db: D1Database, segment: string, pageSlug: string, cors = PUBLIC_CORS): Promise<Response> {
  const d1repo = new D1Repo(db);
  await d1repo.deleteLandingPage(segment, pageSlug);
  return json({ ok: true }, 200, cors);
}

export async function handleGetGapRadar(db: D1Database, cors = PUBLIC_CORS): Promise<Response> {
  const d1repo = new D1Repo(db);
  const rows = await d1repo.getGapRadar(50);
  return json(rows.map(r => ({
    segment:        r.segment,
    label:          r.segment.replace(/_/g, ' '),
    avg_pain:       Math.round(r.avg_pain * 10) / 10,
    solution_ratio: Math.round(r.solution_ratio * 100),
    whitespace:     Math.round((1 - r.solution_ratio) * 100),
    gap_score:      Math.round(r.gap_score ?? 0),
    has_landing:    r.has_landing,
    opportunity_id: r.opportunity_id,
  })), 200, cors);
}

export async function handleSaveDiscoveryCandidates(db: D1Database, body: {
  run_id?: string;
  candidates?: Array<{
    profile?: string;
    pain?: string;
    keywords?: string[];
    post_count?: number;
    discovery_score?: number;
    income_est?: string | null;
    has_deadline?: boolean;
    source?: string;
  }>;
}, cors = PUBLIC_CORS): Promise<Response> {
  const { run_id, candidates } = body;
  if (!run_id || !Array.isArray(candidates) || !candidates.length) {
    return json({ error: 'run_id and non-empty candidates required' }, 400, cors);
  }
  const invalid = candidates.filter(c => !c.profile || !c.pain);
  if (invalid.length) {
    return json({ error: `${invalid.length} candidate(s) missing required profile/pain fields` }, 400, cors);
  }
  const d1repo = new D1Repo(db);
  await d1repo.replaceCandidatesWithRunId(run_id, candidates);
  return json({ saved: candidates.length }, 200, cors);
}

export async function handleDiscoveryPromote(env: Env, ctx: ExecutionContext, body: {
  profile?: string;
  keywords?: string[];
  income_est?: string | null;
  has_deadline?: boolean;
}): Promise<Response> {
  const cors = authCors(env);
  if (!hasLlmKey(env)) return json({ error: 'LLM key not configured' }, 503, cors);
  const { profile, keywords, income_est, has_deadline } = body;
  if (!profile?.trim()) return json({ error: 'profile required' }, 400, cors);

  const cfg = await getConfig(env.DB);
  const slug = profileToSlug(profile);

  if (cfg.segments[slug]) return json({ ok: false, error: 'already_active' }, 409, cors);

  const llm = makeLlm(cfg.llm, env);
  let queries: string[];
  try {
    const raw = await llm.complete(
      `Given this professional profile: "${profile}"\nAnd these pain keywords: ${(keywords ?? []).join(', ')}\nGenerate 2-3 Google News search strings (in Spanish) that would find articles about their specific problems.\nReturn ONLY a JSON array of strings, nothing else.`,
      200,
    );
    const parsed = extractJsonArray(raw);
    queries = Array.isArray(parsed) && parsed.length > 0 ? parsed as string[] : [];
    if (!queries.length) throw new Error('empty');
  } catch {
    queries = [`${profile} problema`, `${profile} España`];
  }

  const newSegment: import('../domain/types.js').MarketSegment = {
    label:        profile,
    queries,
    keywords:     keywords ?? [],
    income_tier:  income_est ?? 'medium',
    has_deadline: has_deadline ?? false,
  };

  await setConfig(env.DB, { segments: { ...cfg.segments, [slug]: newSegment } });
  invalidateCache();

  const runId    = crypto.randomUUID();
  const d1repo   = new D1Repo(env.DB);
  await d1repo.insertCronRun({
    id: runId, started_at: new Date().toISOString(), finished_at: null,
    trigger: 'manual', fresh_signals: null, analyzed_signals: null, opps_updated: null, error: null,
  });

  const repos: ICronRepos = {
    signals: d1repo, opportunities: d1repo, discovery: d1repo,
    collectorHealth: d1repo, cronLog: d1repo, snapshots: d1repo,
  };
  const notifier   = new EmailNotifier(env.EMAIL, cfg.notifications);
  const focusedCfg = { ...cfg, segments: { [slug]: newSegment } };
  const collectors = buildRegistry(focusedCfg, env, []);

  ctx.waitUntil(runFocusedSync(
    repos, llm, notifier, collectors,
    slug, profile, keywords ?? [], income_est ?? 'medium', has_deadline ?? false, runId,
  ));

  return json({ ok: true, segment: slug, run_id: runId }, 200, cors);
}

export async function handleDiscover(env: Env): Promise<Response> {
  const cors = authCors(env);
  if (!hasLlmKey(env)) return json({ error: 'LLM key not configured' }, 503, cors);

  try {
    const cfg = await getConfig(env.DB);
    const discoverCfg = { ...(cfg.discover ?? { max_clusters: 10, min_signals: 3 }) };
    const llm = makeLlm(cfg.llm, env);
    const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);

    const texts = await collectDiscoveryTexts();
    const d1repo = new D1Repo(env.DB);
    const latestCandidates = await d1repo.getLatestCandidates();
    const knownSegments = latestCandidates?.candidates.map(c => c.segment) ?? [];

    const candidates = await runDiscovery(llm, notifier, discoverCfg, texts, knownSegments);

    if (!candidates.length) return json({ run_id: null, candidates: [], message: 'No new segments found' }, 200, cors);

    const run_id = crypto.randomUUID();
    await d1repo.saveCandidates(candidates, run_id);
    return json({ run_id, candidates }, 200, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('discover failed:', msg);
    return json({ error: msg }, 500, cors);
  }
}
