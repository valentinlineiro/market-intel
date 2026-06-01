import time
import logging
import hashlib
from typing import Optional

import requests
from bs4 import BeautifulSoup

from domain.models import Signal, SignalSource
from infrastructure.collectors.base import build_signal, sentiment_score

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}

SOFTWARE_MAP = {
    "dentista": [
        ("g2",       "https://www.g2.com/products/clinic-cloud/reviews",         "Clinic Cloud"),
        ("g2",       "https://www.g2.com/products/gesden/reviews",               "Gesden"),
        ("capterra", "https://www.capterra.es/software/133566/clinic-cloud",     "Clinic Cloud ES"),
        ("capterra", "https://www.capterra.es/software/236490/dooq",             "Dooq Dental"),
        ("capterra", "https://www.capterra.es/software/158285/iodontus",         "iOdontus"),
    ],
    "docente_universitario": [
        ("g2",       "https://www.g2.com/products/curriculo-lattes/reviews",     "Lattes/CVN"),
        ("capterra", "https://www.capterra.es/software/168404/beqom",            "Evaluación docente"),
        ("g2",       "https://www.g2.com/products/pure/reviews",                 "Pure (investigación)"),
        ("g2",       "https://www.g2.com/products/research-rabbit/reviews",      "Research Rabbit"),
    ],
    "abogado_autonomo": [
        ("g2",       "https://www.g2.com/products/lexnet/reviews",               "LexNet"),
        ("capterra", "https://www.capterra.es/software/217982/abogados-nube",    "Abogados Nube"),
        ("capterra", "https://www.capterra.es/software/118530/a3lex",            "a3lex"),
    ],
    "arquitecto": [
        ("capterra", "https://www.capterra.es/software/160498/archioffice",      "ArchiOffice"),
        ("capterra", "https://www.capterra.es/software/227896/gestioo",          "Gestioo"),
    ],
}


def _fetch_html(url: str, retries: int = 2) -> Optional[str]:
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                return r.text
            elif r.status_code == 429:
                time.sleep(30 * (attempt + 1))
            else:
                return None
        except Exception as e:
            log.error(f"Fetch error ({url}): {e}")
    return None


def _parse_g2(html: str, product_name: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    reviews = []
    for review_div in soup.find_all("div", {"itemprop": "review"})[:20]:
        rating_el = review_div.find("meta", {"itemprop": "ratingValue"})
        rating = float(rating_el["content"]) if rating_el else 3.0
        if rating > 3.5:
            continue
        cons_section = review_div.find("div", {"data-test": "cons-section"})
        if not cons_section:
            for heading in review_div.find_all(["h3", "h4", "strong"]):
                if any(w in heading.text.lower() for w in ["contra", "desventaja", "cons", "what do you dislike"]):
                    cons_section = heading.find_next_sibling()
                    break
        if cons_section:
            text = cons_section.get_text(strip=True)
            if len(text) > 30:
                url_hash = hashlib.md5(f"{product_name}:{text[:50]}".encode()).hexdigest()[:8]
                reviews.append({"text": f"[{product_name}] CONTRAS: {text}", "url": f"https://www.g2.com/#{url_hash}"})
    return reviews


def _parse_capterra(html: str, product_name: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    reviews = []
    for review_div in soup.find_all("div", class_=lambda c: c and "review" in c.lower())[:20]:
        rating_el = review_div.find("span", {"class": lambda c: c and "rating" in c.lower() if c else False})
        try:
            rating = float(rating_el.get_text(strip=True).split("/")[0]) if rating_el else 3.0
        except (ValueError, AttributeError):
            rating = 3.0
        if rating > 3.5:
            continue
        for heading in review_div.find_all(["h3", "h4", "p", "strong"]):
            if any(w in heading.text.lower() for w in ["contra", "desventaja", "inconveniente", "cons"]):
                cons_el = heading.find_next_sibling(["p", "div"])
                if cons_el:
                    text = cons_el.get_text(strip=True)
                    if len(text) > 30:
                        url_hash = hashlib.md5(f"{product_name}:{text[:50]}".encode()).hexdigest()[:8]
                        reviews.append({"text": f"[{product_name}] CONTRAS: {text}", "url": f"https://www.capterra.es/#{url_hash}"})
                break
    return reviews


def collect(segment: str, keywords: list[str] = None) -> list[Signal]:
    """Returns list of Signal objects — caller persists them."""
    signals: list[Signal] = []
    kw = keywords or []

    for (platform, url, product_name) in SOFTWARE_MAP.get(segment, []):
        html = _fetch_html(url)
        if not html:
            continue

        reviews = _parse_g2(html, product_name) if platform == "g2" else _parse_capterra(html, product_name)

        for review in reviews:
            sig = build_signal(
                source=SignalSource.G2_CAPTERRA,
                segment=segment,
                text=review["text"],
                url=review["url"],
                keywords=kw,
            )
            if not sig:
                sent = sentiment_score(review["text"])
                if sent < -0.05:
                    sig = Signal(
                        source=SignalSource.G2_CAPTERRA,
                        segment=segment,
                        raw_text=review["text"],
                        url=review["url"],
                        pain_keywords_found=[product_name],
                        sentiment_score=sent,
                        signal_strength=0.3,
                    )
            if sig:
                signals.append(sig)

        time.sleep(3)

    return signals
