"""
collectors/reddit_collector.py

Colecta señales de dolor de Reddit para los 4 segmentos target.
Usa PRAW (Python Reddit API Wrapper).

Credenciales necesarias (.env):
  REDDIT_CLIENT_ID
  REDDIT_CLIENT_SECRET
  REDDIT_USER_AGENT   (ej: "market-intel/0.1 by tu_usuario")

Sin credenciales: usa modo público (rate limit más estricto, funciona igual).

Cron sugerido: */12 * * * *  (cada 12h)
"""

import os
import sys
import time
import logging
import requests as _requests
from pathlib import Path
from datetime import datetime, timezone

# Compatibilidad path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schema import SignalSource, SEGMENTS
from collectors.base import build_signal
from db.database import insert_signal, signal_exists, init_db

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [reddit] %(message)s")


# ── Subreddits por segmento ────────────────────────────────────────────────

SUBREDDIT_MAP = {
    "dentista": [
        "odontologia", "Dentistry", "spain",
        "autonomos", "pymes",
    ],
    "docente_universitario": [
        "spain", "Andalucia", "universidad",
        "ciencia", "investigacion",
    ],
    "abogado_autonomo": [
        "DerechoEspañol", "spain", "autonomos",
        "Abogados", "LegalAdviceEurope",
    ],
    "arquitecto": [
        "arquitectura", "spain", "autonomos",
        "construccion", "reformas",
    ],
}

# Queries de búsqueda adicionales (r/all, geolocalizado)
SEARCH_QUERIES = {
    "dentista":             ["dentista software facturación", "clínica dental hacienda",
                             "verifactu dental", "gestión clínica dental problema"],
    "docente_universitario":["aneca acreditación", "docentia evaluación",
                             "acreditación universidad problema", "sexenio investigación"],
    "abogado_autonomo":     ["abogado autónomo hacienda", "gestoría abogado",
                             "turno oficio problema", "expediente judicial lento"],
    "arquitecto":           ["visado colegial problema", "licencia obra ayuntamiento",
                             "arquitecto autónomo burocracia", "certificado energético"],
}


_PUBLIC_HEADERS = {
    "User-Agent": os.getenv("REDDIT_USER_AGENT", "market-intel/0.1"),
    "Accept": "application/json",
}


