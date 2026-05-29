"""
collectors/trends_collector.py

Colecta datos de Google Trends via pytrends.
Interpreta volumen de búsqueda como proxy de dolor latente.

Lógica:
  - Tendencia creciente en keyword de dolor = mercado que busca solución
  - Pico reciente (última semana > media del mes) → urgencia
  - Geo: ES-AN (Andalucía) para señales locales; ES para nacionales

Cron sugerido: 0 8 * * 1  (lunes 8am — semanal, datos semanales)
"""

import sys
import time
import logging
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

from schema import SignalSource, Signal, SEGMENTS
from db.database import insert_signal, signal_exists, init_db

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [trends] %(message)s")


# Keywords de alta intención por segmento — las más buscadas cuando hay dolor real
TREND_KEYWORDS = {
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

GEO_NATIONAL  = "ES"
GEO_ANDALUCIA = "ES-AN"


def _get_pytrends():
    try:
        from pytrends.request import TrendReq
        import requests
        from requests.adapters import HTTPAdapter

        session = requests.Session()
        session.headers.update({"Accept-Language": "es-ES,es;q=0.9"})
        # urllib3 2.x renamed method_whitelist → allowed_methods; skip retries to avoid the conflict
        session.mount("https://", HTTPAdapter(max_retries=1))

        return TrendReq(hl="es-ES", tz=60, timeout=(10, 25), requests_args={"verify": True})
    except ImportError:
        log.error("pytrends no instalado: pip install pytrends")
        return None


def _trend_signal_strength(interest: int, spike: bool) -> float:
    """
    Convierte volumen de búsqueda (0-100) en signal_strength (0-1).
    Un pico reciente añade 0.2 extra.
    """
    base = min(interest / 100, 1.0) * 0.7
    return round(min(base + (0.2 if spike else 0.0), 1.0), 3)


def collect_keyword(pytrends, segment: str, keyword: str, geo: str) -> int:
    """Obtiene datos de tendencia para una keyword y genera señal si hay volumen."""
    inserted = 0
    url_key = f"trends://{geo}/{keyword.replace(' ', '_')}"

    if signal_exists(url_key, segment):
        log.debug(f"  skip (existe): {keyword} [{geo}]")
        return 0

    try:
        pytrends.build_payload(
            [keyword],
            cat=0,
            timeframe="today 1-m",   # último mes
            geo=geo,
        )
        data = pytrends.interest_over_time()

        if data.empty or keyword not in data.columns:
            log.debug(f"  sin datos: {keyword} [{geo}]")
            return 0

        series = data[keyword]
        mean_interest = int(series.mean())
        last_interest  = int(series.iloc[-1])

        if mean_interest < 5:
            log.debug(f"  volumen bajo ({mean_interest}): {keyword} [{geo}]")
            return 0

        spike = last_interest > mean_interest * 1.3   # pico si última semana +30%
        strength = _trend_signal_strength(mean_interest, spike)

        location = "Andalucía" if geo == GEO_ANDALUCIA else "España"
        trend_desc = (
            f"[Google Trends] '{keyword}' — volumen medio: {mean_interest}/100"
            f"{', PICO reciente: ' + str(last_interest) + '/100' if spike else ''}"
            f" (geo={geo})"
        )

        sig = Signal(
            source=SignalSource.GOOGLE_TRENDS,
            segment=segment,
            location=location,
            raw_text=trend_desc,
            url=url_key,
            pain_keywords_found=[keyword],
            sentiment_score=-min(mean_interest / 100, 1.0),   # más volumen = más dolor implícito
            signal_strength=strength,
            has_active_deadline=bool(SEGMENTS[segment].get("active_deadline")),
        )

        if insert_signal(sig):
            inserted += 1
            spike_tag = " ⚡PICO" if spike else ""
            log.info(
                f"  ✓ [{segment}] '{keyword}' [{geo}] "
                f"vol={mean_interest}{spike_tag} strength={strength}"
            )

        time.sleep(5)   # pytrends necesita pausas para evitar 429

    except Exception as e:
        log.error(f"  ✗ trends '{keyword}' [{geo}]: {e}")
        time.sleep(10)

    return inserted


def run(segments: list[str] | None = None) -> dict:
    init_db()
    pytrends = _get_pytrends()
    if not pytrends:
        return {"error": "pytrends no disponible"}

    target_segments = segments or list(SEGMENTS.keys())
    results = {}

    for segment in target_segments:
        log.info(f"\n── Segmento: {segment} ──")
        total = 0

        for keyword in TREND_KEYWORDS.get(segment, []):
            # Nacional primero, luego Andalucía para señal local
            total += collect_keyword(pytrends, segment, keyword, GEO_NATIONAL)
            total += collect_keyword(pytrends, segment, keyword, GEO_ANDALUCIA)

        results[segment] = total
        log.info(f"  → {total} señales nuevas para '{segment}'")

    log.info(f"\n✓ Trends collect completado: {results}")
    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Google Trends collector")
    parser.add_argument("--segments", nargs="+", choices=list(SEGMENTS.keys()))
    args = parser.parse_args()
    run(segments=args.segments)
