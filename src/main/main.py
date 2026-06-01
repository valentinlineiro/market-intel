#!/usr/bin/env python
"""main.py — Composition root. Wires infrastructure into use cases and runs pipeline."""
import argparse
import logging
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

from infrastructure.compose import build
from infrastructure.collectors.reddit import collect as reddit_collect
from infrastructure.collectors.trends import collect as trends_collect
from infrastructure.collectors.g2 import collect as g2_collect
from application.pipeline import Pipeline
from domain.segments import SEGMENTS


def main():
    parser = argparse.ArgumentParser(description="market-intel pipeline")
    parser.add_argument("--segment", nargs="+", choices=list(SEGMENTS.keys()))
    parser.add_argument("--skip-collect", action="store_true")
    parser.add_argument("--dry-run",      action="store_true")
    parser.add_argument("--force",        action="store_true")
    parser.add_argument("--threshold",    type=float, default=7.0)
    args = parser.parse_args()

    deps = build(dry_run=args.dry_run)
    pipeline = Pipeline(
        **deps,
        collectors=[reddit_collect, trends_collect, g2_collect],
    )
    pipeline.run(
        segments=args.segment,
        skip_collect=args.skip_collect,
        dry_run=args.dry_run,
        force=args.force,
        threshold=args.threshold,
    )


if __name__ == "__main__":
    main()
