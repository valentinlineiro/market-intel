import re
from datetime import datetime

from domain.models import Signal, SignalSource


NEGATIVE_WORDS = {
    "problema", "problemas", "horrible", "fatal", "pésimo", "pésima",
    "imposible", "desesperante", "agotador", "complicado", "complicada",
    "lento", "lenta", "tardísimo", "eterno", "eterna", "burocracia",
    "burocrático", "engorro", "engorroso", "confuso", "confusa",
    "caro", "cara", "carísimo", "multa", "multas", "sanción", "sanciones",
    "coste", "costes", "costazo", "ruinoso",
    "frustrado", "frustrada", "harto", "harta", "agobiado", "agobiada",
    "estresado", "estresada", "queja", "quejas", "odio", "odiar", "caos",
}

NEGATIVE_PHRASES = {
    "no funciona", "no sirve", "un desastre", "no me llega",
    "llevo esperando", "imposible contactar",
}

INTENSIFIERS = {"muy", "super", "demasiado", "increíblemente", "absurdamente"}


def sentiment_score(text: str) -> float:
    text_lower = text.lower()
    words = re.findall(r'\b\w+\b', text_lower)
    neg_count = sum(1 for w in words if w in NEGATIVE_WORDS)
    neg_count += sum(1 for p in NEGATIVE_PHRASES if p in text_lower)
    intensifier_count = sum(1 for w in words if w in INTENSIFIERS)
    raw = -(neg_count + intensifier_count * 0.5) / max(len(words), 1)
    return max(-1.0, raw * 10)


def find_pain_keywords(text: str, keywords: list[str]) -> list[str]:
    text_lower = text.lower()
    return [kw for kw in keywords if kw.lower() in text_lower]


def signal_strength(pain_keywords: list[str], sentiment: float,
                    has_url: bool, text_length: int) -> float:
    kw_score   = min(len(pain_keywords) / 3, 1.0)
    sent_score = min(abs(sentiment), 1.0)
    len_score  = min(text_length / 500, 1.0)
    url_bonus  = 0.1 if has_url else 0.0
    return min(1.0, round(kw_score * 0.45 + sent_score * 0.35 + len_score * 0.15 + url_bonus, 3))


def build_signal(
    source: SignalSource,
    segment: str,
    text: str,
    url: str = "",
    location: str = "España",
    keywords: list[str] | None = None,
) -> Signal | None:
    found = find_pain_keywords(text, keywords or [])
    if not found:
        return None

    score_sent = sentiment_score(text)
    score_str  = signal_strength(found, score_sent, bool(url), len(text))

    return Signal(
        source=source,
        collected_at=datetime.utcnow(),
        segment=segment,
        location=location,
        raw_text=text,
        url=url,
        pain_keywords_found=found,
        sentiment_score=score_sent,
        signal_strength=score_str,
    )
