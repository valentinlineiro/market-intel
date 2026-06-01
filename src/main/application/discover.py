from __future__ import annotations
import json
import logging
import time
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

import requests

from application.ports import LLMProvider, Notifier
from domain.segments import SEGMENTS

log = logging.getLogger(__name__)

# Broad queries — sector-agnostic, designed to surface unknown professional pain points.
# HN Algolia and Google News RSS both accept these without auth and work from CI.
_HN_QUERIES = [
    "solo practitioner software pain billing",
    "freelancer professional bureaucracy",
    "small practice management software problem",
    "professional license permit bureaucracy Spain",
    "Ask HN what software do you hate",
]

_NEWS_QUERIES = [
    "autónomo España software problema hacienda",
    "profesional liberal burocracia queja",
    "colegio profesional trámites digitales",
    "pyme software gestión problema",
    "autónomo facturación electrónica problema",
]

_KNOWN = [seg["label"] for seg in SEGMENTS.values()]

_PROMPT = """\
Analiza estos textos de noticias y foros profesionales.
Identifica perfiles profesionales con dolores recurrentes NO incluidos en: {known}.

TEXTOS:
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
            time.sleep(15)  # Groq free tier: ~4 RPM sustained

        candidates = self._aggregate(all_clusters)
        top = [c for c in candidates if c["discovery_score"] >= min_score]

        if top and not dry_run:
            lines = ["🔍 *Segmentos ocultos detectados*\n"]
            for i, c in enumerate(top[:5], 1):
                lines.append(f"*{i}. {c['profile']}*\n  Dolor: {c['pain']}\n  Score: {c['discovery_score']}\n")
            self._notifier.send("\n".join(lines))

        return top

    def _collect_broad(self, limit: int) -> list[str]:
        raw: list[str] = []

        for query in _HN_QUERIES:
            if len(raw) >= limit:
                break
            try:
                r = requests.get(
                    "https://hn.algolia.com/api/v1/search",
                    params={"query": query, "tags": "story,ask_hn", "hitsPerPage": 12},
                    timeout=15,
                )
                r.raise_for_status()
                for hit in r.json().get("hits", []):
                    title = (hit.get("title") or "").strip()
                    body  = (hit.get("story_text") or "")[:200].strip()
                    if title:
                        raw.append(f"{title} — {body}" if body else title)
                time.sleep(1)
            except Exception as e:
                log.error(f"HN broad '{query}': {e}")

        for query in _NEWS_QUERIES:
            if len(raw) >= limit:
                break
            try:
                r = requests.get(
                    f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=es&gl=ES&ceid=ES:es",
                    timeout=15,
                    headers={"User-Agent": "market-intel/0.1"},
                )
                r.raise_for_status()
                root = ET.fromstring(r.content)
                for item in root.findall(".//item")[:10]:
                    title = (item.findtext("title") or "").strip()
                    desc  = (item.findtext("description") or "")[:200].strip()
                    if title:
                        raw.append(f"{title} — {desc}" if desc else title)
                time.sleep(1)
            except Exception as e:
                log.error(f"News RSS '{query}': {e}")

        return raw[:limit]

    def _cluster_batch(self, texts: list[str]) -> list[dict]:
        prompt = _PROMPT.format(
            known=", ".join(_KNOWN),
            posts="\n".join(f"{i+1}. {t}" for i, t in enumerate(texts)),
        )
        try:
            raw = self._llm.complete(prompt, max_tokens=800).strip()
            if not raw:
                log.warning("Cluster batch: empty LLM response, skipping")
                return []
            raw = raw.replace("```json", "").replace("```", "").strip()
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
