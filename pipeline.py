"""
pipeline.py

Orquestador principal del ciclo completo de market intelligence.
  collect → score → synthesize copy → generate landing → deploy → notify

Diseñado para cron diario. Idempotente: sólo regenera si el score
cambió significativamente o si se fuerza con --force.

Uso:
  python pipeline.py                      # ciclo completo, todos los segmentos
  python pipeline.py --skip-collect       # sólo score → generate → deploy
  python pipeline.py --segment dentista   # un segmento concreto
  python pipeline.py --dry-run            # sin deploy ni escrituras a DB
  python pipeline.py --force              # regenera aunque el score no haya cambiado
  python pipeline.py --threshold 6.5      # umbral custom de score para trigger

Cron sugerido:
  0 8 * * 1   cd /srv/market-intel && python pipeline.py >> logs/pipeline.log 2>&1
"""

import sys
import json
import logging
import argparse
from datetime import datetime
from pathlib import Path

# Cargar .env si existe y python-dotenv está instalado
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent))

from schema import SEGMENTS, ALERT_SCORE_THRESHOLD
from db.database import init_db, get_signals, get_opportunities, upsert_opportunity
from scoring import scorer
from synthesize import synthesize_copy
from generate_landing import generate_landing_html
import deploy as deploy_mod

Path("logs").mkdir(exist_ok=True)

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [pipeline] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("logs/pipeline.log"),
    ],
)

# Score delta mínimo para considerar que vale la pena regenerar
_SCORE_DELTA_THRESHOLD = 0.5


def _collect(segments: list[str] | None):
    from collectors.run_all import run as run_all
    try:
        return run_all(segments=segments)
    except Exception as e:
        log.error(f"Collect falló: {e}")
        return {}


def _synthesize_with_fallback(segment: str, signals: list[dict]) -> dict:
    """
    Intenta sintetizar copy con Claude.
    Si falla (sin API key, error de red, JSON roto), retorna dict vacío
    y generate_landing_html usará SECTOR_COPY como fallback automático.
    """
    if not signals:
        log.warning(f"  Sin señales — usando SECTOR_COPY para '{segment}'")
        return {}
    try:
        return synthesize_copy(segment, signals)
    except Exception as e:
        log.warning(f"  Síntesis falló ({e}) — usando SECTOR_COPY como fallback")
        return {}


def _update_opportunity_landing(segment: str, url: str, score: float):
    """Actualiza landing_url y status='testing' en la oportunidad existente."""
    existing = next((o for o in get_opportunities() if o["segment"] == segment), None)
    if not existing:
        log.warning(f"  Oportunidad '{segment}' no encontrada en DB — skip update")
        return

    from schema import Opportunity

    alerted_at = None
    if existing.get("telegram_alerted_at"):
        try:
            alerted_at = datetime.fromisoformat(existing["telegram_alerted_at"])
        except (ValueError, TypeError):
            pass

    opp = Opportunity(
        id=existing["id"],
        segment=segment,
        pain_summary=existing.get("pain_summary", ""),
        score=score,
        score_breakdown=json.loads(existing["score_breakdown"])
            if isinstance(existing.get("score_breakdown"), str) else (existing.get("score_breakdown") or {}),
        signal_ids=json.loads(existing["signal_ids"])
            if isinstance(existing.get("signal_ids"), str) else [],
        signal_count=existing.get("signal_count", 0),
        first_seen=datetime.fromisoformat(existing["first_seen"]),
        last_updated=datetime.utcnow(),
        status="testing",
        landing_url=url,
        emails_captured=existing.get("emails_captured", 0) or 0,
        telegram_alerted_at=alerted_at,
    )
    upsert_opportunity(opp)


