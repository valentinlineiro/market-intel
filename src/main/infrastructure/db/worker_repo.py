from __future__ import annotations
import json
import os
import logging
from datetime import datetime

import requests

from application.ports import SignalRepository, OpportunityRepository
from domain.models import Signal, Opportunity, SignalSource

log = logging.getLogger(__name__)
_SESSION = requests.Session()


def _url(path: str) -> str:
    return os.environ["WORKER_URL"].rstrip("/") + path


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {os.environ['WORKER_SECRET']}",
        "Content-Type": "application/json",
    }


class WorkerSignalRepo(SignalRepository):
    def save(self, s: Signal) -> bool:
        r = _SESSION.post(_url("/signals"), headers=_headers(), json={
            "id": s.id, "source": s.source.value,
            "collected_at": s.collected_at.isoformat(),
            "segment": s.segment, "location": s.location,
            "raw_text": s.raw_text[:2000], "url": s.url,
            "pain_keywords": s.pain_keywords_found,
            "sentiment_score": s.sentiment_score,
            "salary_mean": s.salary_mean or 0,
            "income_tier": s.income_tier or "",
            "signal_strength": s.signal_strength,
            "has_deadline": s.has_active_deadline,
        }, timeout=15)
        r.raise_for_status()
        return r.json().get("inserted", False)

    def get(self, segment: str | None = None, limit: int = 100) -> list[Signal]:
        params = {"limit": limit}
        if segment:
            params["segment"] = segment
        r = _SESSION.get(_url("/signals"), headers=_headers(), params=params, timeout=15)
        r.raise_for_status()
        return [_dict_to_signal(row) for row in r.json().get("results", [])]

    def count(self, segment: str | None = None) -> int:
        params = {"segment": segment} if segment else {}
        r = _SESSION.get(_url("/signals/count"), headers=_headers(), params=params, timeout=15)
        r.raise_for_status()
        return r.json().get("count", 0)

    def exists(self, url: str, segment: str) -> bool:
        return False  # Worker deduplicates on POST — no extra round-trip needed


class WorkerOpportunityRepo(OpportunityRepository):
    def upsert(self, o: Opportunity) -> None:
        r = _SESSION.post(_url("/opportunities"), headers=_headers(), json={
            "id": o.id, "segment": o.segment, "pain_summary": o.pain_summary,
            "score": o.score, "score_breakdown": o.score_breakdown,
            "signal_ids": o.signal_ids, "signal_count": o.signal_count,
            "first_seen": o.first_seen.isoformat(),
            "last_updated": o.last_updated.isoformat(),
            "status": o.status, "landing_url": o.landing_url,
            "emails_captured": o.emails_captured,
            "validation_deadline": o.validation_deadline.isoformat() if o.validation_deadline else None,
            "telegram_alerted_at": o.telegram_alerted_at.isoformat() if o.telegram_alerted_at else None,
        }, timeout=15)
        r.raise_for_status()

    def get_all(self) -> list[Opportunity]:
        r = _SESSION.get(_url("/opportunities"), headers=_headers(), timeout=15)
        r.raise_for_status()
        return [_dict_to_opp(row) for row in r.json().get("results", [])]

    def get_by_segment(self, segment: str) -> Opportunity | None:
        all_opps = self.get_all()
        return next((o for o in all_opps if o.segment == segment), None)


def _dict_to_signal(r: dict) -> Signal:
    return Signal(
        id=r["id"], segment=r["segment"],
        source=SignalSource(r.get("source", "reddit")),
        collected_at=datetime.fromisoformat(r["collected_at"]),
        location=r.get("location", ""), raw_text=r.get("raw_text", ""),
        url=r.get("url", ""),
        pain_keywords_found=json.loads(r.get("pain_keywords") or "[]"),
        sentiment_score=r.get("sentiment_score") or 0.0,
        salary_mean=r.get("salary_mean") or 0,
        income_tier=r.get("income_tier") or "",
        signal_strength=r.get("signal_strength") or 0.0,
        has_active_deadline=bool(r.get("has_deadline", 0)),
    )


def _dict_to_opp(r: dict) -> Opportunity:
    return Opportunity(
        id=r["id"], segment=r["segment"],
        pain_summary=r.get("pain_summary") or "",
        score=r.get("score") or 0.0,
        score_breakdown=json.loads(r.get("score_breakdown") or "{}"),
        signal_ids=json.loads(r.get("signal_ids") or "[]"),
        signal_count=r.get("signal_count") or 0,
        first_seen=datetime.fromisoformat(r["first_seen"]),
        last_updated=datetime.fromisoformat(r["last_updated"]),
        status=r.get("status") or "watching",
        landing_url=r.get("landing_url"),
        emails_captured=r.get("emails_captured") or 0,
        telegram_alerted_at=datetime.fromisoformat(r["telegram_alerted_at"]) if r.get("telegram_alerted_at") else None,
    )


def available() -> bool:
    return bool(os.environ.get("WORKER_URL") and os.environ.get("WORKER_SECRET"))
