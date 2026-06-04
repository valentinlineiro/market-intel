import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Stats, DiscoveryResult, Opportunity, Config } from '$lib/types.js';

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

  const [statsRes, oppsRes, leadsRes, discoveryRes, configRes] = await Promise.all([
    fetch(`${base}/public/stats`),
    fetch(`${base}/public/opportunities`),
    fetch(`${base}/public/leads`),
    fetch(`${base}/public/discovery`),
    fetch(`${base}/public/config`),
  ]);

  const [statsData, oppsData, leadsData, discoveryData, configData] = await Promise.all([
    safeJson<Stats>(statsRes, { total_signals: 0, total_opportunities: 0, total_leads: 0, top_segment: null }),
    safeJson<{ results: Opportunity[] }>(oppsRes, { results: [] }),
    safeJson<{ total: number; by_segment: Record<string, { email: string; captured_at: string }[]> }>(leadsRes, { total: 0, by_segment: {} }),
    safeJson<DiscoveryResult>(discoveryRes, { candidates: [], discovered_at: null }),
    safeJson<{ config: Config }>(configRes, { config: {} as Config }),
  ]);

  return {
    stats:         statsData,
    opportunities: oppsData.results ?? [],
    leads:         leadsData,
    discovery:     discoveryData,
    config:        configData.config,
  };
};

export const actions: Actions = {
  discover: async ({ platform }) => {
    const env = (platform as App.Platform).env;
    const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/discover`, env, { method: 'POST', body: '{}' });
    if (!res.ok) return { success: false, error: `${res.status}` };
    const data = await res.json() as { run_id: string; candidates: unknown[] };
    return { success: true, count: data.candidates?.length ?? 0 };
  },

  deploy: async ({ request, platform }) => {
    const env      = (platform as App.Platform).env;
    const formData = await request.formData();
    const segment  = formData.get('segment') as string;
    const copy     = JSON.parse(formData.get('copy') as string);
    const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/deploy`, env, {
      method: 'POST',
      body: JSON.stringify({ segment, copy }),
    });
    if (!res.ok) return { success: false, error: `${res.status}` };
    const data = await res.json() as { url: string };
    return { success: true, url: data.url };
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

  logout: async ({ cookies }) => {
    cookies.delete('session', { path: '/' });
    throw redirect(302, '/login');
  },
};
