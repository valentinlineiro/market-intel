const DEFAULT_CONFIG = {
  score: {
    weights: { dolor: 0.30, capacidad_pago: 0.25, volumen: 0.20, competencia: 0.15, urgencia: 0.10 },
    kill_score_threshold: 5.0,
    scale_score_threshold: 8.0,
    alert_score_threshold: 7.0,
    kill_days: 7,
    scale_emails: 30,
    default_competencia_score: 5.0,
  },
  llm: {
    primary_provider: "groq",
    primary_model: "llama-3.1-8b-instant",
    fallback_provider: "openrouter",
    fallback_model: "anthropic/claude-haiku-4-5",
  },
  discover: {
    text_limit: 30,
    batch_size: 15,
    hn_queries: [
      "solo practitioner software pain billing",
      "freelancer professional bureaucracy",
      "small practice management software problem",
      "professional license permit Spain problem",
    ],
    news_queries: [
      "autónomo España software problema hacienda",
      "profesional liberal burocracia queja",
      "pyme software gestión problema España",
    ],
    known_segments: [
      "Odontólogo / Clínica dental",
      "Docente universitario",
      "Abogado autónomo",
      "Arquitecto",
    ],
  },
  notifications: {
    from: "",
    recipient: "",
    cooldown_hours: 24,
  },
  collectors: {
    gnews_segments: {
      dentista: {
        label: "Odontólogo / Clínica dental",
        queries: ["verifactu dentista", "software dental hacienda", "facturación electrónica clínica dental", "RRSIF odontología"],
        keywords: ["verifactu", "hacienda", "facturación", "rrsif", "multa", "gestión clínica"],
        salary_mean: 66500, income_tier: "high", has_deadline: true,
      },
      docente_universitario: {
        label: "Docente universitario",
        queries: ["ANECA acreditación universidad", "sexenio investigación problema", "Docentia evaluación docente"],
        keywords: ["aneca", "acreditación", "sexenio", "docentia", "plaza"],
        salary_mean: 42000, income_tier: "medium_high", has_deadline: false,
      },
      abogado_autonomo: {
        label: "Abogado autónomo",
        queries: ["LexNet abogados problema", "facturación electrónica abogados autónomos"],
        keywords: ["lexnet", "facturación", "irpf", "turno oficio", "honorarios"],
        salary_mean: 35000, income_tier: "medium_high", has_deadline: false,
      },
      arquitecto: {
        label: "Arquitecto",
        queries: ["visado colegial arquitectos", "licencia obras ayuntamiento lentitud"],
        keywords: ["visado colegial", "licencia obras", "burocracia", "certificado energético"],
        salary_mean: 28500, income_tier: "medium", has_deadline: false,
      },
    },
    local_news: {
      location: "Cádiz",
      feeds: ["https://www.diariodecadiz.es/rss/", "https://www.europasur.es/rss/", "https://www.lavozdigital.es/rss/2.0/"],
    },
  },
  synthesis_segments: {
    dentista:              { label: "Odontólogo / Clínica dental", keywords: ["Verifactu", "gestión clínica", "seguros"],  salary_mean: 65000 },
    docente_universitario: { label: "Docente universitario",       keywords: ["ANECA", "sexenios", "burocracia"],          salary_mean: 42000 },
    abogado_autonomo:      { label: "Abogado autónomo",            keywords: ["LexNet", "IVA", "expedientes"],             salary_mean: 48000 },
    arquitecto:            { label: "Arquitecto",                  keywords: ["visado", "presupuestos", "certificados"],   salary_mean: 44000 },
  },
};

export { DEFAULT_CONFIG };

let cachedConfig = null;
let cachedVersion = null;

export async function getConfig(db) {
  const row = await db.prepare("SELECT updated_at FROM config WHERE key = 'app'").first();
  if (row && cachedConfig && cachedVersion === row.updated_at) {
    return cachedConfig;
  }
  if (row) {
    const full = await db.prepare("SELECT value FROM config WHERE key = 'app'").first();
    if (full) {
      cachedConfig = JSON.parse(full.value);
      cachedVersion = row.updated_at;
      return cachedConfig;
    }
  }
  return DEFAULT_CONFIG;
}

export async function setConfig(db, value) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES ('app', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(value), now).run();
  cachedConfig = value;
  cachedVersion = now;
}

export function invalidateCache() {
  cachedConfig = null;
  cachedVersion = null;
}
