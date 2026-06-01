import os
import time
import logging
import requests as _requests

from domain.models import Signal, SignalSource
from domain.segments import SEGMENTS
from infrastructure.collectors.base import build_signal

log = logging.getLogger(__name__)

SUBREDDIT_MAP = {
    "dentista": ["odontologia", "Dentistry", "spain", "autonomos", "pymes"],
    "docente_universitario": ["spain", "Andalucia", "universidad", "ciencia", "investigacion"],
    "abogado_autonomo": ["DerechoEspañol", "spain", "autonomos", "Abogados", "LegalAdviceEurope"],
    "arquitecto": ["arquitectura", "spain", "autonomos", "construccion", "reformas"],
}

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
    try:
        r = _requests.get(url, headers=_PUBLIC_HEADERS, timeout=15)
        if r.status_code == 429:
            log.warning("Reddit rate-limited — esperando 60s")
            time.sleep(60)
            r = _requests.get(url, headers=_PUBLIC_HEADERS, timeout=15)
        r.raise_for_status()
        return [child["data"] for child in r.json().get("data", {}).get("children", [])]
    except Exception as e:
        log.error(f"public fetch error ({url}): {e}")
        return []


def get_reddit_client():
    client_id     = os.getenv("REDDIT_CLIENT_ID")
    client_secret = os.getenv("REDDIT_CLIENT_SECRET")
    user_agent    = os.getenv("REDDIT_USER_AGENT", "market-intel/0.1")
    if client_id and client_secret:
        try:
            import praw
            return praw.Reddit(client_id=client_id, client_secret=client_secret, user_agent=user_agent)
        except ImportError:
            log.error("praw no instalado")
    return None


def _process_posts(posts: list[dict], segment: str) -> list[Signal]:
    signals = []
    for post in posts:
        url = f"https://reddit.com{post.get('permalink', '')}"
        full_text = f"{post.get('title', '')}\n{post.get('selftext', '')}"
        sig = build_signal(source=SignalSource.REDDIT, segment=segment, text=full_text, url=url)
        if sig and sig.signal_strength > 0.1:
            signals.append(sig)
    return signals


def collect(segment: str) -> list[Signal]:
    """Returns list of Signal objects — caller persists them."""
    reddit = get_reddit_client()
    signals: list[Signal] = []

    for subreddit in SUBREDDIT_MAP.get(segment, []):
        try:
            if reddit:
                posts_raw = [
                    {"id": p.id, "title": p.title, "selftext": p.selftext, "permalink": p.permalink}
                    for p in reddit.subreddit(subreddit).new(limit=25)
                ]
            else:
                url = f"https://www.reddit.com/r/{subreddit}/new.json?limit=25"
                posts_raw = _public_fetch(url)
            signals.extend(_process_posts(posts_raw, segment))
            time.sleep(2)
        except Exception as e:
            log.error(f"r/{subreddit} ({segment}): {e}")

    for query in SEARCH_QUERIES.get(segment, []):
        try:
            if reddit:
                results = reddit.subreddit("all").search(query, sort="new", time_filter="week", limit=15)
                posts_raw = [
                    {"id": p.id, "title": p.title, "selftext": p.selftext, "permalink": p.permalink}
                    for p in results
                ]
            else:
                import urllib.parse
                q_enc = urllib.parse.quote(query)
                url = f"https://www.reddit.com/search.json?q={q_enc}&sort=new&t=week&limit=15"
                posts_raw = _public_fetch(url)
            signals.extend(_process_posts(posts_raw, segment))
            time.sleep(3)
        except Exception as e:
            log.error(f"search '{query}' ({segment}): {e}")

    return signals
