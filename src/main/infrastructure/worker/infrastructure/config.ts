import type { Config } from '../domain/types.js';

// In-memory cache to avoid repeated D1 reads
let cachedConfig: Config | null = null;
let cachedVersion: string | null = null;

export const DEFAULT_CONFIG: Config = {
  segments: {
    dentista: {
      label: 'Odontólogo / Clínica dental',
      queries: ['verifactu dentista', 'software dental hacienda', 'facturación electrónica clínica dental', 'RRSIF odontología'],
      keywords: ['verifactu', 'hacienda', 'facturación', 'rrsif', 'multa', 'gestión clínica'],
      income_tier: 'high',
      has_deadline: true,
    },
    docente_universitario: {
      label: 'Docente universitario',
      queries: ['ANECA acreditación universidad', 'sexenio investigación problema', 'Docentia evaluación docente'],
      keywords: ['aneca', 'acreditación', 'sexenio', 'docentia', 'plaza'],
      income_tier: 'medium_high',
      has_deadline: false,
    },
    abogado_autonomo: {
      label: 'Abogado autónomo',
      queries: ['LexNet abogados problema', 'facturación electrónica abogados autónomos'],
      keywords: ['lexnet', 'facturación', 'irpf', 'turno oficio', 'honorarios'],
      income_tier: 'medium_high',
      has_deadline: false,
    },
    arquitecto: {
      label: 'Arquitecto',
      queries: ['visado colegial arquitectos', 'licencia obras ayuntamiento lentitud'],
      keywords: ['visado colegial', 'licencia obras', 'burocracia', 'certificado energético'],
      income_tier: 'medium',
      has_deadline: false,
    },
  },
  score: {
    top_n: 10,
    min_score: 5.0,
    dry_run: false,
  },
  llm: {
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    temperature: 0.3,
    max_tokens: 1024,
  },
  discover: {
    max_clusters: 10,
    min_signals: 3,
  },
  notifications: {
    from_email: '',
    to_email: '',
    alert_score_threshold: 7.0,
  },
  collectors: {
    gnews: {
      enabled: true,
      max_results: 15,
    },
    local_news: {
      enabled: true,
      feeds: [
        { url: 'https://www.diariodecadiz.es/rss/', location: 'Cádiz' },
        { url: 'https://www.europasur.es/rss/', location: 'Cádiz' },
        { url: 'https://www.lavozdigital.es/rss/2.0/', location: 'Cádiz' },
      ],
      pain_keywords: [],
    },
    reddit: {
      enabled: true,
      subreddits: ['es', 'spain', 'preguntaespana', 'autonomos', 'freelance'],
    },
    youtube: {
      enabled: true,
      max_videos: 5,
      max_comments_per_video: 20,
    },
    bluesky: {
      enabled: true,
      max_results: 25,
    },
    mastodon: {
      enabled: true,
      instances: ['mastodon.social', 'mastodon.es'],
      max_results: 20,
    },
    hackernews:  { enabled: false, max_results: 30 },
    boe:         { enabled: false },
    boja:        { enabled: false },
    bocas:       { enabled: false },
    betalist:    { enabled: false },
    appsumo:     { enabled: false },
    producthunt: { enabled: false },
    ine:         { enabled: false },
  },
  synthesis_segments: {},
};

export async function getConfig(db: D1Database): Promise<Config> {
  const row = await db.prepare("SELECT value, updated_at FROM config WHERE key = 'app' LIMIT 1").first() as Record<string, unknown> | null;
  if (row && cachedConfig && cachedVersion === row['updated_at']) {
    return cachedConfig;
  }
  if (row) {
    const stored = JSON.parse(row['value'] as string) as Partial<Config>;
    cachedConfig = deepMerge(structuredClone(DEFAULT_CONFIG), stored);
    cachedVersion = row['updated_at'] as string;
    return cachedConfig;
  }
  return DEFAULT_CONFIG;
}

export async function setConfig(db: D1Database, updates: Partial<Config>): Promise<void> {
  const current = await getConfig(db);
  const merged = deepMerge(structuredClone(current), updates);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES ('app', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(merged), now).run();
  cachedConfig = merged;
  cachedVersion = now;
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  for (const key of Object.keys(source) as (keyof T)[]) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
        tgtVal !== null && typeof tgtVal === 'object' && !Array.isArray(tgtVal)) {
      target[key] = deepMerge(tgtVal as object, srcVal as object) as T[keyof T];
    } else if (srcVal !== undefined) {
      target[key] = srcVal as T[keyof T];
    }
  }
  return target;
}

export function invalidateCache(): void {
  cachedConfig = null;
  cachedVersion = null;
}
