"""
discover.py

Descubrimiento de segmentos ocultos.

A diferencia de los collectors normales (que confirman dolor en segmentos
ya definidos), este módulo rastrea señales SIN filtro de segmento para
surfear dolores nuevos que no están en schema.py.

Flujo:
  1. Rasca Reddit con queries profesionales genéricas (sin keywords de segmento)
  2. Agrupa posts en batches de 15
  3. LLM clasifica cada batch → clusters {perfil, dolor, keywords}
  4. Agrega clusters entre batches (merge por overlap de keywords)
  5. Rankea por frecuencia × cobertura de batches
  6. Alerta Telegram si hay candidatos por encima del umbral

Uso:
  python discover.py                   # descubrimiento completo
  python discover.py --dry-run         # sin Telegram, imprime candidatos
  python discover.py --limit 80        # posts a recolectar (default: 100)
  python discover.py --min-score 5     # umbral de score para alertar (default: 3)
"""

import os
import sys
import json
import time
import logging
import argparse
import requests
from pathlib import Path
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent))

import llm
from schema import SEGMENTS

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [discover] %(message)s")

# ── Queries amplias — sin filtro de segmento ──────────────────────────────

# Subreddits con alta densidad de profesionales autónomos españoles
BROAD_SUBREDDITS = [
    "autonomos", "pymes", "spain", "emprendimiento",
    "Informatica", "medicina", "veterinaria",
]

# Queries que capturan dolor profesional genérico (no de un segmento concreto)
BROAD_QUERIES = [
    "autónomo software problema España",
    "profesional hacienda burocracia queja",
    "autónomo gestoría cara alternativa",
    "trámites colegio profesional lento",
    "software clínica problema España",
    "facturación electrónica autónomo problema",
    "declaración IVA trimestral complicado",
    "licencia permiso ayuntamiento lento",
    "autónomo herramienta trabajo cara",
    "profesional España queja digitalización",
]

# Segmentos ya cubiertos — el LLM los excluye del output
KNOWN_SEGMENTS = [seg["label"] for seg in SEGMENTS.values()]

_REDDIT_HEADERS = {
    "User-Agent": "market-intel-discover/0.1",
    "Accept":     "application/json",
}

# ── Prompt de clustering ──────────────────────────────────────────────────

CLUSTER_PROMPT = """\
Analiza estos posts de Reddit de comunidades profesionales españolas.
Identifica perfiles profesionales con dolores recurrentes NO incluidos en esta lista ya conocida: {known_segments}.

POSTS:
{posts_text}

Para cada perfil nuevo que detectes con dolor claro, devuelve un objeto JSON:
- "profile": nombre del perfil profesional concreto (ej: "fisioterapeuta", "gestor comunidades de vecinos")
- "pain": descripción del dolor principal en 1 frase corta
- "keywords": lista de 3-6 palabras clave que aparecen en los posts
- "post_count": cuántos posts de los dados corresponden a este perfil
- "income_estimate": "high" (>50k€/año), "medium_high" (30-50k), "medium" (20-30k), "low" (<20k)
- "has_deadline": true si hay urgencia regulatoria o deadline próximo, false si no

Devuelve SOLO un array JSON válido. Si no detectas perfiles nuevos, devuelve [].
Sin texto adicional, sin explicaciones, sin backticks.
"""

# ── Recolección amplia ────────────────────────────────────────────────────

def _fetch_subreddit(subreddit: str, limit: int = 15) -> list[dict]:
    url = f"https://www.reddit.com/r/{subreddit}/new.json?limit={limit}"
    try:
        r = requests.get(url, headers=_REDDIT_HEADERS, timeout=15)
        if r.status_code == 429:
            log.warning(f"  Rate limited en r/{subreddit} — esperando 30s")
            time.sleep(30)
            r = requests.get(url, headers=_REDDIT_HEADERS, timeout=15)
        r.raise_for_status()
        children = r.json().get("data", {}).get("children", [])
        return [c["data"] for c in children]
    except Exception as e:
        log.error(f"  ✗ r/{subreddit}: {e}")
        return []


