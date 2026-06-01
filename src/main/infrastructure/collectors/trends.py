import time
import logging
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

import requests

from domain.models import Signal, SignalSource
from domain.segments import SEGMENTS
from infrastructure.collectors.base import build_signal

log = logging.getLogger(__name__)

BASE_URL = "https://news.google.com/rss/search"

TREND_KEYWORDS: dict[str, list[str]] = {
    "dentista": [
        "verifactu dental",
        "software gestión clínica dental",
        "hacienda facturación dental",
    ],
    "docente_universitario": [
        "aneca acreditación",
        "acreditación universidad",
        "sexenio investigación",
    ],
    "abogado_autonomo": [
        "lexnet problemas",
        "facturación electrónica abogados",
        "software despacho abogados",
    ],
    "arquitecto": [
        "visado colegial arquitecto",
        "licencia obras ayuntamiento",
        "software arquitectura gestión",
    ],
}


def _fetch_rss(keyword: str) -> list[dict]:
    params = f"?q={quote_plus(keyword)}&hl=es&gl=ES&ceid=ES:es"
    url = BASE_URL + params
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


def collect(segment: str) -> list[Signal]:
    signals: list[Signal] = []
    for keyword in TREND_KEYWORDS.get(segment, []):
        for item in _fetch_rss(keyword):
            sig = build_signal(
                source=SignalSource.GOOGLE_NEWS,
                segment=segment,
                text=item["text"],
                url=item["url"],
                location="España",
            )
            if sig and sig.signal_strength > 0.05:
                signals.append(sig)
        time.sleep(1)
    return signals
