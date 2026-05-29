"""
scoring/scorer.py

Agrega señales → Opportunities con score 0-10.
Aplica reglas kill/scale y dispara alertas Telegram.

Uso:
  python scoring/scorer.py                     # procesa todos los segmentos
  python scoring/scorer.py --segment dentista  # solo un segmento
  python scoring/scorer.py --dry-run           # muestra scores sin guardar

Cron sugerido: 0 9 * * 1  (lunes 9am, tras collectors)
"""

import sys
import os
import json
import logging
import argparse
from pathlib import Path
from datetime import datetime, timedelta, timezone
from collections import defaultdict

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))

from schema import (
    SEGMENTS, Opportunity,
    compute_opportunity_score, income_tier_score, urgency_score,
    SCORE_WEIGHTS,
    KILL_SCORE_THRESHOLD, SCALE_SCORE_THRESHOLD, ALERT_SCORE_THRESHOLD,
)
from db.database import (
    init_db, get_signals, get_signal_count, upsert_opportunity,
    get_opportunities, get_stats,
)

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [scorer] %(message)s")


# ── Normalización de volumen ───────────────────────────────────────────────

# Mayor población Spain = mayor volumen. Normalizar al segmento más grande.
_MAX_POP_SPAIN = max(s["population_spain"] for s in SEGMENTS.values())


def _volume_score(segment_key: str) -> float:
    seg = SEGMENTS.get(segment_key, {})
    pop = seg.get("population_spain", 1)
    return round(min(pop / _MAX_POP_SPAIN, 1.0) * 10, 2)


# Proxy de competencia: definido en schema.SEGMENTS["segment"]["competition_proxy"]
# 10 = sin solución dominante, 0 = mercado saturado.


# ── Dolor: agrega señales del último periodo ──────────────────────────────

def _dolor_score(signals: list[dict], window_days: int = 30) -> tuple[float, str]:
    """
    Calcula score de dolor (0-10) a partir de señales recientes.
    Retorna (score, pain_summary).

    Lógica:
      - Frecuencia: más señales = más dolor (cap en 20 señales para escalar)
      - Intensidad: promedio signal_strength ponderado por sentimiento
      - Recency: señales de la última semana valen doble
    """
    if not signals:
        return 0.0, ""

    cutoff = datetime.utcnow() - timedelta(days=window_days)
    recent = [s for s in signals
              if datetime.fromisoformat(s["collected_at"]) > cutoff]

    if not recent:
        return 0.0, ""

    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)

    freq_score = min(len(recent) / 20, 1.0) * 10

    weighted_strength = 0.0
    total_weight = 0.0
    all_keywords: list[str] = []

    for s in recent:
        age_weight = 2.0 if datetime.fromisoformat(s["collected_at"]) > week_ago else 1.0
        strength = s.get("signal_strength", 0.0) or 0.0
        weighted_strength += strength * age_weight
        total_weight += age_weight

        try:
            kws = json.loads(s.get("pain_keywords", "[]") or "[]")
            all_keywords.extend(kws)
        except (json.JSONDecodeError, TypeError):
            pass

    intensity_score = (weighted_strength / total_weight) * 10 if total_weight else 0

    dolor = round((freq_score * 0.5 + intensity_score * 0.5), 2)

    # Pain summary: keyword más frecuente
    if all_keywords:
        from collections import Counter
        top_kw = Counter(all_keywords).most_common(3)
        pain_summary = f"Dolor en: {', '.join(kw for kw, _ in top_kw)}"
    else:
        pain_summary = f"Señales genéricas ({len(recent)} en {window_days}d)"

    return min(dolor, 10.0), pain_summary


# ── Score principal ────────────────────────────────────────────────────────

def score_segment(segment_key: str, signals: list[dict]) -> Opportunity:
    dolor, pain_summary = _dolor_score(signals)

    breakdown = {
        "dolor":          dolor,
        "capacidad_pago": float(income_tier_score(segment_key)),
        "volumen":        _volume_score(segment_key),
        "competencia":    float(SEGMENTS[segment_key].get("competition_proxy", 5.0)),
        "urgencia":       float(urgency_score(segment_key)),
    }

    score = compute_opportunity_score(breakdown)
    signal_ids = [s["id"] for s in signals[-50:]]  # últimas 50

    # Buscar oportunidad existente para preservar metadata
    existing = next(
        (o for o in get_opportunities() if o["segment"] == segment_key),
        None,
    )

    # signal_count: total real en DB, no limitado por el fetch de scorer
    total_signal_count = get_signal_count(segment=segment_key)

    # telegram_alerted_at: preservar del registro existente
    existing_alerted_at = None
    if existing and existing.get("telegram_alerted_at"):
        try:
            existing_alerted_at = datetime.fromisoformat(existing["telegram_alerted_at"])
        except (ValueError, TypeError):
            pass

    opp = Opportunity(
        id=existing["id"] if existing else Opportunity.__dataclass_fields__["id"].default_factory(),
        segment=segment_key,
        pain_summary=pain_summary or (existing or {}).get("pain_summary", ""),
        score=score,
        score_breakdown=breakdown,
        signal_ids=signal_ids,
        signal_count=total_signal_count,
        first_seen=datetime.fromisoformat(existing["first_seen"]) if existing else datetime.utcnow(),
        last_updated=datetime.utcnow(),
        status=existing["status"] if existing else "watching",
        landing_url=(existing or {}).get("landing_url"),
        emails_captured=(existing or {}).get("emails_captured", 0) or 0,
        telegram_alerted_at=existing_alerted_at,
    )

    return opp


