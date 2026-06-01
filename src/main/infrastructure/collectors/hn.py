import time
import logging
import requests

from domain.models import Signal, SignalSource
from domain.segments import SEGMENTS
from infrastructure.collectors.base import build_signal

log = logging.getLogger(__name__)

BASE_URL = "https://hn.algolia.com/api/v1/search"

# Per-segment keyword queries targeting professional pain points in Spanish markets.
# HN is English-dominant, so queries mix English pain terms with Spanish proper nouns.
QUERIES: dict[str, list[str]] = {
    "dentista": [
        "dental practice management software",
        "dental billing invoicing pain",
        "verifactu hacienda facturación",
        "dental clinic software Spain",
    ],
    "docente_universitario": [
        "academic accreditation bureaucracy",
        "university professor tenure Spain",
        "aneca acreditación sexenio",
        "research evaluation Spain university",
    ],
    "abogado_autonomo": [
        "solo lawyer practice management",
        "legal billing invoicing freelance attorney",
        "abogado autónomo hacienda lexnet",
        "law firm software small practice",
    ],
    "arquitecto": [
        "architect freelance software project management",
        "building permit bureaucracy Spain",
        "visado colegial licencia obras",
        "architecture practice management tools",
    ],
}


def _fetch(query: str, tags: str = "story,ask_hn,show_hn") -> list[dict]:
    params = {
        "query": query,
        "tags": tags,
        "hitsPerPage": 20,
        "numericFilters": "num_comments>2",
    }
    try:
        r = requests.get(BASE_URL, params=params, timeout=15)
        r.raise_for_status()
        return r.json().get("hits", [])
    except Exception as e:
        log.error(f"HN fetch error ('{query}'): {e}")
        return []


def collect(segment: str) -> list[Signal]:
    signals: list[Signal] = []
    for query in QUERIES.get(segment, []):
        hits = _fetch(query)
        for hit in hits:
            title = hit.get("title") or ""
            body = hit.get("story_text") or ""
            url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}"
            text = f"{title}\n{body}".strip()
            if not text:
                continue
            sig = build_signal(source=SignalSource.GOOGLE_NEWS, segment=segment, text=text, url=url)
            if sig and sig.signal_strength > 0.05:
                signals.append(sig)
        time.sleep(1)
    return signals
