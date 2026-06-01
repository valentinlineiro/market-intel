from __future__ import annotations
import json
import logging
import time

import requests

from application.ports import LLMProvider, Notifier
from domain.segments import SEGMENTS

log = logging.getLogger(__name__)

BROAD_SUBREDDITS = [
    "autonomos", "pymes", "spain", "emprendimiento",
    "Informatica", "medicina", "veterinaria",
]

BROAD_QUERIES = [
    "autónomo software problema España",
    "profesional hacienda burocracia queja",
    "autónomo gestoría cara alternativa",
    "trámites colegio profesional lento",
    "software clínica problema España",
]

_KNOWN = [seg["label"] for seg in SEGMENTS.values()]

_PROMPT = """\
Analiza estos posts de Reddit de comunidades profesionales españolas.
Identifica perfiles profesionales con dolores recurrentes NO incluidos en: {known}.

POSTS:
{posts}

Para cada perfil nuevo devuelve JSON:
{{"profile":"...","pain":"...","keywords":["..."],"post_count":N,"income_estimate":"high|medium_high|medium|low","has_deadline":true|false}}

Devuelve SOLO un array JSON válido. Si no hay perfiles nuevos devuelve [].
"""


class DiscoverUseCase:
    def __init__(self, llm: LLMProvider, notifier: Notifier):
        self._llm = llm
        self._notifier = notifier

    def run(self, limit: int = 100, min_score: float = 3.0, dry_run: bool = False) -> list[dict]:
        texts = self._collect_broad(limit)
        if not texts:
            return []

        all_clusters: list[dict] = []
        for i in range(0, len(texts), 15):
            batch = texts[i:i + 15]
            all_clusters.extend(self._cluster_batch(batch))
            time.sleep(2)

        candidates = self._aggregate(all_clusters)
        top = [c for c in candidates if c["discovery_score"] >= min_score]

        if top and not dry_run:
            lines = ["🔍 *Segmentos ocultos detectados*\n"]
            for i, c in enumerate(top[:5], 1):
                lines.append(f"*{i}. {c['profile']}*\n  Dolor: {c['pain']}\n  Score: {c['discovery_score']}\n")
            self._notifier.send("\n".join(lines))

        return top

    def _collect_broad(self, limit: int) -> list[str]:
        raw, seen = [], set()
        headers = {"User-Agent": "market-intel-discover/0.1", "Accept": "application/json"}
        for sub in BROAD_SUBREDDITS:
            try:
                r = requests.get(f"https://www.reddit.com/r/{sub}/new.json?limit=15",
                                 headers=headers, timeout=15)
                for c in r.json().get("data", {}).get("children", []):
                    p = c["data"]
                    pid = p.get("id", "")
                    if pid and pid not in seen:
                        seen.add(pid)
                        title = p.get("title", "")
                        body = (p.get("selftext") or "")[:200]
                        raw.append(f"{title} — {body}" if body else title)
                time.sleep(1.5)
            except Exception as e:
                log.error(f"r/{sub}: {e}")
            if len(raw) >= limit:
                break
        return raw[:limit]

    def _cluster_batch(self, texts: list[str]) -> list[dict]:
        prompt = _PROMPT.format(
            known=", ".join(_KNOWN),
            posts="\n".join(f"{i+1}. {t}" for i, t in enumerate(texts)),
        )
        try:
            raw = self._llm.complete(prompt, max_tokens=800).strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:].strip()
            data = json.loads(raw)
            return data if isinstance(data, list) else [data]
        except Exception as e:
            log.error(f"Cluster batch failed: {e}")
            return []

    def _aggregate(self, clusters: list[dict]) -> list[dict]:
        merged: list[dict] = []
        for c in clusters:
            if not c.get("profile"):
                continue
            found = False
            for m in merged:
                if len(set(c.get("keywords", [])) & set(m.get("keywords", []))) >= 2:
                    m["post_count"] = m.get("post_count", 0) + c.get("post_count", 1)
                    m["batch_count"] = m.get("batch_count", 1) + 1
                    found = True
                    break
            if not found:
                entry = dict(c)
                entry.setdefault("batch_count", 1)
                merged.append(entry)
        for m in merged:
            m["discovery_score"] = round(m.get("post_count", 1) * (1 + m.get("batch_count", 1) * 0.5), 1)
        return sorted(merged, key=lambda c: c["discovery_score"], reverse=True)