# ── Kill / Scale rules ─────────────────────────────────────────────────────

def apply_kill_scale_rules(opp: Opportunity, window_days: int = 7) -> Opportunity:
    """Actualiza status basado en score y actividad reciente."""
    if opp.status in ("killed", "scaling"):
        return opp  # estado terminal — no cambiar

    # Solo matar si ya tenía historial y lleva más de kill_threshold_days sin señales
    age_days = (datetime.utcnow() - opp.first_seen).days
    stale = opp.signal_count == 0 and age_days >= opp.kill_threshold_days

    if stale and opp.score < KILL_SCORE_THRESHOLD:
        opp.status = "killed"
        log.warning(f"  ☠ KILL: {opp.segment} (score={opp.score}, sin señales {age_days}d)")

    elif opp.score >= SCALE_SCORE_THRESHOLD and opp.emails_captured >= opp.scale_threshold_emails:
        opp.status = "scaling"
        log.info(f"  🚀 SCALE: {opp.segment} (score={opp.score}, emails={opp.emails_captured})")

    return opp


# ── Alertas Telegram ───────────────────────────────────────────────────────

def send_telegram_alert(opp: Opportunity) -> bool:
    """
    Envía alerta Telegram. Retorna True si se envió.
    Anti-spam: no reenvía si ya se alertó en las últimas 24h.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        log.debug("Telegram no configurado — skipping alert")
        return False

    # Anti-spam: no alertar más de una vez por día por oportunidad
    if opp.telegram_alerted_at:
        hours_since = (datetime.utcnow() - opp.telegram_alerted_at).total_seconds() / 3600
        if hours_since < 24:
            log.debug(f"  Telegram skip (alertado hace {hours_since:.1f}h): {opp.segment}")
            return False

    seg = SEGMENTS.get(opp.segment, {})
    label = seg.get("label", opp.segment)
    breakdown = opp.score_breakdown

    lines = [
        f"🎯 *Oportunidad detectada*",
        f"*Segmento:* {label}",
        f"*Score:* {opp.score}/10",
        f"*Dolor:* {breakdown.get('dolor', 0):.1f} | "
        f"*Pago:* {breakdown.get('capacidad_pago', 0):.0f} | "
        f"*Urgencia:* {breakdown.get('urgencia', 0):.0f}",
        f"*Señales:* {opp.signal_count}",
        f"*Resumen:* {opp.pain_summary}",
    ]

    if seg.get("active_deadline"):
        lines.append(f"⚠️ Deadline: {seg['active_deadline']}")

    text = "\n".join(lines)

    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
        if resp.ok:
            log.info(f"  📲 Telegram alert enviado para {opp.segment}")
            return True
        else:
            log.warning(f"  Telegram error: {resp.status_code} {resp.text[:100]}")
            return False
    except Exception as e:
        log.error(f"  Telegram exception: {e}")
        return False


# ── Entry point ────────────────────────────────────────────────────────────

def run(segments: list[str] | None = None, dry_run: bool = False) -> list[dict]:
    """
    Calcula y persiste scores para todos (o los indicados) segmentos.
    Retorna lista de dicts con resultados.
    """
    init_db()
    target_segments = segments or list(SEGMENTS.keys())
    results = []

    log.info(f"\n{'='*50}")
    log.info(f"SCORER START — {datetime.utcnow().isoformat()}")
    log.info(f"{'='*50}")

    for seg_key in target_segments:
        log.info(f"\n── Segmento: {seg_key} ──")

        signals = get_signals(segment=seg_key, limit=500)
        opp = score_segment(seg_key, signals)
        opp = apply_kill_scale_rules(opp)

        seg_label = SEGMENTS[seg_key]["label"]
        log.info(
            f"  Score: {opp.score}/10  "
            f"(dolor={opp.score_breakdown['dolor']:.1f}, "
            f"pago={opp.score_breakdown['capacidad_pago']:.0f}, "
            f"volumen={opp.score_breakdown['volumen']:.1f}, "
            f"comp={opp.score_breakdown['competencia']:.1f}, "
            f"urgencia={opp.score_breakdown['urgencia']:.0f})"
        )
        log.info(f"  Status: {opp.status} | Señales: {opp.signal_count}")
        log.info(f"  Pain: {opp.pain_summary}")

        if not dry_run:
            upsert_opportunity(opp)
            if opp.score >= ALERT_SCORE_THRESHOLD and opp.status == "watching":
                sent = send_telegram_alert(opp)
                if sent:
                    opp.telegram_alerted_at = datetime.utcnow()
                    upsert_opportunity(opp)  # persiste el timestamp de alerta

        results.append({
            "segment": seg_key,
            "label": seg_label,
            "score": opp.score,
            "status": opp.status,
            "signal_count": opp.signal_count,
            "breakdown": opp.score_breakdown,
            "pain_summary": opp.pain_summary,
        })

    # Resumen ordenado
    results.sort(key=lambda r: r["score"], reverse=True)
    log.info(f"\n{'='*50}")
    log.info("RANKING DE OPORTUNIDADES")
    for i, r in enumerate(results, 1):
        log.info(f"  {i}. [{r['score']}/10] {r['label']} — {r['status']}")
    log.info(f"{'='*50}\n")

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Market Intel — Scorer")
    parser.add_argument("--segment", nargs="+", choices=list(SEGMENTS.keys()),
                        help="Segmentos a procesar (default: todos)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Calcula scores sin guardar ni alertar")
    args = parser.parse_args()
    run(segments=args.segment, dry_run=args.dry_run)
