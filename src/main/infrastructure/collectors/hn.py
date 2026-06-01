import time
import logging
import requests

from domain.models import Signal, SignalSource
from infrastructure.collectors.base import build_signal

log = logging.getLogger(__name__)

BASE_URL = "https://hn.algolia.com/api/v1/search"


def _build_queries(keywords: list[str]) -> list[str]:
    if not keywords:
        return ["solo professional software pain billing"]
    kw = " ".join(keywords[:3])
    return [
        kw,
        f"{keywords[0]} software problem",
        f"{kw} freelance professional Spain",
    ]


def _fetch(query: str) -> list[dict]:
    try:
        r = requests.get(BASE_URL, params={
            "query": query, "tags": "story,ask_hn,show_hn",
            "hitsPerPage": 20, "numericFilters": "num_comments>2",
        }, timeout=15)
        r.raise_for_status()
        return r.json().get("hits", [])
    except Exception as e:
        log.error(f"HN fetch error ('{query}'): {e}")
        return []


def collect(segment: str, keywords: list[str]) -> list[Signal]:
    signals: list[Signal] = []
    for query in _build_queries(keywords):
        for hit in _fetch(query):
            title = (hit.get("title") or "").strip()
            body  = (hit.get("story_text") or "").strip()
            url   = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}"
            text  = f"{title}\n{body}".strip()
            if not text:
                continue
            sig = build_signal(source=SignalSource.GOOGLE_NEWS, segment=segment,
                               text=text, url=url, keywords=keywords)
            if sig and sig.signal_strength > 0.05:
                signals.append(sig)
        time.sleep(1)
    return signals
