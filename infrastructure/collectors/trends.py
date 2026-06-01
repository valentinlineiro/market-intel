import time
import logging
from datetime import datetime

from domain.models import Signal, SignalSource
from domain.segments import SEGMENTS

log = logging.getLogger(__name__)

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
        session.mount("https://", HTTPAdapter(max_retries=1))
        return TrendReq(hl="es-ES", tz=60, timeout=(10, 25), requests_args={"verify": True})
    except ImportError:
        log.error("pytrends no instalado")
        return None


def _trend_signal_strength(interest: int, spike: bool) -> float:
    base = min(interest / 100, 1.0) * 0.7
    return round(min(base + (0.2 if spike else 0.0), 1.0), 3)


def _collect_keyword(pytrends, segment: str, keyword: str, geo: str) -> Signal | None:
    url_key = f"trends://{geo}/{keyword.replace(' ', '_')}"
    try:
        pytrends.build_payload([keyword], cat=0, timeframe="today 1-m", geo=geo)
        data = pytrends.interest_over_time()
        if data.empty or keyword not in data.columns:
            return None
        series = data[keyword]
        mean_interest = int(series.mean())
        last_interest  = int(series.iloc[-1])
        if mean_interest < 5:
            return None
        spike = last_interest > mean_interest * 1.3
        strength = _trend_signal_strength(mean_interest, spike)
        location = "Andalucía" if geo == GEO_ANDALUCIA else "España"
        trend_desc = (
            f"[Google Trends] '{keyword}' — volumen medio: {mean_interest}/100"
            f"{', PICO reciente: ' + str(last_interest) + '/100' if spike else ''}"
            f" (geo={geo})"
        )
        return Signal(
            source=SignalSource.GOOGLE_TRENDS,
            segment=segment,
            location=location,
            raw_text=trend_desc,
            url=url_key,
            pain_keywords_found=[keyword],
            sentiment_score=-min(mean_interest / 100, 1.0),
            signal_strength=strength,
            has_active_deadline=bool(SEGMENTS[segment].get("active_deadline")),
        )
    except Exception as e:
        log.error(f"trends '{keyword}' [{geo}]: {e}")
        time.sleep(10)
        return None


def collect(segment: str) -> list[Signal]:
    """Returns list of Signal objects — caller persists them."""
    pytrends = _get_pytrends()
    if not pytrends:
        return []

    signals: list[Signal] = []
    for keyword in TREND_KEYWORDS.get(segment, []):
        for geo in [GEO_NATIONAL, GEO_ANDALUCIA]:
            sig = _collect_keyword(pytrends, segment, keyword, geo)
            if sig:
                signals.append(sig)
            time.sleep(5)

    return signals
