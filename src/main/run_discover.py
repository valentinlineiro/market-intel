import os
import sys
import logging
from datetime import datetime, timezone

import requests

from infrastructure.llm.chain import LLMChain
from infrastructure.notifications import TelegramNotifier
from application.discover import DiscoverUseCase

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)


def main():
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    uc = DiscoverUseCase(LLMChain(), TelegramNotifier())
    try:
        candidates = uc.run(
            limit=int(os.environ.get("DISCOVER_LIMIT", "100")),
            min_score=float(os.environ.get("DISCOVER_MIN_SCORE", "3.0")),
        )
    except Exception as e:
        log.error(f"Discovery pipeline failed: {e}")
        sys.exit(1)

    worker_url    = os.environ.get("WORKER_URL", "").rstrip("/")
    worker_secret = os.environ.get("WORKER_SECRET", "")

    if candidates and worker_url and worker_secret:
        run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"
        payload = {
            "run_id": run_id,
            "candidates": [
                {
                    "profile":         c["profile"],
                    "pain":            c["pain"],
                    "keywords":        c.get("keywords", []),
                    "post_count":      c.get("post_count", 0),
                    "discovery_score": c.get("discovery_score", 0.0),
                    "income_est":      c.get("income_estimate", None),  # LLM returns 'income_estimate'; Worker expects 'income_est'
                    "has_deadline":    c.get("has_deadline", False),
                    "source":          "reddit",
                }
                for c in candidates
            ],
        }
        try:
            r = requests.post(
                f"{worker_url}/discovery/candidates",
                headers={
                    "Authorization": f"Bearer {worker_secret}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=30,
            )
            r.raise_for_status()
            log.info(f"Saved {r.json().get('saved', 0)} candidates to Worker (run_id={run_id})")
        except Exception as e:
            log.error(f"Failed to save candidates to Worker: {e}")
            sys.exit(1)
    else:
        log.info("Skipping Worker save (no candidates or WORKER_URL/WORKER_SECRET not set)")


if __name__ == "__main__":
    main()
