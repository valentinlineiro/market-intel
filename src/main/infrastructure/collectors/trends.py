import time
import logging
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

import requests

from domain.models import Signal, SignalSource
from infrastructure.collectors.base import build_signal

log = logging.getLogger(__name__)

BASE_URL = "https://news.google.com/rss/search"


def _build_queries(keywords: list[str]) -> list[str]:
    if not keywords:
        return []
    return [
        " ".join(keywords[:3]),
        f"{keywords[0]} España problema",
    ]


def _fetch_rss(keyword: str) -> list[dict]:
    url = f"{BASE_URL}?q={quote_plus(keyword)}&hl=es&gl=ES&ceid=ES:es"
    try:
        r = requests.get(url, timeout=15, headers={"User-Agent": "market-intel/0.1"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
        items = []
        for item in root.findall(".//item")[:10]:
            title = (item.findtext("title") or "").strip()
            desc  = (item.findtext("description") or "").strip()
            link  = (item.findtext("link") or "").strip()
            if title:
                items.append({"text": f"{title}. {desc}".strip(), "url": link})
        return items
    except Exception as e:
        log.error(f"news rss '{keyword}': {e}")
        return []


def collect(segment: str, keywords: list[str]) -> list[Signal]:
    signals: list[Signal] = []
    for query in _build_queries(keywords):
        for item in _fetch_rss(query):
            sig = build_signal(source=SignalSource.GOOGLE_NEWS, segment=segment,
                               text=item["text"], url=item["url"],
                               location="España", keywords=keywords)
            if sig and sig.signal_strength > 0.05:
                signals.append(sig)
        time.sleep(1)
    return signals
