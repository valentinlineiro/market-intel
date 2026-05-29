"""
collectors/g2_collector.py

Colecta reseñas negativas de G2 y Capterra para software usado por los 4 segmentos.

Por qué G2/Capterra:
  - Reseñas de gente que YA PAGA por resolver el problema → dolor con precio probado
  - "Contras" = lista de dolores sin resolver = hipótesis de producto
  - No requiere autenticación — HTML público

Cron sugerido: 0 8 * * 1  (lunes 8am — semanal)
"""

import sys
import time
import logging
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))

from schema import SignalSource, SEGMENTS
from collectors.base import build_signal, sentiment_score
from db.database import insert_signal, signal_exists, init_db

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [g2] %(message)s")


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}

# ── Software target por segmento ──────────────────────────────────────────
# Cada entrada: (plataforma, url_reseñas, nombre_producto)

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
        ("g2",       "https://www.g2.com/categories/legal-practice-management?utf8=✓&order=lowest_rated", "Legal mgmt general"),
    ],
    "arquitecto": [
        ("capterra", "https://www.capterra.es/software/160498/archioffice",      "ArchiOffice"),
        ("g2",       "https://www.g2.com/products/autocad/reviews?filters%5Bnps_score%5D%5B%5D=3", "AutoCAD (bajas notas)"),
        ("capterra", "https://www.capterra.es/software/227896/gestioo",          "Gestioo"),
        ("g2",       "https://www.g2.com/categories/architecture?order=lowest_rated", "Arquitectura general"),
    ],
}


def fetch_html(url: str, retries: int = 2) -> Optional[str]:
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                return r.text
            elif r.status_code == 429:
                wait = 30 * (attempt + 1)
                log.warning(f"  Rate limited — esperando {wait}s")
                time.sleep(wait)
            else:
                log.warning(f"  HTTP {r.status_code} para {url}")
                return None
        except Exception as e:
            log.error(f"  Fetch error ({url}): {e}")
    return None


def parse_g2_reviews(html: str, product_name: str) -> list[dict]:
    """
    Extrae reseñas de G2. Foco en sección 'Contras' (Cons).
    Devuelve lista de {text, url_hash, rating}.
    """
    soup = BeautifulSoup(html, "html.parser")
    reviews = []

    # G2 usa data-test="review" para cada reseña
    for review_div in soup.find_all("div", {"itemprop": "review"})[:20]:
        # Rating
        rating_el = review_div.find("meta", {"itemprop": "ratingValue"})
        rating = float(rating_el["content"]) if rating_el else 3.0

        # Solo reseñas negativas o medias (≤3 estrellas)
        if rating > 3.5:
            continue

        # Sección "Contras"
        cons_section = review_div.find("div", {"data-test": "cons-section"})
        if not cons_section:
            # Fallback: buscar por texto "Desventajas" o "Contras"
            for heading in review_div.find_all(["h3", "h4", "strong"]):
                if any(w in heading.text.lower() for w in ["contra", "desventaja", "cons", "what do you dislike"]):
                    cons_section = heading.find_next_sibling()
                    break

        if cons_section:
            text = cons_section.get_text(strip=True)
            if len(text) > 30:
                url_hash = hashlib.md5(f"{product_name}:{text[:50]}".encode()).hexdigest()[:8]
                reviews.append({
                    "text": f"[{product_name}] CONTRAS: {text}",
                    "url": f"https://www.g2.com/#{url_hash}",
                    "rating": rating,
                })

    return reviews


def parse_capterra_reviews(html: str, product_name: str) -> list[dict]:
    """Extrae reseñas de Capterra. Similar a G2."""
    soup = BeautifulSoup(html, "html.parser")
    reviews = []

    for review_div in soup.find_all("div", class_=lambda c: c and "review" in c.lower())[:20]:
        # Rating
        rating_el = review_div.find("span", {"class": lambda c: c and "rating" in c.lower() if c else False})
        try:
            rating = float(rating_el.get_text(strip=True).split("/")[0]) if rating_el else 3.0
        except (ValueError, AttributeError):
            rating = 3.0

        if rating > 3.5:
            continue

        # Contras
        for heading in review_div.find_all(["h3", "h4", "p", "strong"]):
            if any(w in heading.text.lower() for w in ["contra", "desventaja", "inconveniente", "cons"]):
                cons_el = heading.find_next_sibling(["p", "div"])
                if cons_el:
                    text = cons_el.get_text(strip=True)
                    if len(text) > 30:
                        url_hash = hashlib.md5(f"{product_name}:{text[:50]}".encode()).hexdigest()[:8]
                        reviews.append({
                            "text": f"[{product_name}] CONTRAS: {text}",
                            "url": f"https://www.capterra.es/#{url_hash}",
                            "rating": rating,
                        })
                break

    return reviews


def collect_software(segment: str, platform: str, url: str,
                     product_name: str) -> int:
    """Colecta reseñas de un producto específico."""
    inserted = 0

    log.info(f"  Scraping {platform}: {product_name}")
    html = fetch_html(url)
    if not html:
        return 0

    if platform == "g2":
        reviews = parse_g2_reviews(html, product_name)
    else:
        reviews = parse_capterra_reviews(html, product_name)

    for review in reviews:
        if signal_exists(review["url"], segment):
            continue

        sig = build_signal(
            source=SignalSource.G2_CAPTERRA,
            segment=segment,
            text=review["text"],
            url=review["url"],
            location="España",
        )

        # Para G2/Capterra bajamos el umbral — cualquier reseña negativa vale
        # aunque no tenga keywords del segmento (el contexto ya está dado)
        if not sig:
            # Crear señal directamente si no hay keywords pero el texto tiene valor
            from schema import Signal
            sent = sentiment_score(review["text"])
            if sent < -0.05:
                sig = Signal(
                    source=SignalSource.G2_CAPTERRA,
                    segment=segment,
                    location="España",
                    raw_text=review["text"],
                    url=review["url"],
                    pain_keywords_found=[product_name],
                    sentiment_score=sent,
                    signal_strength=0.3,
                )

        if sig:
            if insert_signal(sig):
                inserted += 1
                log.info(f"    ✓ {review['text'][:80]}...")

    time.sleep(3)  # respetar rate limit
    return inserted


def run(segments: list[str] | None = None) -> dict:
    """Entry point del collector G2/Capterra."""
    init_db()
    target_segments = segments or list(SEGMENTS.keys())
    results = {}

    for segment in target_segments:
        log.info(f"\n── Segmento: {segment} ──")
        total = 0

        for (platform, url, product_name) in SOFTWARE_MAP.get(segment, []):
            total += collect_software(segment, platform, url, product_name)

        results[segment] = total
        log.info(f"  → {total} señales nuevas para '{segment}'")

    log.info(f"\n✓ G2/Capterra collect completado: {results}")
    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="G2/Capterra collector")
    parser.add_argument("--segments", nargs="+", choices=list(SEGMENTS.keys()),
                        help="Segmentos a procesar (default: todos)")
    args = parser.parse_args()
    run(segments=args.segments)
