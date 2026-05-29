"""
collectors/gnews_collector.py

Colecta señales desde Google News RSS.
Sin autenticación — plain HTTP público.

Cron sugerido: 0 */6 * * *  (cada 6h)
"""

import sys
import time
import logging
import hashlib
from pathlib import Path
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import feedparser
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))

from schema import SignalSource, SEGMENTS
from collectors.base import build_signal, sentiment_score
from db.database import insert_signal, signal_exists, init_db

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [gnews] %(message)s")

GNEWS_BASE = "https://news.google.com/rss/search?hl=es&gl=ES&ceid=ES:es&q={query}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; market-intel/0.1; +https://github.com)",
    "Accept-Language": "es-ES,es;q=0.9",
}

# Queries adicionales por segmento — más específicas que pain_keywords individuales
EXTRA_QUERIES = {
    "dentista": [
        "verifactu dentista",
        "software dental hacienda",
        "facturación electrónica clínica dental",
        "RRSIF odontología",
    ],
    "docente_universitario": [
        "ANECA acreditación universidad",
        "sexenio investigación problema",
        "Docentia evaluación docente",
        "plaza universitaria oposición",
    ],
    "abogado_autonomo": [
        "LexNet abogados problema",
        "facturación electrónica abogados autónomos",
        "turno oficio retribución",
        "notificaciones judiciales electrónicas",
    ],
    "arquitecto": [
        "visado colegial arquitectos",
        "licencia obras ayuntamiento lentitud",
        "certificado energético obligatorio",
        "burocracia arquitectos España",
    ],
}


def _rss_url(query: str) -> str:
    return GNEWS_BASE.format(query=quote_plus(query))


def _parse_date(entry) -> datetime:
    for field in ("published", "updated"):
        raw = entry.get(field)
        if raw:
            try:
                return parsedate_to_datetime(raw).replace(tzinfo=None)
            except Exception:
                pass
    return datetime.now(timezone.utc).replace(tzinfo=None)


def collect_query(segment: str, query: str) -> int:
    """Fetch one Google News RSS query and insert relevant signals."""
    inserted = 0
    url = _rss_url(query)

    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        feed = feedparser.parse(r.content)
    except Exception as e:
        log.error(f"  ✗ gnews fetch '{query}': {e}")
        return 0

    for entry in feed.entries[:20]:
        title   = entry.get("title", "")
        summary = entry.get("summary", "")
        link    = entry.get("link", "")

        # Dedup por hash del título (los links de Google News son redirectores)
        url_key = hashlib.md5(f"{segment}:{title[:80]}".encode()).hexdigest()[:12]
        fake_url = f"gnews://{url_key}"

        if signal_exists(fake_url, segment):
            continue

        full_text = f"{title}. {summary}"
        sig = build_signal(
            source=SignalSource.GOOGLE_NEWS,
            segment=segment,
            text=full_text,
            url=link or fake_url,
            location="España",
        )

        # Para noticias bajamos el umbral: cualquier keyword match vale
        if not sig:
            sent = sentiment_score(full_text)
            # Insertar si el texto es sustancialmente negativo aunque sin keyword exacta
            if sent < -0.03 and len(full_text) > 40:
                from schema import Signal
                sig = Signal(
                    source=SignalSource.GOOGLE_NEWS,
                    segment=segment,
                    location="España",
                    raw_text=full_text,
                    url=link or fake_url,
                    pain_keywords_found=[query],
                    sentiment_score=sent,
                    signal_strength=0.25,
                )

        if sig:
            # Sobreescribir URL con el link real para trazabilidad
            if link:
                sig.url = link
            if insert_signal(sig):
                inserted += 1
                log.info(f"  ✓ [{segment}] {title[:70]} (strength={sig.signal_strength})")

    time.sleep(2)   # cortesía con Google
    return inserted


def run(segments: list[str] | None = None) -> dict:
    init_db()
    target_segments = segments or list(SEGMENTS.keys())
    results = {}

    for segment in target_segments:
        log.info(f"\n── Segmento: {segment} ──")
        total = 0

        # 1. Queries específicas del segmento
        for query in EXTRA_QUERIES.get(segment, []):
            total += collect_query(segment, query)

        # 2. Top pain_keywords individuales como queries
        seg_data = SEGMENTS[segment]
        for kw in seg_data["pain_keywords"][:4]:   # las 4 primeras
            total += collect_query(segment, kw)

        results[segment] = total
        log.info(f"  → {total} señales nuevas para '{segment}'")

    log.info(f"\n✓ Google News collect completado: {results}")
    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Google News RSS collector")
    parser.add_argument("--segments", nargs="+", choices=list(SEGMENTS.keys()))
    args = parser.parse_args()
    run(segments=args.segments)
