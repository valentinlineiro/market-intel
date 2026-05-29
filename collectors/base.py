"""
collectors/base.py
Lógica compartida por todos los collectors:
  - Detección de keywords por segmento
  - Scoring de sentimiento
  - Construcción de Signal
"""

import re
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))
from schema import Signal, SignalSource, SEGMENTS


# ── Sentiment simple sin dependencias pesadas ──────────────────────────────

NEGATIVE_WORDS = {
    # Frustración genérica
    "problema", "problemas", "horrible", "fatal", "pésimo", "pésima",
    "imposible", "desesperante", "agotador", "complicado", "complicada",
    "lento", "lenta", "tardísimo", "eterno", "eterna", "burocracia",
    "burocrático", "engorro", "engorroso", "confuso", "confusa",
    # Dinero
    "caro", "cara", "carísimo", "multa", "multas", "sanción", "sanciones",
    "coste", "costes", "costazo", "ruinoso",
    # Emociones
    "frustrado", "frustrada", "harto", "harta", "agobiado", "agobiada",
    "estresado", "estresada", "queja", "quejas", "odio", "odiar", "caos",
}

# Frases multi-palabra — se buscan por substring, no por token
NEGATIVE_PHRASES = {
    "no funciona", "no sirve", "un desastre", "no me llega",
    "llevo esperando", "imposible contactar",
}

INTENSIFIERS = {"muy", "super", "demasiado", "increíblemente", "absurdamente"}


def sentiment_score(text: str) -> float:
    """
    Score simple -1.0 (muy negativo) a 0.0 (neutro/positivo).
    No usa ML — determinista y sin dependencias.
    """
    text_lower = text.lower()
    words = re.findall(r'\b\w+\b', text_lower)

    neg_count = sum(1 for w in words if w in NEGATIVE_WORDS)
    # Frases multi-palabra: substring search directa
    neg_count += sum(1 for p in NEGATIVE_PHRASES if p in text_lower)
    intensifier_count = sum(1 for w in words if w in INTENSIFIERS)

    raw = -(neg_count + intensifier_count * 0.5) / max(len(words), 1)
    return max(-1.0, raw * 10)


def find_pain_keywords(text: str, segment: str) -> list[str]:
    """Devuelve keywords del segmento encontradas en el texto."""
    keywords = SEGMENTS.get(segment, {}).get("pain_keywords", [])
    text_lower = text.lower()
    return [kw for kw in keywords if kw.lower() in text_lower]


def signal_strength(pain_keywords: list[str], sentiment: float,
                    has_url: bool, text_length: int) -> float:
    """
    Score de calidad de la señal 0.0 a 1.0.
    Más keywords + más negativo + texto largo = señal más fuerte.
    """
    kw_score   = min(len(pain_keywords) / 3, 1.0)   # 3+ keywords = máximo
    sent_score = min(abs(sentiment), 1.0)            # más negativo = mejor
    len_score  = min(text_length / 500, 1.0)         # 500+ chars = máximo
    url_bonus  = 0.1 if has_url else 0.0

    return min(1.0, round(
        kw_score * 0.45 + sent_score * 0.35 + len_score * 0.15 + url_bonus,
        3
    ))


def build_signal(
    source: SignalSource,
    segment: str,
    text: str,
    url: str = "",
    location: str = "España",
) -> Signal | None:
    """
    Construye una Signal a partir de texto crudo.
    Devuelve None si no hay keywords relevantes (descarta ruido).
    """
    keywords = find_pain_keywords(text, segment)
    if not keywords:
        return None  # no es relevante para este segmento

    score_sent = sentiment_score(text)
    score_str  = signal_strength(keywords, score_sent, bool(url), len(text))

    return Signal(
        source=source,
        collected_at=datetime.utcnow(),
        segment=segment,
        location=location,
        raw_text=text,
        url=url,
        pain_keywords_found=keywords,
        sentiment_score=score_sent,
        signal_strength=score_str,
    )