def _fetch_search(query: str, limit: int = 10) -> list[dict]:
    import urllib.parse
    url = f"https://www.reddit.com/search.json?q={urllib.parse.quote(query)}&sort=new&t=month&limit={limit}"
    try:
        r = requests.get(url, headers=_REDDIT_HEADERS, timeout=15)
        r.raise_for_status()
        children = r.json().get("data", {}).get("children", [])
        time.sleep(2)
        return [c["data"] for c in children]
    except Exception as e:
        log.error(f"  ✗ search '{query[:40]}': {e}")
        return []


def collect_broad(limit: int = 100) -> list[str]:
    """
    Recolecta posts sin filtro de segmento.
    Retorna lista de textos (título + body).
    """
    log.info(f"  Recolectando hasta {limit} posts (broad mode)...")
    raw_posts: list[dict] = []
    seen_ids: set[str] = set()

    # Subreddits
    per_sub = max(10, limit // (len(BROAD_SUBREDDITS) + len(BROAD_QUERIES)))
    for sub in BROAD_SUBREDDITS:
        posts = _fetch_subreddit(sub, limit=per_sub)
        for p in posts:
            pid = p.get("id", "")
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                raw_posts.append(p)
        time.sleep(1.5)
        if len(raw_posts) >= limit:
            break

    # Búsquedas
    if len(raw_posts) < limit:
        for query in BROAD_QUERIES:
            posts = _fetch_search(query, limit=8)
            for p in posts:
                pid = p.get("id", "")
                if pid and pid not in seen_ids:
                    seen_ids.add(pid)
                    raw_posts.append(p)
            if len(raw_posts) >= limit:
                break

    # Convertir a textos limpios
    texts = []
    for p in raw_posts[:limit]:
        title = p.get("title", "").strip()
        body  = (p.get("selftext") or "").strip()
        if not title:
            continue
        text = title
        if body and len(body) > 20:
            text += f" — {body[:200]}"
        texts.append(text)

    log.info(f"  {len(texts)} posts recolectados")
    return texts


# ── Clustering LLM ────────────────────────────────────────────────────────

def _parse_clusters(raw: str) -> list[dict]:
    """Parsea JSON del LLM con tolerancia a variaciones de formato."""
    raw = raw.strip()

    # Limpiar backticks
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:].strip()
        raw = raw.strip()

    # Si el modelo devuelve texto antes del array, intentar extraer el array
    if not raw.startswith("["):
        start = raw.find("[")
        if start != -1:
            raw = raw[start:]

    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return [data]  # a veces devuelve un solo objeto
    except json.JSONDecodeError:
        pass

    log.warning("  LLM devolvió JSON inválido — skipping batch")
    return []


def cluster_batch(texts: list[str]) -> list[dict]:
    """Envía un batch de textos al LLM y retorna clusters detectados."""
    posts_text = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    prompt = CLUSTER_PROMPT.format(
        known_segments=", ".join(KNOWN_SEGMENTS),
        posts_text=posts_text,
    )

    try:
        raw = llm.call(prompt, max_tokens=800)
        clusters = _parse_clusters(raw)
        log.info(f"  Batch → {len(clusters)} clusters detectados")
        return clusters
    except Exception as e:
        log.error(f"  LLM cluster batch falló: {e}")
        return []


# ── Agregación ────────────────────────────────────────────────────────────

def _keyword_overlap(a: list[str], b: list[str]) -> int:
    return len(set(kw.lower() for kw in a) & set(kw.lower() for kw in b))


def aggregate_clusters(all_clusters: list[dict]) -> list[dict]:
    """
    Fusiona clusters similares entre batches (overlap de keywords ≥ 2).
    Retorna lista ordenada por señal compuesta (post_count × batch_count).
    """
    merged: list[dict] = []

    for cluster in all_clusters:
        if not cluster.get("profile") or not cluster.get("pain"):
            continue

        found = False
        for m in merged:
            if _keyword_overlap(cluster.get("keywords", []), m.get("keywords", [])) >= 2:
                m["post_count"]  += cluster.get("post_count", 1)
                m["batch_count"] += 1
                # Enriquecer keywords
                for kw in cluster.get("keywords", []):
                    if kw.lower() not in [k.lower() for k in m["keywords"]]:
                        m["keywords"].append(kw)
                found = True
                break

        if not found:
            entry = dict(cluster)
            entry.setdefault("post_count",  1)
            entry.setdefault("batch_count", 1)
            entry.setdefault("income_estimate", "medium")
            entry.setdefault("has_deadline", False)
            merged.append(entry)

    # Score simple: frecuencia × cobertura de batches (detectado en más batches = más robusto)
    for m in merged:
        m["discovery_score"] = round(m["post_count"] * (1 + m["batch_count"] * 0.5), 1)

    return sorted(merged, key=lambda c: c["discovery_score"], reverse=True)