def run(
    segments: list[str] | None = None,
    skip_collect: bool = False,
    dry_run: bool = False,
    force: bool = False,
    score_threshold: float = ALERT_SCORE_THRESHOLD,
) -> list[dict]:

    init_db()
    target = segments or list(SEGMENTS.keys())

    log.info(f"\n{'='*55}")
    log.info(f"PIPELINE START — {datetime.utcnow().isoformat()}")
    log.info(f"  segments={target}")
    log.info(f"  skip_collect={skip_collect}  dry_run={dry_run}  force={force}")
    log.info(f"  threshold={score_threshold}")
    log.info(f"{'='*55}\n")

    # ── 1. Collect ──────────────────────────────────────────────────────────
    if not skip_collect:
        log.info("── FASE 1: Collect ──")
        _collect(segments=target)
    else:
        log.info("── FASE 1: Collect OMITIDO ──")

    # ── 2. Score ─────────────────────────────────────────────────────────────
    log.info("\n── FASE 2: Score ──")
    scored = scorer.run(segments=target, dry_run=dry_run)

    # ── 3. Generate + Deploy ─────────────────────────────────────────────────
    log.info("\n── FASE 3: Generate + Deploy ──")

    existing_opps = {o["segment"]: o for o in get_opportunities()}
    deployed: list[dict] = []

    for result in scored:
        seg   = result["segment"]
        score = result["score"]

        if score < score_threshold:
            log.info(f"  Skip {seg} (score={score:.1f} < umbral={score_threshold})")
            continue

        existing       = existing_opps.get(seg, {})
        prev_score     = existing.get("score", 0.0) or 0.0
        has_landing    = bool(existing.get("landing_url"))
        score_improved = abs(score - prev_score) >= _SCORE_DELTA_THRESHOLD

        if has_landing and not force and not score_improved:
            log.info(f"  Skip {seg} (Δscore={abs(score-prev_score):.2f} < {_SCORE_DELTA_THRESHOLD}, landing ya existe)")
            continue

        log.info(f"\n  ── {seg} (score={score:.1f}) ──")

        # 3a. Synthesize copy desde señales reales
        signals = get_signals(segment=seg, limit=50)
        copy    = _synthesize_with_fallback(seg, signals)

        # 3b. Generate HTML — copy vacío → generate_landing_html usa SECTOR_COPY
        _, html_path = generate_landing_html(seg, **copy)
        log.info(f"    HTML: {html_path.name}")

        # 3c. Deploy
        url = None
        if not dry_run:
            try:
                url = deploy_mod.deploy(html_path, seg)
                log.info(f"    URL: {url}")
            except Exception as e:
                log.error(f"    Deploy falló: {e}")
        else:
            log.info("    Deploy OMITIDO (dry-run)")

        # 3d. Actualizar DB
        if url and not dry_run:
            _update_opportunity_landing(seg, url, score)

        deployed.append({
            "segment": seg,
            "score":   score,
            "url":     url,
            "copy_synthesized": bool(copy),
        })

    # ── Resumen ──────────────────────────────────────────────────────────────
    log.info(f"\n{'='*55}")
    log.info(f"PIPELINE DONE — {len(deployed)} landing(s) procesadas")
    for d in deployed:
        synth = "✓ synth" if d["copy_synthesized"] else "⚠ fallback"
        log.info(f"  [{d['score']:.1f}] {d['segment']} | {synth} | {d['url'] or 'dry-run'}")
    log.info(f"{'='*55}\n")

    return deployed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Market Intel — Pipeline completo")
    parser.add_argument("--segment",      nargs="+", choices=list(SEGMENTS.keys()))
    parser.add_argument("--skip-collect", action="store_true")
    parser.add_argument("--dry-run",      action="store_true")
    parser.add_argument("--force",        action="store_true",
                        help="Regenera aunque el score no haya cambiado significativamente")
    parser.add_argument("--threshold",    type=float, default=ALERT_SCORE_THRESHOLD,
                        help=f"Score mínimo para trigger (default: {ALERT_SCORE_THRESHOLD})")
    args = parser.parse_args()

    run(
        segments=args.segment,
        skip_collect=args.skip_collect,
        dry_run=args.dry_run,
        force=args.force,
        score_threshold=args.threshold,
    )
