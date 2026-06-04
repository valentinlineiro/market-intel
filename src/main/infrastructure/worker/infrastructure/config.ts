import type { Config } from '../domain/types.js';

// In-memory cache to avoid repeated D1 reads
let cachedConfig: Config | null = null;
let cachedVersion: string | null = null;

export const DEFAULT_CONFIG: Config = {
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
      segments: {
        dentista: {
          label: 'Odontólogo / Clínica dental',
          queries: ['verifactu dentista', 'software dental hacienda', 'facturación electrónica clínica dental', 'RRSIF odontología'],
          keywords: ['verifactu', 'hacienda', 'facturación', 'rrsif', 'multa', 'gestión clínica'],
          salary_mean: 66500,
          income_tier: 'high',
          has_deadline: true,
        },
        docente_universitario: {
          label: 'Docente universitario',
          queries: ['ANECA acreditación universidad', 'sexenio investigación problema', 'Docentia evaluación docente'],
          keywords: ['aneca', 'acreditación', 'sexenio', 'docentia', 'plaza'],
          salary_mean: 42000,
          income_tier: 'medium_high',
          has_deadline: false,
        },
        abogado_autonomo: {
          label: 'Abogado autónomo',
          queries: ['LexNet abogados problema', 'facturación electrónica abogados autónomos'],
          keywords: ['lexnet', 'facturación', 'irpf', 'turno oficio', 'honorarios'],
          salary_mean: 35000,
          income_tier: 'medium_high',
          has_deadline: false,
        },
        arquitecto: {
          label: 'Arquitecto',
          queries: ['visado colegial arquitectos', 'licencia obras ayuntamiento lentitud'],
          keywords: ['visado colegial', 'licencia obras', 'burocracia', 'certificado energético'],
          salary_mean: 28500,
          income_tier: 'medium',
          has_deadline: false,
        },
      },
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
  },
  synthesis_segments: {
    dentista: {
      key: 'dentista',
      label: 'Odontólogo / Clínica dental',
      keywords: ['Verifactu', 'gestión clínica', 'seguros'],
      income_tier: 'high',
      has_deadline: true,
      discovery_score: 0,
    },
    docente_universitario: {
      key: 'docente_universitario',
      label: 'Docente universitario',
      keywords: ['ANECA', 'sexenios', 'burocracia'],
      income_tier: 'medium_high',
      has_deadline: false,
      discovery_score: 0,
    },
    abogado_autonomo: {
      key: 'abogado_autonomo',
      label: 'Abogado autónomo',
      keywords: ['LexNet', 'IVA', 'expedientes'],
      income_tier: 'medium_high',
      has_deadline: false,
      discovery_score: 0,
    },
    arquitecto: {
      key: 'arquitecto',
      label: 'Arquitecto',
      keywords: ['visado', 'presupuestos', 'certificados'],
      income_tier: 'medium',
      has_deadline: false,
      discovery_score: 0,
    },
  },
};

export async function getConfig(db: D1Database): Promise<Config> {
  const row = await db.prepare("SELECT updated_at FROM config WHERE key = 'app'").first() as Record<string, unknown> | null;
  if (row && cachedConfig && cachedVersion === row['updated_at']) {
    return cachedConfig;
  }
  if (row) {
    const full = await db.prepare("SELECT value FROM config WHERE key = 'app'").first() as Record<string, unknown> | null;
    if (full) {
      cachedConfig = JSON.parse(full['value'] as string) as Config;
      cachedVersion = row['updated_at'] as string;
      return cachedConfig;
    }
  }
  return DEFAULT_CONFIG;
}

export async function setConfig(db: D1Database, value: Partial<Config>): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES ('app', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(value), now).run();
  cachedConfig = value as Config;
  cachedVersion = now;
}

export function invalidateCache(): void {
  cachedConfig = null;
  cachedVersion = null;
}