def _public_fetch(url: str) -> list[dict]:
    """Hits the Reddit public JSON API. Returns list of post dicts."""
    try:
        r = _requests.get(url, headers=_PUBLIC_HEADERS, timeout=15)
        if r.status_code == 429:
            log.warning("  Reddit rate-limited — esperando 60s")
            time.sleep(60)
            r = _requests.get(url, headers=_PUBLIC_HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()
        return [child["data"] for child in data.get("data", {}).get("children", [])]
    except Exception as e:
        log.error(f"  public fetch error ({url}): {e}")
        return []


def get_reddit_client():
    """Devuelve cliente PRAW si hay credenciales; None para modo público."""
    client_id     = os.getenv("REDDIT_CLIENT_ID")
    client_secret = os.getenv("REDDIT_CLIENT_SECRET")
    user_agent    = os.getenv("REDDIT_USER_AGENT", "market-intel/0.1")

    if client_id and client_secret:
        try:
            import praw
            return praw.Reddit(
                client_id=client_id,
                client_secret=client_secret,
                user_agent=user_agent,
            )
        except ImportError:
            log.error("praw no instalado: pip install praw")

    log.info("Sin credenciales Reddit — usando API pública JSON")
    return None


def _process_posts(posts: list[dict], segment: str, subreddit_name: str,
                   reddit_client=None) -> int:
    """Filtra, puntúa e inserta señales de una lista de posts."""
    inserted = 0
    for post in posts:
        url = f"https://reddit.com{post.get('permalink', '')}"
        full_text = f"{post.get('title', '')}\n{post.get('selftext', '')}"

        if signal_exists(url, segment):
            continue

        sig = build_signal(
            source=SignalSource.REDDIT,
            segment=segment,
            text=full_text,
            url=url,
            location="España",
        )
        if sig and sig.signal_strength > 0.1:
            if insert_signal(sig):
                inserted += 1
                log.info(f"  ✓ [{segment}] r/{subreddit_name}: "
                         f"{post.get('title', '')[:60]}... "
                         f"(strength={sig.signal_strength})")

        # Comentarios: solo con cliente PRAW autenticado (API pública no los expone fácil)
        if sig and reddit_client:
            try:
                import praw
                praw_post = reddit_client.submission(id=post.get("id"))
                praw_post.comments.replace_more(limit=0)
                for comment in list(praw_post.comments)[:10]:
                    c_url = url + f"#comment_{comment.id}"
                    if signal_exists(c_url, segment):
                        continue
                    c_sig = build_signal(
                        source=SignalSource.REDDIT,
                        segment=segment,
                        text=comment.body,
                        url=c_url,
                        location="España",
                    )
                    if c_sig and c_sig.signal_strength > 0.15:
                        if insert_signal(c_sig):
                            inserted += 1
            except Exception:
                pass

    return inserted


def collect_subreddit(reddit, segment: str, subreddit_name: str,
                      limit: int = 25) -> int:
    """Escanea posts recientes de un subreddit."""
    try:
        if reddit:
            # PRAW autenticado
            posts_raw = [
                {"id": p.id, "title": p.title, "selftext": p.selftext,
                 "permalink": p.permalink}
                for p in reddit.subreddit(subreddit_name).new(limit=limit)
            ]
        else:
            # API pública JSON
            url = f"https://www.reddit.com/r/{subreddit_name}/new.json?limit={limit}"
            posts_raw = _public_fetch(url)

        inserted = _process_posts(posts_raw, segment, subreddit_name, reddit)
        time.sleep(2)
        return inserted

    except Exception as e:
        log.error(f"  ✗ r/{subreddit_name} ({segment}): {e}")
        return 0


def collect_search(reddit, segment: str, query: str, limit: int = 15) -> int:
    """Búsqueda global en Reddit por query."""
    try:
        if reddit:
            results = reddit.subreddit("all").search(
                query, sort="new", time_filter="week", limit=limit
            )
            posts_raw = [
                {"id": p.id, "title": p.title, "selftext": p.selftext,
                 "permalink": p.permalink}
                for p in results
            ]
        else:
            import urllib.parse
            q_enc = urllib.parse.quote(query)
            url = f"https://www.reddit.com/search.json?q={q_enc}&sort=new&t=week&limit={limit}"
            posts_raw = _public_fetch(url)

        inserted = _process_posts(posts_raw, segment, f"search:{query[:25]}", reddit)
        time.sleep(3)
        return inserted

    except Exception as e:
        log.error(f"  ✗ search '{query}' ({segment}): {e}")
        return 0


def run(segments: list[str] | None = None) -> dict:
    """
    Entry point del collector.
    segments: lista de segmentos a procesar. None = todos.
    """
    init_db()
    reddit = get_reddit_client()   # None = public JSON mode (still valid)

    target_segments = segments or list(SEGMENTS.keys())
    results = {}

    for segment in target_segments:
        log.info(f"\n── Segmento: {segment} ──")
        total = 0

        # 1. Subreddits específicos
        for subreddit in SUBREDDIT_MAP.get(segment, []):
            total += collect_subreddit(reddit, segment, subreddit)

        # 2. Búsquedas por query
        for query in SEARCH_QUERIES.get(segment, []):
            total += collect_search(reddit, segment, query)

        results[segment] = total
        log.info(f"  → {total} señales nuevas para '{segment}'")

    log.info(f"\n✓ Reddit collect completado: {results}")
    return results


if __name__ == "__main__":
    # Ejecución directa: python collectors/reddit_collector.py
    import argparse
    parser = argparse.ArgumentParser(description="Reddit collector")
    parser.add_argument("--segments", nargs="+", choices=list(SEGMENTS.keys()),
                        help="Segmentos a procesar (default: todos)")
    args = parser.parse_args()
    run(segments=args.segments)
