import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Stats, DiscoveryResult, Opportunity, Config, GapEntry, SignalRow, PainProfile, CronRun, CollectorHealth, VelocityRow } from '$lib/types.js';

function workerFetch(url: string, env: App.Platform['env'], init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.WORKER_SECRET}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function safeJson<T>(res: Response, fallback: T): Promise<T> {
  if (!res.ok) return fallback;
  try { return await res.json() as T; } catch { return fallback; }
}

export const load: PageServerLoad = async ({ platform }) => {
  const env  = (platform as App.Platform).env;
  const base = env.WORKER_URL.replace(/\/$/, '');

  const [statsRes, oppsRes, leadsRes, discoveryRes, configRes, pipelineRes, gapRes, signalsRes, painRes, velocityRes] = await Promise.all([
    fetch(`${base}/public/stats`),
    fetch(`${base}/public/opportunities`),
    fetch(`${base}/public/leads`),
    fetch(`${base}/public/discovery`),
    fetch(`${base}/public/config`),
    workerFetch(`${base}/pipeline-status`, env),
    workerFetch(`${base}/gap-radar`, env),
    workerFetch(`${base}/signals?limit=200`, env),
    fetch(`${base}/public/pain-profiles`),
    workerFetch(`${base}/stats/velocity?weeks=12`, env),
  ]);

  const [statsData, oppsData, leadsData, discoveryData, configData, pipelineData, gapData, signalsData, painData, velocityData] = await Promise.all([
    safeJson<Stats>(statsRes, { total_signals: 0, total_opportunities: 0, analyzed_count: 0, by_segment: {}, top_opportunity: null }),
    safeJson<{ results: Opportunity[] }>(oppsRes, { results: [] }),
    safeJson<{ total: number; by_segment: Record<string, { email: string; captured_at: string; price_tier: string | null; lead_score: number }[]> }>(leadsRes, { total: 0, by_segment: {} }),
    safeJson<DiscoveryResult>(discoveryRes, { candidates: [], discovered_at: null, run_id: '' }),
    safeJson<{ config: Config }>(configRes, { config: {} as Config }),
    safeJson<{ runs: CronRun[]; collectors: CollectorHealth[] }>(pipelineRes, { runs: [], collectors: [] }),
    safeJson<GapEntry[]>(gapRes, []),
    safeJson<SignalRow[]>(signalsRes, []),
    safeJson<PainProfile[]>(painRes, []),
    safeJson<{ weeks: number; rows: VelocityRow[] }>(velocityRes, { weeks: 12, rows: [] }),
  ]);

  return {
    stats:         statsData,
    opportunities: oppsData.results ?? [],
    leads:         leadsData,
    discovery:     discoveryData,
    config:        configData.config,
    pipeline:      pipelineData,
    gapRadar:      gapData,
    signals:       signalsData,
    painProfiles:  painData,
    velocity:      velocityData.rows,
  };
};

export const actions: Actions = {
  runCron: async ({ platform }) => {
    const env = (platform as App.Platform).env;
    const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/run-cron`, env, { method: 'POST' });
    if (!res.ok) return { success: false, error: `Error ${res.status}` };
    return { success: true };
  },

  deploy: async ({ request, platform }) => {
    const env      = (platform as App.Platform).env;
    const formData = await request.formData();
    const segment  = formData.get('segment') as string;
    const pageSlug = (formData.get('page_slug') as string | null) ?? 'index';
    const rawHtml  = formData.get('html') as string | null;
    const rawCopy  = formData.get('copy') as string | null;
    const body: Record<string, unknown> = { segment, page_slug: pageSlug };
    if (rawHtml)       body.html = rawHtml;
    if (rawCopy)       body.copy = JSON.parse(rawCopy);
    const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/deploy`, env, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return { success: false, error: `${res.status}` };
    const data = await res.json() as { url: string };
    return { success: true, url: data.url };
  },

  deletePage: async ({ request, platform }) => {
    const env      = (platform as App.Platform).env;
    const formData = await request.formData();
    const segment  = formData.get('segment') as string;
    const pageSlug = formData.get('page_slug') as string;
    await workerFetch(
      `${env.WORKER_URL.replace(/\/$/, '')}/pages/${encodeURIComponent(segment)}/${encodeURIComponent(pageSlug)}`,
      env,
      { method: 'DELETE' },
    );
    return { success: true };
  },

  saveConfig: async ({ request, platform }) => {
    const env    = (platform as App.Platform).env;
    const formData = await request.formData();
    const config = JSON.parse(formData.get('config') as string) as Config;
    const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/config`, env, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
    return { success: res.ok };
  },

  changeStatus: async ({ request, platform }) => {
    const env     = (platform as App.Platform).env;
    const fd      = await request.formData();
    const segment = fd.get('segment') as string;
    const status  = fd.get('status') as string;
    const res = await workerFetch(
      `${env.WORKER_URL.replace(/\/$/, '')}/opportunities/${encodeURIComponent(segment)}/status`,
      env,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    );
    return { success: res.ok };
  },

  generateSeed: async ({ request, platform }) => {
    const env  = (platform as App.Platform).env;
    const fd   = await request.formData();
    const desc = fd.get('description') as string;
    const res  = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/generate-seed`, env, {
      method: 'POST',
      body:   JSON.stringify({ description: desc }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      return { success: false, error: err.error ?? `Error ${res.status}` };
    }
    const data = await res.json() as { segments: Record<string, unknown> };
    return { success: true, count: Object.keys(data.segments).length };
  },

  logout: async ({ cookies }) => {
    cookies.delete('session', { path: '/' });
    throw redirect(302, '/login');
  },
};
