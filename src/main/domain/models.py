from __future__ import annotations
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional
import uuid


class SignalSource(str, Enum):
    GMAPS_REVIEWS   = "gmaps_reviews"
    REDDIT          = "reddit"
    G2_CAPTERRA     = "g2_capterra"
    GOOGLE_TRENDS   = "google_trends"
    GOOGLE_NEWS     = "google_news"
    JOB_POSTINGS    = "job_postings"


@dataclass
class Signal:
    segment: str
    raw_text: str = ""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    source: SignalSource = SignalSource.REDDIT
    collected_at: datetime = field(default_factory=datetime.utcnow)
    location: str = "España"
    url: str = ""
    pain_keywords_found: list[str] = field(default_factory=list)
    sentiment_score: float = 0.0
    salary_mean: int = 0
    income_tier: str = ""
    signal_strength: float = 0.0
    has_active_deadline: bool = False


@dataclass
class ActiveSegment:
    """A market segment sourced from discovery or lead activity — no hardcoding."""
    key: str                        # unique slug, e.g. "veterinario_autonomo"
    label: str                      # human-readable, e.g. "Veterinario autónomo"
    keywords: list[str] = field(default_factory=list)
    income_tier: str = "medium"     # "high" | "medium_high" | "medium" | "low"
    has_deadline: bool = False
    discovery_score: float = 0.0
    post_count: int = 0
    has_leads: bool = False

    @staticmethod
    def from_candidate(c: dict) -> "ActiveSegment":
        label = c.get("profile", "")
        key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:48]
        return ActiveSegment(
            key=key,
            label=label,
            keywords=c.get("keywords") or [],
            income_tier=c.get("income_est") or "medium",
            has_deadline=bool(c.get("has_deadline")),
            discovery_score=float(c.get("discovery_score") or 0),
            post_count=int(c.get("post_count") or 0),
        )


@dataclass
class Opportunity:
    segment: str
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    pain_summary: str = ""
    score: float = 0.0
    score_breakdown: dict = field(default_factory=dict)
    signal_ids: list[str] = field(default_factory=list)
    signal_count: int = 0
    first_seen: datetime = field(default_factory=datetime.utcnow)
    last_updated: datetime = field(default_factory=datetime.utcnow)
    status: str = "watching"
    landing_url: Optional[str] = None
    emails_captured: int = 0
    validation_deadline: Optional[datetime] = None
    kill_threshold_days: int = 7
    scale_threshold_emails: int = 30
    telegram_alerted_at: Optional[datetime] = None