# ── Telegram ──────────────────────────────────────────────────────────────

def _send_telegram(candidates: list[dict]):
    token   = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return

    lines = ["🔍 *Segmentos ocultos detectados*\n"]
    for i, c in enumerate(candidates[:5], 1):
        deadline = "⚠️ deadline" if c.get("has_deadline") else ""
        lines.append(
            f"*{i}. {c['profile']}* {deadline}\n"
            f"  Dolor: {c['pain']}\n"
            f"  Keywords: {', '.join(c['keywords'][:4])}\n"
            f"  Score: {c['discovery_score']} | Renta: {c.get('income_estimate','?')}\n"
        )

    lines.append("\n_Ejecuta `python pipeline.py` para generar landings._")
    text = "\n".join(lines)

    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
        log.info("  Telegram: candidatos enviados")
    except Exception as e:
        log.error(f"  Telegram falló: {e}")


# ── Entry point ───────────────────────────────────────────────────────────

def run(limit: int = 100, min_score: float = 3.0, dry_run: bool = False) -> list[dict]:
    log.info(f"\n{'='*50}")
    log.info(f"DISCOVER START — {datetime.utcnow().isoformat()}")
    log.info(f"  provider: {llm.active_provider() or 'ninguno configurado'}")
    log.info(f"{'='*50}\n")

    if not llm.active_provider():
        log.error("Sin LLM provider. Configura GROQ_API_KEY u OPENROUTER_API_KEY en .env")
        return []

    # 1. Recolectar posts amplios
    texts = collect_broad(limit=limit)
    if not texts:
        log.warning("Sin posts recolectados — abortando")
        return []

    # 2. Clustering en batches de 15
    batch_size = 15
    all_clusters: list[dict] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        log.info(f"  Batch {i//batch_size + 1}/{(len(texts)-1)//batch_size + 1} ({len(batch)} posts)...")
        clusters = cluster_batch(batch)
        all_clusters.extend(clusters)
        time.sleep(2)  # cortesía con la API gratuita

    log.info(f"\n  Total clusters raw: {len(all_clusters)}")

    # 3. Agregar y rankear
    candidates = aggregate_clusters(all_clusters)
    top = [c for c in candidates if c["discovery_score"] >= min_score]

    # 4. Mostrar resultados
    log.info(f"\n{'='*50}")
    log.info(f"CANDIDATOS DETECTADOS ({len(top)} sobre umbral {min_score})")
    log.info(f"{'='*50}")
    for i, c in enumerate(top[:10], 1):
        deadline_flag = " ⚠️ DEADLINE" if c.get("has_deadline") else ""
        log.info(
            f"  {i:2}. [{c['discovery_score']:5.1f}] {c['profile']}{deadline_flag}\n"
            f"       Dolor: {c['pain']}\n"
            f"       Keywords: {', '.join(c['keywords'][:5])}\n"
            f"       Renta: {c.get('income_estimate', '?')} | "
            f"Batches: {c['batch_count']} | Posts: {c['post_count']}"
        )

    if not top:
        log.info("  Sin candidatos nuevos por encima del umbral.")

    # 5. Telegram
    if top and not dry_run:
        _send_telegram(top)

    log.info(f"\n{'='*50}\n")
    return top


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Market Intel — Segment Discovery")
    parser.add_argument("--limit",     type=int,   default=100,
                        help="Posts a recolectar (default: 100)")
    parser.add_argument("--min-score", type=float, default=3.0,
                        help="Score mínimo para incluir candidato (default: 3.0)")
    parser.add_argument("--dry-run",   action="store_true",
                        help="Sin Telegram")
    args = parser.parse_args()

    results = run(limit=args.limit, min_score=args.min_score, dry_run=args.dry_run)
    if results:
        print(json.dumps(results[:5], ensure_ascii=False, indent=2))
