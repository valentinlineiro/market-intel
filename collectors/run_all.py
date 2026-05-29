"""
collectors/run_all.py

Orquestador de todos los collectors.
Ejecuta en secuencia y persiste resultados en SQLite.

Uso:
  python collectors/run_all.py                    # todos los collectors
  python collectors/run_all.py --only reddit      # solo Reddit
  python collectors/run_all.py --only g2          # solo G2/Capterra
  python collectors/run_all.py --only gnews       # solo Google News
  python collectors/run_all.py --only trends      # solo Google Trends
  python collectors/run_all.py --segments dentista docente_universitario

Cron en VPS Hetzner:
  # Reddit: cada 12h
  0 */12 * * * cd /srv/market-intel && python collectors/run_all.py --only reddit

  # G2/Capterra: lunes 8am
  0 8 * * 1 cd /srv/market-intel && python collectors/run_all.py --only g2

  # Scorer: lunes 9am (tras collectors)
  0 9 * * 1 cd /srv/market-intel && python scoring/scorer.py
"""

import sys
import argparse
import logging
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))

from db.database import init_db, get_stats
from collectors import reddit_collector, g2_collector, gnews_collector, trends_collector

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(Path(__file__).parent.parent / "logs" / "collector.log"),
    ]
)

COLLECTORS = {
    "reddit":  reddit_collector,
    "g2":      g2_collector,
    "gnews":   gnews_collector,
    "trends":  trends_collector,
}


def run(only: list[str] | None = None, segments: list[str] | None = None):
    Path(__file__).parent.parent.joinpath("logs").mkdir(exist_ok=True)
    init_db()

    start = datetime.utcnow()
    log.info(f"\n{'='*50}")
    log.info(f"COLLECT START — {start.isoformat()}")
    log.info(f"{'='*50}")

    active = {k: v for k, v in COLLECTORS.items() if not only or k in only}
    all_results = {}

    for name, module in active.items():
        log.info(f"\n▶ Collector: {name.upper()}")
        try:
            results = module.run(segments=segments)
            all_results[name] = results
        except Exception as e:
            log.error(f"✗ Collector {name} falló: {e}")
            all_results[name] = {"error": str(e)}

    # Stats finales
    stats = get_stats()
    elapsed = (datetime.utcnow() - start).seconds

    log.info(f"\n{'='*50}")
    log.info(f"COLLECT END — {elapsed}s")
    log.info(f"  Total señales en DB: {stats['total_signals']}")
    log.info(f"  Por segmento: {stats['by_segment']}")
    if stats["top_opportunity"]:
        top = stats["top_opportunity"]
        log.info(f"  Top oportunidad: {top['pain_summary']} (score={top['score']})")
    log.info(f"{'='*50}\n")

    return all_results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Market Intel — Run all collectors")
    parser.add_argument("--only", nargs="+", choices=list(COLLECTORS.keys()),
                        help="Collectors a ejecutar")
    parser.add_argument("--segments", nargs="+",
                        help="Segmentos a procesar")
    args = parser.parse_args()
    run(only=args.only, segments=args.segments)
