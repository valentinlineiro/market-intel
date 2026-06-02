import { sendTelegram } from "./notify.js";

export const SCORE_WEIGHTS = {
  dolor: 0.30,
  capacidad_pago: 0.25,
  volumen: 0.20,
  competencia: 0.15,
  urgencia: 0.10,
};

export const KILL_SCORE_THRESHOLD = 5.0;
export const SCALE_SCORE_THRESHOLD = 8.0;
export const ALERT_SCORE_THRESHOLD = 7.0;

const SALARY_TIERS = { high: 10, medium_high: 7, medium: 5, low: 2 };
const DEFAULT_COMPETENCIA_SCORE = 5.0;

export function computeOpportunityScore(breakdown) {
  const raw = Object.entries(SCORE_WEIGHTS).reduce(
    (sum, [k, w]) => sum + (breakdown[k] ?? 0) * w, 0
  );
  return Math.round(raw * 100) / 100;
}

export function incomeTierScore(tier) {
  return SALARY_TIERS[tier] ?? 2;
}

export function urgencyScore(hasDeadline) {
  return hasDeadline ? 10 : 0;
}

export function volumeScore(discoveryScore) {
  return Math.round(Math.min(discoveryScore / 20.0, 1.0) * 10 * 100) / 100;
}

export function dolorScore(signals) {
  const now = Date.now();
  const cutoff = now - 30 * 86400000;
  const weekAgo = now - 7 * 86400000;
  const recent = signals.filter(s => new Date(s.collected_at).getTime() > cutoff);
  if (!recent.length) return [0, ""];

  const freqScore = Math.min(recent.length / 20, 1.0) * 10;
  let weighted = 0, totalW = 0;
  const allKw = [];

  for (const s of recent) {
    const w = new Date(s.collected_at).getTime() > weekAgo ? 2.0 : 1.0;
    weighted += (s.signal_strength ?? 0) * w;
    totalW += w;
    let kws = [];
    try { kws = JSON.parse(s.pain_keywords || "[]"); } catch { kws = []; }
    allKw.push(...kws);
  }

  const intensity = totalW ? (weighted / totalW) * 10 : 0;
  const dolor = Math.min(Math.round((freqScore * 0.5 + intensity * 0.5) * 100) / 100, 10.0);

  const kwCount = {};
  for (const kw of allKw) kwCount[kw] = (kwCount[kw] ?? 0) + 1;
  const topKw = Object.entries(kwCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const summary = topKw.length ? `Dolor en: ${topKw.join(", ")}` : `${recent.length} señales recientes`;

  return [dolor, summary];
}

export function applyRules(opp) {
  if (opp.status === "killed" || opp.status === "scaling") return opp;
  const ageDays = (Date.now() - new Date(opp.first_seen).getTime()) / 86400000;
  if ((opp.signal_count ?? 0) === 0 && ageDays >= (opp.kill_threshold_days ?? 7) && opp.score < KILL_SCORE_THRESHOLD) {
    return { ...opp, status: "killed" };
  }
  if (opp.score >= SCALE_SCORE_THRESHOLD && (opp.emails_captured ?? 0) >= (opp.scale_threshold_emails ?? 30)) {
    return { ...opp, status: "scaling" };
  }
  return opp;
}

export function shouldAlert(opp) {
  if (!opp.telegram_alerted_at) return true;
  return (Date.now() - new Date(opp.telegram_alerted_at).getTime()) > 86400000;
}

export function formatAlert(opp, seg) {
  const bd = opp.score_breakdown ?? {};
  const lines = [
    `🎯 *Oportunidad detectada*`,
    `*Segmento:* ${seg.label}`,
    `*Score:* ${opp.score}/10`,
    `*Dolor:* ${(bd.dolor ?? 0).toFixed(1)} | *Pago:* ${(bd.capacidad_pago ?? 0).toFixed(0)} | *Urgencia:* ${(bd.urgencia ?? 0).toFixed(0)}`,
    `*Señales:* ${opp.signal_count}`,
    `*Resumen:* ${opp.pain_summary}`,
  ];
  if (seg.has_deadline) lines.push("⚠️ Deadline activo");
  return lines.join("\n");
}

export async function runScore(env, topN = 10, minScore = 1.0, dryRun = false) {
  const activeSegments = await _buildActiveSegments(env, topN, minScore);
  const results = [];

  for (const seg of activeSegments.values()) {
    const { results: signals } = await env.DB.prepare(
      "SELECT * FROM signals WHERE segment = ? ORDER BY collected_at DESC LIMIT 500"
    ).bind(seg.key).all();
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM signals WHERE segment = ?"
    ).bind(seg.key).first();

    const [dolor, painSummary] = dolorScore(signals ?? []);
    const breakdown = {
      dolor,
      capacidad_pago: incomeTierScore(seg.income_tier),
      volumen: volumeScore(seg.discovery_score),
      competencia: DEFAULT_COMPETENCIA_SCORE,
      urgencia: urgencyScore(seg.has_deadline),
    };
    const score = computeOpportunityScore(breakdown);

    const existing = await env.DB.prepare(
      "SELECT * FROM opportunities WHERE segment = ? LIMIT 1"
    ).bind(seg.key).first();

    const now = new Date().toISOString();
    const opp = {
      id: existing?.id ?? crypto.randomUUID().slice(0, 8),
      segment: seg.key,
      pain_summary: painSummary || existing?.pain_summary || "",
      score,
      score_breakdown: breakdown,
      signal_ids: (signals ?? []).slice(-50).map(s => s.id),
      signal_count: countRow?.n ?? 0,
      first_seen: existing?.first_seen ?? now,
      last_updated: now,
      status: existing?.status ?? "watching",
      landing_url: existing?.landing_url ?? null,
      emails_captured: existing?.emails_captured ?? 0,
      kill_threshold_days: 7,
      scale_threshold_emails: 30,
      telegram_alerted_at: existing?.telegram_alerted_at ?? null,
    };

    const finalOpp = applyRules(opp);

    if (!dryRun) {
      await env.DB.prepare(`
        INSERT INTO opportunities
          (id, segment, pain_summary, score, score_breakdown, signal_ids,
           signal_count, first_seen, last_updated, status, landing_url,
           emails_captured, validation_deadline, telegram_alerted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          score=excluded.score, score_breakdown=excluded.score_breakdown,
          signal_ids=excluded.signal_ids, signal_count=excluded.signal_count,
          last_updated=excluded.last_updated, status=excluded.status,
          emails_captured=excluded.emails_captured, landing_url=excluded.landing_url,
          validation_deadline=excluded.validation_deadline,
          telegram_alerted_at=excluded.telegram_alerted_at
      `).bind(
        finalOpp.id, finalOpp.segment, finalOpp.pain_summary ?? null, finalOpp.score,
        JSON.stringify(finalOpp.score_breakdown), JSON.stringify(finalOpp.signal_ids),
        finalOpp.signal_count, finalOpp.first_seen, finalOpp.last_updated,
        finalOpp.status, finalOpp.landing_url ?? null, finalOpp.emails_captured ?? 0,
        null, finalOpp.telegram_alerted_at ?? null,
      ).run();

      if (finalOpp.score >= ALERT_SCORE_THRESHOLD && finalOpp.status === "watching" && shouldAlert(finalOpp)) {
        const msg = formatAlert(finalOpp, seg);
        const sent = await sendTelegram(env, msg);
        if (sent) {
          await env.DB.prepare(
            "UPDATE opportunities SET telegram_alerted_at = ? WHERE id = ?"
          ).bind(now, finalOpp.id).run();
        }
      }
    }

    results.push({
      segment: seg.key, score: finalOpp.score, status: finalOpp.status,
      signal_count: finalOpp.signal_count, breakdown, pain_summary: finalOpp.pain_summary,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

async function _buildActiveSegments(env, topN, minScore) {
  const segments = new Map();

  const latestRun = await env.DB.prepare(
    "SELECT run_id FROM discovery_candidates ORDER BY id DESC LIMIT 1"
  ).first();

  if (latestRun) {
    const { results: candidates } = await env.DB.prepare(
      `SELECT * FROM discovery_candidates
       WHERE run_id = ? AND discovery_score >= ?
       ORDER BY discovery_score DESC LIMIT ?`
    ).bind(latestRun.run_id, minScore, topN).all();

    for (const c of candidates ?? []) {
      const key = c.profile.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
      segments.set(key, {
        key, label: c.profile,
        keywords: JSON.parse(c.keywords || "[]"),
        income_tier: c.income_est || "medium",
        has_deadline: c.has_deadline === 1,
        discovery_score: c.discovery_score ?? 0,
      });
    }
  }

  const { results: leadSegs } = await env.DB.prepare(
    "SELECT DISTINCT segment FROM leads"
  ).all();
  for (const r of leadSegs ?? []) {
    if (!segments.has(r.segment)) {
      segments.set(r.segment, {
        key: r.segment, label: r.segment, keywords: [],
        income_tier: "medium", has_deadline: false, discovery_score: 0,
      });
    }
  }

  return segments;
}
