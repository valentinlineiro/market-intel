#!/usr/bin/env python
"""main.py — Composition root. Fetches active segments from discovery API, runs pipeline."""
import argparse
import logging
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

import requests

from infrastructure.compose import build
from infrastructure.collectors.hn import collect as hn_collect
from infrastructure.collectors.trends import collect as trends_collect
from infrastructure.collectors.g2 import collect as g2_collect
from application.pipeline import Pipeline
from domain.models import ActiveSegment


def fetch_active_segments(worker_url: str, worker_secret: str,
                          top_n: int = 10, min_score: float = 1.0) -> list[ActiveSegment]:
    """Fetch top discovery candidates + segments with open leads from the Worker API."""
    headers = {"Authorization": f"Bearer {worker_secret}"}
    segments: dict[str, ActiveSegment] = {}

    # Top discovery candidates
    try:
        r = requests.get(f"{worker_url}/public/discovery", timeout=15)
        r.raise_for_status()
        for c in (r.json().get("candidates") or [])[:top_n]:
            if float(c.get("discovery_score") or 0) >= min_score:
                seg = ActiveSegment.from_candidate(c)
                segments[seg.key] = seg
        log.info(f"Discovery candidates loaded: {len(segments)}")
    except Exception as e:
        log.error(f"Failed to fetch discovery candidates: {e}")

    # Segments that have captured leads — keep them alive regardless of discovery score
    try:
        r = requests.get(f"{worker_url}/public/leads", timeout=15)
        r.raise_for_status()
        for seg_key in r.json().get("by_segment", {}):
            if seg_key not in segments:
                # Minimal entry — no discovery keywords, but keep scoring
                segments[seg_key] = ActiveSegment(key=seg_key, label=seg_key, has_leads=True)
            else:
                segments[seg_key].has_leads = True
        log.info(f"Total active segments after leads merge: {len(segments)}")
    except Exception as e:
        log.error(f"Failed to fetch leads: {e}")

    return list(segments.values())


def main():
    parser = argparse.ArgumentParser(description="market-intel pipeline")
    parser.add_argument("--skip-collect", action="store_true")
    parser.add_argument("--dry-run",      action="store_true")
    parser.add_argument("--force",        action="store_true")
    parser.add_argument("--threshold",    type=float, default=7.0)
    parser.add_argument("--top-n",        type=int,   default=10)
    parser.add_argument("--min-score",    type=float, default=1.0)
    args = parser.parse_args()

    worker_url    = os.environ.get("WORKER_URL", "").rstrip("/")
    worker_secret = os.environ.get("WORKER_SECRET", "")

    if not worker_url or not worker_secret:
        log.error("WORKER_URL and WORKER_SECRET are required")
        sys.exit(1)

    active_segments = fetch_active_segments(worker_url, worker_secret,
                                            top_n=args.top_n, min_score=args.min_score)

    if not active_segments:
        log.warning("No active segments found — run the discover pipeline first")
        sys.exit(0)

    deps = build(dry_run=args.dry_run)
    pipeline = Pipeline(
        **deps,
        collectors=[hn_collect, trends_collect, g2_collect],
    )
    pipeline.run(
        active_segments=active_segments,
        skip_collect=args.skip_collect,
        dry_run=args.dry_run,
        force=args.force,
        threshold=args.threshold,
    )


if __name__ == "__main__":
    main()
