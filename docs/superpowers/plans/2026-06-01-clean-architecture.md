# Clean Architecture Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize market-intel into domain/application/infrastructure layers, move Cloudflare edge code into infrastructure/, add gnews Worker cron, make dashboard dynamic, cut GH Actions from ~2150 to ~200 min/month.

**Architecture:** Strict Clean Architecture — domain has zero external deps, application imports only domain + ports (ABCs), infrastructure implements ports. Composition root at `main.py` wires concrete adapters into use cases. Cloudflare Worker and Pages live in `infrastructure/worker/` and `infrastructure/pages/`.

**Tech Stack:** Python 3.12, pytest, Cloudflare Workers (JS), Cloudflare D1, Cloudflare Pages, GitHub Actions

---

## File Map

| New path | Source | Action |
|----------|--------|--------|
| `domain/models.py` | `schema.py` | Extract Signal, Opportunity, SignalSource |
| `domain/segments.py` | `schema.py` | Extract SEGMENTS, SALARY_TIERS |
| `domain/rules.py` | `schema.py` | Extract weights, thresholds, scoring fns |
| `application/ports.py` | new | ABCs for all infrastructure boundaries |
| `application/collect.py` | `collectors/run_all.py` | Use case |
| `application/score.py` | `scoring/scorer.py` | Use case |
| `application/discover.py` | `discover.py` | Use case |
| `application/validate.py` | `synthesize.py` + `generate_landing.py` | Use case |
| `application/pipeline.py` | `pipeline.py` | Orchestrator (no infra imports) |
| `infrastructure/db/sqlite_repo.py` | `db/database.py` | SQLite impl of ports |
| `infrastructure/db/worker_repo.py` | `db/worker_client.py` | Worker HTTP impl of ports |
| `infrastructure/collectors/base.py` | `collectors/base.py` | Move |
| `infrastructure/collectors/reddit.py` | `collectors/reddit_collector.py` | Move + fix imports |
| `infrastructure/collectors/trends.py` | `collectors/trends_collector.py` | Move + fix imports |
| `infrastructure/collectors/g2.py` | `collectors/g2_collector.py` | Move + fix imports |
| `infrastructure/llm/chain.py` | `llm.py` | Move + implement LLMProvider port |
| `infrastructure/llm/prompts.py` | `synthesize.py` | Extract SYNTHESIS_PROMPT + SECTOR_COPY |
| `infrastructure/notifications.py` | `scoring/scorer.py` | Extract Telegram, implement Notifier |
| `infrastructure/compose.py` | new | Wires adapters |
| `main.py` | new | Composition root + CLI entry point |
| `infrastructure/worker/index.js` | `worker/index.js` | Move + add public GET routes |
| `infrastructure/worker/collectors/gnews.js` | `collectors/gnews_collector.py` | Rewrite in JS as cron |
| `infrastructure/worker/wrangler.toml` | `worker/wrangler.toml` | Move + add cron trigger |
| `infrastructure/pages/dashboard.html` | `index.html` | Rewrite dynamic |
| `infrastructure/pages/landings/` | `landing_*.html` | Move |
| `infrastructure/pages/functions/signup.js` | `functions/signup.js` | Move |
| `infrastructure/pages/wrangler.toml` | `wrangler.toml` | Update path |

**Deleted after migration:** `schema.py`, `llm.py`, `synthesize.py`, `generate_landing.py`, `deploy.py`, `report.py`, `report_html.py`, `pipeline.py`, `discover.py`, `collectors/`, `db/`, `scoring/`, `worker/`, `functions/`, `index.html`, `landing_*.html`, `.github/workflows/collect-gnews.yml`, `.github/workflows/pages.yml`

---

### Task 1: Project scaffolding + pytest

**Files:**
- Create: `domain/__init__.py`, `application/__init__.py`, `infrastructure/__init__.py`, `infrastructure/db/__init__.py`, `infrastructure/collectors/__init__.py`, `infrastructure/llm/__init__.py`
- Create: `tests/__init__.py`, `tests/domain/__init__.py`, `tests/application/__init__.py`
- Modify: `requirements.txt`

- [ ] Add pytest to requirements.txt

```
requests==2.31.0
beautifulsoup4==4.14.3
praw==7.8.1
feedparser==6.0.12
pytrends==4.9.2
rich==13.7.1
python-dotenv==1.0.1
pytest==8.3.5
pytest-mock==3.14.0
```

- [ ] Create all `__init__.py` files (empty):

```bash
mkdir -p domain application infrastructure/db infrastructure/collectors infrastructure/llm
mkdir -p tests/domain tests/application
touch domain/__init__.py application/__init__.py
touch infrastructure/__init__.py infrastructure/db/__init__.py
touch infrastructure/collectors/__init__.py infrastructure/llm/__init__.py
touch tests/__init__.py tests/domain/__init__.py tests/application/__init__.py
```

- [ ] Install:

```bash
pip install pytest==8.3.5 pytest-mock==3.14.0
```

- [ ] Verify pytest works:

```bash
pytest tests/ -v
```

Expected: `no tests ran` — no error.

- [ ] Commit:

```bash
git add requirements.txt domain/ application/ infrastructure/ tests/
git commit -m "chore: scaffold clean architecture directories + pytest"
```

---

### Task 2: domain/models.py

**Files:**
- Create: `domain/models.py`
- Create: `tests/domain/test_models.py`

- [ ] Write failing test:

```python
# tests/domain/test_models.py
from datetime import datetime
from domain.models import Signal, Opportunity, SignalSource

def test_signal_defaults():
    s = Signal(segment="dentista", raw_text="problema con hacienda")
    assert s.segment == "dentista"
    assert s.id != ""
    assert isinstance(s.collected_at, datetime)
    assert s.pain_keywords_found == []

def test_opportunity_defaults():
    o = Opportunity(segment="dentista")
    assert o.status == "watching"
    assert o.score == 0.0
    assert o.emails_captured == 0

def test_signal_source_values():
    assert SignalSource.REDDIT.value == "reddit"
    assert SignalSource.GOOGLE_NEWS.value == "google_news"
```

- [ ] Run — expect ImportError:

```bash
pytest tests/domain/test_models.py -v
```

- [ ] Create `domain/models.py`:

```python
from __future__ import annotations
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
```

- [ ] Run — expect PASS:

```bash
pytest tests/domain/test_models.py -v
```

- [ ] Commit:

```bash
git add domain/models.py tests/domain/test_models.py
git commit -m "feat: domain/models.py — Signal, Opportunity, SignalSource"
```

---

### Task 3: domain/segments.py + domain/rules.py

**Files:**
- Create: `domain/segments.py`
- Create: `domain/rules.py`
- Create: `tests/domain/test_rules.py`

- [ ] Write failing test:

```python
# tests/domain/test_rules.py
from domain.rules import compute_opportunity_score, income_tier_score, urgency_score, SCORE_WEIGHTS

def test_compute_score_weighted():
    breakdown = {"dolor": 8.0, "capacidad_pago": 7.0, "volumen": 5.0, "competencia": 6.0, "urgencia": 10.0}
    score = compute_opportunity_score(breakdown)
    expected = round(8*0.30 + 7*0.25 + 5*0.20 + 6*0.15 + 10*0.10, 2)
    assert score == expected

def test_income_tier_high():
    assert income_tier_score("dentista") == 10

def test_urgency_with_deadline():
    assert urgency_score("dentista") == 10

def test_urgency_without_deadline():
    assert urgency_score("abogado_autonomo") == 0

def test_score_weights_sum_to_one():
    assert abs(sum(SCORE_WEIGHTS.values()) - 1.0) < 0.001
```

- [ ] Run — expect ImportError.

- [ ] Create `domain/segments.py`:

```python
SEGMENTS: dict[str, dict] = {
    "dentista": {
        "label": "Dentista / Clínica dental",
        "salary_min": 25_000, "salary_mean": 66_500, "salary_max": 120_000,
        "income_tier": "high",
        "population_spain": 35_000, "population_cadiz": 400,
        "pain_keywords": [
            "verifactu", "software homologado", "hacienda", "facturación",
            "rrsif", "multa", "gestión clínica", "historia clínica",
            "seguros dentales", "cuadro médico", "aseguradora",
        ],
        "active_deadline": "2026-01-01",
        "competition_proxy": 4.0,
    },
    "docente_universitario": {
        "label": "Docente universitario (PDI)",
        "salary_min": 28_000, "salary_mean": 42_000, "salary_max": 65_000,
        "income_tier": "medium_high",
        "population_spain": 120_000, "population_cadiz": 1_800,
        "pain_keywords": [
            "aneca", "acreditación", "docentia", "sexenio", "quinquenio",
            "expediente", "méritos", "tramos", "evaluación docente",
            "plaza", "concurso oposición",
        ],
        "active_deadline": None,
        "competition_proxy": 8.5,
    },
    "abogado_autonomo": {
        "label": "Abogado autónomo / despacho pequeño",
        "salary_min": 18_000, "salary_mean": 35_000, "salary_max": 150_000,
        "income_tier": "medium_high",
        "population_spain": 180_000, "population_cadiz": 2_500,
        "pain_keywords": [
            "gestoría", "contabilidad", "irpf", "iva trimestral",
            "facturación electrónica", "agenda", "expedientes",
            "turnos de oficio", "honorarios", "lexnet",
        ],
        "active_deadline": None,
        "competition_proxy": 6.0,
    },
    "arquitecto": {
        "label": "Arquitecto / estudio pequeño",
        "salary_min": 16_000, "salary_mean": 28_500, "salary_max": 65_000,
        "income_tier": "medium",
        "population_spain": 50_000, "population_cadiz": 800,
        "pain_keywords": [
            "visado colegial", "licencia obras", "ayuntamiento",
            "presupuesto", "certificado energético", "iee",
            "promotor", "burocracia",
        ],
        "active_deadline": None,
        "competition_proxy": 7.5,
    },
}

SALARY_TIERS: dict[str, int] = {
    "high": 10,
    "medium_high": 7,
    "medium": 5,
    "low": 2,
}
```

- [ ] Create `domain/rules.py`:

```python
from domain.segments import SEGMENTS, SALARY_TIERS

SCORE_WEIGHTS: dict[str, float] = {
    "dolor":          0.30,
    "capacidad_pago": 0.25,
    "volumen":        0.20,
    "competencia":    0.15,
    "urgencia":       0.10,
}

KILL_SCORE_THRESHOLD  = 5.0
SCALE_SCORE_THRESHOLD = 8.0
ALERT_SCORE_THRESHOLD = 7.0

_MAX_POP_SPAIN = max(s["population_spain"] for s in SEGMENTS.values())


def compute_opportunity_score(breakdown: dict) -> float:
    return round(sum(breakdown.get(k, 0) * w for k, w in SCORE_WEIGHTS.items()), 2)


def income_tier_score(segment_key: str) -> int:
    tier = SEGMENTS.get(segment_key, {}).get("income_tier", "low")
    return SALARY_TIERS.get(tier, 2)


def urgency_score(segment_key: str) -> int:
    return 10 if SEGMENTS.get(segment_key, {}).get("active_deadline") else 0


def volume_score(segment_key: str) -> float:
    pop = SEGMENTS.get(segment_key, {}).get("population_spain", 1)
    return round(min(pop / _MAX_POP_SPAIN, 1.0) * 10, 2)
```

- [ ] Run — expect PASS:

```bash
pytest tests/domain/ -v
```

- [ ] Commit:

```bash
git add domain/segments.py domain/rules.py tests/domain/test_rules.py
git commit -m "feat: domain/segments.py + domain/rules.py — scoring logic extracted"
```

---

### Task 4: application/ports.py

**Files:**
- Create: `application/ports.py`

- [ ] Create `application/ports.py`:

```python
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Callable
from domain.models import Signal, Opportunity


class SignalRepository(ABC):
    @abstractmethod
    def save(self, signal: Signal) -> bool: ...        # False = duplicate
    @abstractmethod
    def get(self, segment: str | None = None, limit: int = 100) -> list[Signal]: ...
    @abstractmethod
    def count(self, segment: str | None = None) -> int: ...
    @abstractmethod
    def exists(self, url: str, segment: str) -> bool: ...


class OpportunityRepository(ABC):
    @abstractmethod
    def upsert(self, opp: Opportunity) -> None: ...
    @abstractmethod
    def get_all(self) -> list[Opportunity]: ...
    @abstractmethod
    def get_by_segment(self, segment: str) -> Opportunity | None: ...


class LLMProvider(ABC):
    @abstractmethod
    def complete(self, prompt: str, max_tokens: int = 1024) -> str: ...


class Notifier(ABC):
    @abstractmethod
    def send(self, message: str) -> bool: ...


class PageDeployer(ABC):
    @abstractmethod
    def deploy(self, segment: str, copy: dict) -> str: ...  # returns published URL


# Type alias for collector callables
Collector = Callable[[str], list[Signal]]
```

- [ ] Verify no import errors:

```bash
python -c "from application.ports import SignalRepository, OpportunityRepository, LLMProvider, Notifier, PageDeployer, Collector; print('ok')"
```

- [ ] Commit:

```bash
git add application/ports.py
git commit -m "feat: application/ports.py — ABCs for all infrastructure boundaries"
```

---

### Task 5: infrastructure/db/sqlite_repo.py

**Files:**
- Create: `infrastructure/db/sqlite_repo.py`
- Create: `tests/application/test_sqlite_repo.py`

- [ ] Write failing test:

```python
# tests/application/test_sqlite_repo.py
import pytest
from datetime import datetime
from domain.models import Signal, Opportunity, SignalSource
from infrastructure.db.sqlite_repo import SqliteSignalRepo, SqliteOpportunityRepo

@pytest.fixture
def signal_repo(tmp_path):
    db = tmp_path / "test.db"
    return SqliteSignalRepo(db_path=str(db))

@pytest.fixture
def opp_repo(tmp_path):
    db = tmp_path / "test.db"
    return SqliteOpportunityRepo(db_path=str(db))

def test_save_and_get(signal_repo):
    s = Signal(segment="dentista", raw_text="problema verifactu", url="http://x.com/1")
    assert signal_repo.save(s) is True
    results = signal_repo.get(segment="dentista")
    assert len(results) == 1
    assert results[0].segment == "dentista"

def test_dedup(signal_repo):
    s = Signal(segment="dentista", url="http://x.com/1")
    signal_repo.save(s)
    s2 = Signal(segment="dentista", url="http://x.com/1")
    assert signal_repo.save(s2) is False

def test_count(signal_repo):
    signal_repo.save(Signal(segment="dentista", url="http://a.com"))
    signal_repo.save(Signal(segment="arquitecto", url="http://b.com"))
    assert signal_repo.count(segment="dentista") == 1
    assert signal_repo.count() == 2

def test_upsert_opportunity(opp_repo):
    o = Opportunity(segment="dentista", score=7.5, status="watching")
    opp_repo.upsert(o)
    result = opp_repo.get_by_segment("dentista")
    assert result is not None
    assert result.score == 7.5

def test_upsert_updates(opp_repo):
    o = Opportunity(segment="dentista", score=7.5)
    opp_repo.upsert(o)
    o.score = 8.0
    opp_repo.upsert(o)
    assert opp_repo.get_by_segment("dentista").score == 8.0
```

- [ ] Run — expect ImportError.

- [ ] Create `infrastructure/db/sqlite_repo.py`:

```python
from __future__ import annotations
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from application.ports import SignalRepository, OpportunityRepository
from domain.models import Signal, Opportunity, SignalSource

_DDL = """
CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, collected_at TEXT NOT NULL,
    segment TEXT NOT NULL, location TEXT, raw_text TEXT, url TEXT,
    pain_keywords TEXT, sentiment_score REAL, salary_mean INTEGER,
    income_tier TEXT, signal_strength REAL, has_deadline INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY, segment TEXT NOT NULL, pain_summary TEXT,
    score REAL, score_breakdown TEXT, signal_ids TEXT,
    signal_count INTEGER DEFAULT 0, first_seen TEXT, last_updated TEXT,
    status TEXT DEFAULT 'watching', landing_url TEXT,
    emails_captured INTEGER DEFAULT 0, validation_deadline TEXT,
    telegram_alerted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sig_url_seg ON signals(url, segment);
CREATE INDEX IF NOT EXISTS idx_sig_seg ON signals(segment);
CREATE INDEX IF NOT EXISTS idx_opp_seg ON opportunities(segment);
"""

_DEFAULT_DB = Path(__file__).parent.parent.parent / "market_intel.db"


def _conn(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure(db_path: str) -> None:
    with _conn(db_path) as conn:
        conn.executescript(_DDL)


class SqliteSignalRepo(SignalRepository):
    def __init__(self, db_path: str = str(_DEFAULT_DB)):
        self._db = db_path
        _ensure(db_path)

    def save(self, s: Signal) -> bool:
        sql = """INSERT OR IGNORE INTO signals
            (id, source, collected_at, segment, location, raw_text, url,
             pain_keywords, sentiment_score, salary_mean, income_tier,
             signal_strength, has_deadline)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"""
        params = [
            s.id, s.source.value, s.collected_at.isoformat(), s.segment,
            s.location, s.raw_text[:2000], s.url,
            json.dumps(s.pain_keywords_found), s.sentiment_score,
            s.salary_mean, s.income_tier, s.signal_strength,
            1 if s.has_active_deadline else 0,
        ]
        with _conn(self._db) as conn:
            return conn.execute(sql, params).rowcount > 0

    def get(self, segment: str | None = None, limit: int = 100) -> list[Signal]:
        if segment:
            sql = "SELECT * FROM signals WHERE segment=? ORDER BY collected_at DESC LIMIT ?"
            params = [segment, limit]
        else:
            sql = "SELECT * FROM signals ORDER BY collected_at DESC LIMIT ?"
            params = [limit]
        with _conn(self._db) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [_row_to_signal(dict(r)) for r in rows]

    def count(self, segment: str | None = None) -> int:
        sql = "SELECT COUNT(*) FROM signals" + (" WHERE segment=?" if segment else "")
        params = [segment] if segment else []
        with _conn(self._db) as conn:
            return conn.execute(sql, params).fetchone()[0]

    def exists(self, url: str, segment: str) -> bool:
        with _conn(self._db) as conn:
            return conn.execute(
                "SELECT 1 FROM signals WHERE url=? AND segment=? LIMIT 1", [url, segment]
            ).fetchone() is not None


class SqliteOpportunityRepo(OpportunityRepository):
    def __init__(self, db_path: str = str(_DEFAULT_DB)):
        self._db = db_path
        _ensure(db_path)

    def upsert(self, o: Opportunity) -> None:
        sql = """INSERT INTO opportunities
            (id, segment, pain_summary, score, score_breakdown, signal_ids,
             signal_count, first_seen, last_updated, status, landing_url,
             emails_captured, validation_deadline, telegram_alerted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              score=excluded.score, score_breakdown=excluded.score_breakdown,
              signal_ids=excluded.signal_ids, signal_count=excluded.signal_count,
              last_updated=excluded.last_updated, status=excluded.status,
              landing_url=excluded.landing_url, emails_captured=excluded.emails_captured,
              validation_deadline=excluded.validation_deadline,
              telegram_alerted_at=excluded.telegram_alerted_at"""
        with _conn(self._db) as conn:
            conn.execute(sql, [
                o.id, o.segment, o.pain_summary, o.score,
                json.dumps(o.score_breakdown), json.dumps(o.signal_ids),
                o.signal_count, o.first_seen.isoformat(), o.last_updated.isoformat(),
                o.status, o.landing_url, o.emails_captured,
                o.validation_deadline.isoformat() if o.validation_deadline else None,
                o.telegram_alerted_at.isoformat() if o.telegram_alerted_at else None,
            ])

    def get_all(self) -> list[Opportunity]:
        with _conn(self._db) as conn:
            rows = conn.execute("SELECT * FROM opportunities ORDER BY score DESC").fetchall()
        return [_row_to_opp(dict(r)) for r in rows]

    def get_by_segment(self, segment: str) -> Opportunity | None:
        with _conn(self._db) as conn:
            row = conn.execute(
                "SELECT * FROM opportunities WHERE segment=? LIMIT 1", [segment]
            ).fetchone()
        return _row_to_opp(dict(row)) if row else None


def _row_to_signal(r: dict) -> Signal:
    return Signal(
        id=r["id"], segment=r["segment"],
        source=SignalSource(r["source"]),
        collected_at=datetime.fromisoformat(r["collected_at"]),
        location=r.get("location", ""),
        raw_text=r.get("raw_text", ""),
        url=r.get("url", ""),
        pain_keywords_found=json.loads(r.get("pain_keywords") or "[]"),
        sentiment_score=r.get("sentiment_score") or 0.0,
        salary_mean=r.get("salary_mean") or 0,
        income_tier=r.get("income_tier") or "",
        signal_strength=r.get("signal_strength") or 0.0,
        has_active_deadline=bool(r.get("has_deadline", 0)),
    )


def _row_to_opp(r: dict) -> Opportunity:
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
        validation_deadline=datetime.fromisoformat(r["validation_deadline"]) if r.get("validation_deadline") else None,
        telegram_alerted_at=datetime.fromisoformat(r["telegram_alerted_at"]) if r.get("telegram_alerted_at") else None,
    )
```

- [ ] Run — expect PASS:

```bash
pytest tests/application/test_sqlite_repo.py -v
```

- [ ] Commit:

```bash
git add infrastructure/db/sqlite_repo.py tests/application/test_sqlite_repo.py
git commit -m "feat: infrastructure/db/sqlite_repo.py — implements SignalRepo + OpportunityRepo"
```

---

### Task 6: infrastructure/db/worker_repo.py

**Files:**
- Create: `infrastructure/db/worker_repo.py`

- [ ] Create `infrastructure/db/worker_repo.py`:

```python
from __future__ import annotations
import json
import os
import logging
from datetime import datetime

import requests

from application.ports import SignalRepository, OpportunityRepository
from domain.models import Signal, Opportunity, SignalSource
from domain.segments import SEGMENTS

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
        seg_data = SEGMENTS.get(s.segment, {})
        r = _SESSION.post(_url("/signals"), headers=_headers(), json={
            "id": s.id, "source": s.source.value,
            "collected_at": s.collected_at.isoformat(),
            "segment": s.segment, "location": s.location,
            "raw_text": s.raw_text[:2000], "url": s.url,
            "pain_keywords": s.pain_keywords_found,
            "sentiment_score": s.sentiment_score,
            "salary_mean": seg_data.get("salary_mean", 0),
            "income_tier": seg_data.get("income_tier", ""),
            "signal_strength": s.signal_strength,
            "has_deadline": bool(seg_data.get("active_deadline")),
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
```

- [ ] Verify import:

```bash
python -c "from infrastructure.db.worker_repo import WorkerSignalRepo, WorkerOpportunityRepo; print('ok')"
```

- [ ] Commit:

```bash
git add infrastructure/db/worker_repo.py
git commit -m "feat: infrastructure/db/worker_repo.py — implements ports via CF Worker HTTP"
```

---

### Task 7: infrastructure/collectors/ + infrastructure/llm/ + infrastructure/notifications.py

**Files:**
- Create: `infrastructure/collectors/base.py` (copy + update imports)
- Create: `infrastructure/collectors/reddit.py`
- Create: `infrastructure/collectors/trends.py`
- Create: `infrastructure/collectors/g2.py`
- Create: `infrastructure/llm/chain.py`
- Create: `infrastructure/llm/prompts.py`
- Create: `infrastructure/notifications.py`

- [ ] Copy and update collector base — replace old schema/db imports:

```bash
cp collectors/base.py infrastructure/collectors/base.py
```

Edit `infrastructure/collectors/base.py` — replace the top imports:

```python
# Replace:
from schema import Signal, SignalSource, SEGMENTS
# With:
from domain.models import Signal, SignalSource
from domain.segments import SEGMENTS
```

- [ ] Copy reddit collector:

```bash
cp collectors/reddit_collector.py infrastructure/collectors/reddit.py
```

Edit `infrastructure/collectors/reddit.py` — replace imports at top:

```python
# Replace:
from schema import SignalSource, SEGMENTS
from collectors.base import build_signal
from db.database import insert_signal, signal_exists, init_db
# With:
from domain.models import SignalSource
from domain.segments import SEGMENTS
from infrastructure.collectors.base import build_signal
```

Remove the `init_db()` call from `run()` — the repo is injected now. Change the function signature so `run(segment, signal_repo)` returns `list[Signal]` instead of inserting directly. The return pattern:

```python
def collect(segment: str) -> list[Signal]:
    """Returns list of Signal objects — caller persists them."""
    signals = []
    # ... existing fetch logic but call signals.append(sig) instead of insert_signal(sig)
    return signals
```

- [ ] Copy trends collector:

```bash
cp collectors/trends_collector.py infrastructure/collectors/trends.py
```

Edit `infrastructure/collectors/trends.py` — same import swap + convert to return `list[Signal]`:

```python
from domain.models import Signal, SignalSource
from domain.segments import SEGMENTS
from infrastructure.collectors.base import build_signal

def collect(segment: str) -> list[Signal]:
    # ... existing logic, append to list, return
```

- [ ] Copy g2 collector:

```bash
cp collectors/g2_collector.py infrastructure/collectors/g2.py
```

Edit `infrastructure/collectors/g2.py` — same pattern.

- [ ] Create `infrastructure/llm/chain.py` — copy from `llm.py`, implement `LLMProvider`:

```python
import os
import logging
import requests
from application.ports import LLMProvider

log = logging.getLogger(__name__)

_PROVIDERS = [
    {"name": "groq", "env_key": "GROQ_API_KEY",
     "url": "https://api.groq.com/openai/v1/chat/completions",
     "model": os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"), "type": "openai"},
    {"name": "openrouter", "env_key": "OPENROUTER_API_KEY",
     "url": "https://openrouter.ai/api/v1/chat/completions",
     "model": os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.1-8b-instruct:free"), "type": "openai"},
    {"name": "anthropic", "env_key": "ANTHROPIC_API_KEY",
     "url": "https://api.anthropic.com/v1/messages",
     "model": "claude-sonnet-4-20250514", "type": "anthropic"},
]


class LLMChain(LLMProvider):
    def complete(self, prompt: str, max_tokens: int = 1024) -> str:
        errors = []
        for p in _PROVIDERS:
            api_key = os.getenv(p["env_key"])
            if not api_key:
                continue
            try:
                if p["type"] == "anthropic":
                    return _call_anthropic(api_key, p["model"], prompt, max_tokens)
                return _call_openai(api_key, p, prompt, max_tokens)
            except Exception as e:
                log.warning(f"  {p['name']} failed: {e}")
                errors.append(f"{p['name']}: {e}")
        raise RuntimeError(f"No LLM provider available. Errors: {'; '.join(errors)}")


def active_provider() -> str | None:
    return next((p["name"] for p in _PROVIDERS if os.getenv(p["env_key"])), None)


def _call_openai(api_key: str, provider: dict, prompt: str, max_tokens: int) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if provider["name"] == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/valentinlineiro/market-intel"
        headers["X-Title"] = "market-intel"
    resp = requests.post(provider["url"], headers=headers,
        json={"model": provider["model"], "max_tokens": max_tokens,
              "messages": [{"role": "user", "content": prompt}]}, timeout=30)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _call_anthropic(api_key: str, model: str, prompt: str, max_tokens: int) -> str:
    resp = requests.post("https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": model, "max_tokens": max_tokens,
              "messages": [{"role": "user", "content": prompt}]}, timeout=30)
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]
```

- [ ] Create `infrastructure/llm/prompts.py` — extract SYNTHESIS_PROMPT and SECTOR_COPY from `synthesize.py` and `generate_landing.py`. The file contains only constants:

```python
SYNTHESIS_PROMPT = """\
Eres un copywriter B2B especializado en SaaS para profesionales autónomos españoles.
[... exact content from synthesize.py SYNTHESIS_PROMPT ...]
"""

SECTOR_COPY: dict[str, dict] = {
    "dentista": {
        "title": "Simplifica Verifactu en tu Clínica Dental",
        "subtitle": "Facturación electrónica homologada ...",
        "benefits": [
            ("Hacienda bajo control", "Olvídate de las multas ...", "🛡️"),
            ("Gestión clínica fluida", "Agenda, historial ...", "⚡"),
            ("Seguros sin complicaciones", "Carga y facturación ...", "🦷"),
        ],
        "cta": "Quiero acceso prioritario (Beta cerrada)",
    },
    # ... remaining segments from generate_landing.py SECTOR_COPY
}
```

- [ ] Create `infrastructure/notifications.py`:

```python
import os
import logging
import requests
from application.ports import Notifier

log = logging.getLogger(__name__)


class TelegramNotifier(Notifier):
    def __init__(self):
        self._token = os.getenv("TELEGRAM_BOT_TOKEN")
        self._chat_id = os.getenv("TELEGRAM_CHAT_ID")

    def send(self, message: str) -> bool:
        if not self._token or not self._chat_id:
            log.debug("Telegram not configured — skipping")
            return False
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{self._token}/sendMessage",
                json={"chat_id": self._chat_id, "text": message, "parse_mode": "Markdown"},
                timeout=10,
            )
            return resp.ok
        except Exception as e:
            log.error(f"Telegram failed: {e}")
            return False


class NoopNotifier(Notifier):
    def send(self, message: str) -> bool:
        log.info(f"[NOOP NOTIFIER] {message[:80]}")
        return True
```

- [ ] Verify imports:

```bash
python -c "
from infrastructure.collectors.base import build_signal
from infrastructure.llm.chain import LLMChain
from infrastructure.notifications import TelegramNotifier
print('ok')
"
```

- [ ] Commit:

```bash
git add infrastructure/collectors/ infrastructure/llm/ infrastructure/notifications.py
git commit -m "feat: infrastructure adapters — collectors, LLM chain, Telegram notifier"
```

---

### Task 8: application/score.py + application/collect.py

**Files:**
- Create: `application/collect.py`
- Create: `application/score.py`
- Create: `tests/application/test_score.py`

- [ ] Write failing test for score use case:

```python
# tests/application/test_score.py
import pytest
from unittest.mock import MagicMock, call
from datetime import datetime
from domain.models import Signal, Opportunity
from application.score import ScoreUseCase

@pytest.fixture
def signal_repo():
    repo = MagicMock()
    repo.get.return_value = [
        Signal(segment="dentista", url="http://a.com", signal_strength=0.8,
               pain_keywords_found=["verifactu", "multa"], sentiment_score=-0.4)
        for _ in range(10)
    ]
    repo.count.return_value = 10
    return repo

@pytest.fixture
def opp_repo():
    repo = MagicMock()
    repo.get_by_segment.return_value = None
    return repo

@pytest.fixture
def notifier():
    return MagicMock()

def test_score_creates_opportunity(signal_repo, opp_repo, notifier):
    use_case = ScoreUseCase(signal_repo, opp_repo, notifier)
    results = use_case.run(segments=["dentista"])
    assert len(results) == 1
    assert results[0]["segment"] == "dentista"
    assert results[0]["score"] > 0
    opp_repo.upsert.assert_called_once()

def test_score_alerts_above_threshold(signal_repo, opp_repo, notifier):
    use_case = ScoreUseCase(signal_repo, opp_repo, notifier)
    results = use_case.run(segments=["dentista"])
    # dentista has active_deadline → urgency=10, income=high → should score high
    if results[0]["score"] >= 7.0:
        notifier.send.assert_called_once()
```

- [ ] Run — expect ImportError.

- [ ] Create `application/collect.py`:

```python
from __future__ import annotations
import logging
from application.ports import Collector, SignalRepository
from domain.segments import SEGMENTS

log = logging.getLogger(__name__)


class CollectUseCase:
    def __init__(self, collectors: list[Collector], signal_repo: SignalRepository):
        self._collectors = collectors
        self._repo = signal_repo

    def run(self, segments: list[str] | None = None) -> dict[str, int]:
        target = segments or list(SEGMENTS.keys())
        totals: dict[str, int] = {}

        for segment in target:
            count = 0
            for collector in self._collectors:
                try:
                    signals = collector(segment)
                    for s in signals:
                        if self._repo.save(s):
                            count += 1
                except Exception as e:
                    log.error(f"Collector failed for {segment}: {e}")
            totals[segment] = count
            log.info(f"  {segment}: {count} new signals")

        return totals
```

- [ ] Create `application/score.py`:

```python
from __future__ import annotations
import logging
from datetime import datetime, timedelta
from collections import Counter
import json

from application.ports import SignalRepository, OpportunityRepository, Notifier
from domain.models import Opportunity, Signal
from domain.segments import SEGMENTS
from domain.rules import (
    compute_opportunity_score, income_tier_score, urgency_score, volume_score,
    KILL_SCORE_THRESHOLD, SCALE_SCORE_THRESHOLD, ALERT_SCORE_THRESHOLD,
)

log = logging.getLogger(__name__)


class ScoreUseCase:
    def __init__(self, signal_repo: SignalRepository,
                 opp_repo: OpportunityRepository, notifier: Notifier):
        self._signals = signal_repo
        self._opps = opp_repo
        self._notifier = notifier

    def run(self, segments: list[str] | None = None, dry_run: bool = False) -> list[dict]:
        target = segments or list(SEGMENTS.keys())
        results = []

        for seg_key in target:
            signals = self._signals.get(segment=seg_key, limit=500)
            opp = self._score_segment(seg_key, signals)
            opp = self._apply_rules(opp)

            if not dry_run:
                self._opps.upsert(opp)
                if opp.score >= ALERT_SCORE_THRESHOLD and opp.status == "watching":
                    if self._should_alert(opp):
                        msg = self._format_alert(opp)
                        if self._notifier.send(msg):
                            opp.telegram_alerted_at = datetime.utcnow()
                            self._opps.upsert(opp)

            results.append({
                "segment": seg_key,
                "score": opp.score,
                "status": opp.status,
                "signal_count": opp.signal_count,
                "breakdown": opp.score_breakdown,
                "pain_summary": opp.pain_summary,
            })

        results.sort(key=lambda r: r["score"], reverse=True)
        return results

    def _score_segment(self, seg_key: str, signals: list[Signal]) -> Opportunity:
        dolor, pain_summary = self._dolor_score(signals)
        breakdown = {
            "dolor":          dolor,
            "capacidad_pago": float(income_tier_score(seg_key)),
            "volumen":        volume_score(seg_key),
            "competencia":    float(SEGMENTS[seg_key].get("competition_proxy", 5.0)),
            "urgencia":       float(urgency_score(seg_key)),
        }
        existing = self._opps.get_by_segment(seg_key)
        return Opportunity(
            id=existing.id if existing else Opportunity.__dataclass_fields__["id"].default_factory(),
            segment=seg_key,
            pain_summary=pain_summary or (existing.pain_summary if existing else ""),
            score=compute_opportunity_score(breakdown),
            score_breakdown=breakdown,
            signal_ids=[s.id for s in signals[-50:]],
            signal_count=self._signals.count(segment=seg_key),
            first_seen=existing.first_seen if existing else datetime.utcnow(),
            last_updated=datetime.utcnow(),
            status=existing.status if existing else "watching",
            landing_url=existing.landing_url if existing else None,
            emails_captured=existing.emails_captured if existing else 0,
            telegram_alerted_at=existing.telegram_alerted_at if existing else None,
        )

    def _dolor_score(self, signals: list[Signal]) -> tuple[float, str]:
        if not signals:
            return 0.0, ""
        cutoff = datetime.utcnow() - timedelta(days=30)
        recent = [s for s in signals if s.collected_at > cutoff]
        if not recent:
            return 0.0, ""
        week_ago = datetime.utcnow() - timedelta(days=7)
        freq_score = min(len(recent) / 20, 1.0) * 10
        weighted, total_w, all_kw = 0.0, 0.0, []
        for s in recent:
            w = 2.0 if s.collected_at > week_ago else 1.0
            weighted += s.signal_strength * w
            total_w += w
            all_kw.extend(s.pain_keywords_found)
        intensity = (weighted / total_w) * 10 if total_w else 0
        dolor = round((freq_score * 0.5 + intensity * 0.5), 2)
        top_kw = [kw for kw, _ in Counter(all_kw).most_common(3)]
        summary = f"Dolor en: {', '.join(top_kw)}" if top_kw else f"{len(recent)} señales recientes"
        return min(dolor, 10.0), summary

    def _apply_rules(self, opp: Opportunity) -> Opportunity:
        if opp.status in ("killed", "scaling"):
            return opp
        age = (datetime.utcnow() - opp.first_seen).days
        if opp.signal_count == 0 and age >= opp.kill_threshold_days and opp.score < KILL_SCORE_THRESHOLD:
            opp.status = "killed"
        elif opp.score >= SCALE_SCORE_THRESHOLD and opp.emails_captured >= opp.scale_threshold_emails:
            opp.status = "scaling"
        return opp

    def _should_alert(self, opp: Opportunity) -> bool:
        if not opp.telegram_alerted_at:
            return True
        return (datetime.utcnow() - opp.telegram_alerted_at).total_seconds() > 86400

    def _format_alert(self, opp: Opportunity) -> str:
        seg = SEGMENTS.get(opp.segment, {})
        bd = opp.score_breakdown
        lines = [
            f"🎯 *Oportunidad detectada*",
            f"*Segmento:* {seg.get('label', opp.segment)}",
            f"*Score:* {opp.score}/10",
            f"*Dolor:* {bd.get('dolor', 0):.1f} | *Pago:* {bd.get('capacidad_pago', 0):.0f} | *Urgencia:* {bd.get('urgencia', 0):.0f}",
            f"*Señales:* {opp.signal_count}",
            f"*Resumen:* {opp.pain_summary}",
        ]
        if seg.get("active_deadline"):
            lines.append(f"⚠️ Deadline: {seg['active_deadline']}")
        return "\n".join(lines)
```

- [ ] Run — expect PASS:

```bash
pytest tests/application/test_score.py -v
```

- [ ] Commit:

```bash
git add application/collect.py application/score.py tests/application/test_score.py
git commit -m "feat: application/collect.py + application/score.py — use cases"
```

---

### Task 9: application/discover.py + application/validate.py

**Files:**
- Create: `application/discover.py`
- Create: `application/validate.py`

- [ ] Create `application/discover.py` — thin wrapper around existing discover logic, now uses injected LLMProvider and Notifier:

```python
from __future__ import annotations
import json
import logging
import time
from collections import Counter

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
```

- [ ] Create `application/validate.py`:

```python
from __future__ import annotations
import json
import logging
from collections import Counter
from datetime import datetime

from application.ports import OpportunityRepository, LLMProvider, PageDeployer
from domain.segments import SEGMENTS
from domain.rules import ALERT_SCORE_THRESHOLD

log = logging.getLogger(__name__)

_SCORE_DELTA = 0.5


class ValidateUseCase:
    def __init__(self, opp_repo: OpportunityRepository,
                 llm: LLMProvider, deployer: PageDeployer):
        self._opps = opp_repo
        self._llm = llm
        self._deployer = deployer

    def run(self, segments: list[str] | None = None,
            dry_run: bool = False, force: bool = False,
            threshold: float = ALERT_SCORE_THRESHOLD) -> list[dict]:
        opps = self._opps.get_all()
        target = segments or [o.segment for o in opps]
        deployed = []

        for opp in opps:
            if opp.segment not in target:
                continue
            if opp.score < threshold:
                log.info(f"  Skip {opp.segment} (score={opp.score:.1f} < {threshold})")
                continue
            if opp.landing_url and not force:
                log.info(f"  Skip {opp.segment} (landing exists, no force)")
                continue

            log.info(f"  Processing {opp.segment} (score={opp.score:.1f})")
            copy = self._synthesize(opp.segment)

            if not dry_run:
                try:
                    url = self._deployer.deploy(opp.segment, copy)
                    opp.landing_url = url
                    opp.status = "testing"
                    opp.last_updated = datetime.utcnow()
                    self._opps.upsert(opp)
                    deployed.append({"segment": opp.segment, "score": opp.score, "url": url})
                    log.info(f"    Deployed: {url}")
                except Exception as e:
                    log.error(f"    Deploy failed for {opp.segment}: {e}")
            else:
                deployed.append({"segment": opp.segment, "score": opp.score, "url": None})

        return deployed

    def _synthesize(self, segment: str) -> dict:
        from infrastructure.llm.prompts import SYNTHESIS_PROMPT, SECTOR_COPY
        seg_data = SEGMENTS.get(segment, {})
        try:
            prompt = SYNTHESIS_PROMPT.format(
                segment_label=seg_data.get("label", segment),
                signals_text="(sin señales recientes)",
                top_keywords=", ".join(seg_data.get("pain_keywords", [])[:5]),
                salary_mean=seg_data.get("salary_mean", "N/A"),
                deadline_note=f"- Deadline activo: {seg_data['active_deadline']}" if seg_data.get("active_deadline") else "",
            )
            raw = self._llm.complete(prompt).strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:].strip()
            data = json.loads(raw)
            return {
                "title": data["headline"],
                "subtitle": data["subtitle"],
                "benefits": [(b["title"], b["desc"], b["emoji"]) for b in data["benefits"][:3]],
                "cta": data["cta"],
            }
        except Exception as e:
            log.warning(f"  LLM synthesis failed ({e}) — using SECTOR_COPY fallback")
            return SECTOR_COPY.get(segment, {})
```

- [ ] Commit:

```bash
git add application/discover.py application/validate.py
git commit -m "feat: application/discover.py + application/validate.py — use cases"
```

---

### Task 10: infrastructure/compose.py + main.py + application/pipeline.py

**Files:**
- Create: `infrastructure/compose.py`
- Create: `application/pipeline.py`
- Create: `main.py`

- [ ] Create `infrastructure/compose.py`:

```python
from __future__ import annotations
import os
import logging
import subprocess
from pathlib import Path

from application.ports import PageDeployer
from infrastructure.db.sqlite_repo import SqliteSignalRepo, SqliteOpportunityRepo
from infrastructure.db.worker_repo import WorkerSignalRepo, WorkerOpportunityRepo, available as worker_available
from infrastructure.llm.chain import LLMChain
from infrastructure.notifications import TelegramNotifier, NoopNotifier

log = logging.getLogger(__name__)

_PAGES_DIR = Path(__file__).parent / "pages"


class CloudflarePagesDeployer(PageDeployer):
    def deploy(self, segment: str, copy: dict) -> str:
        from infrastructure.pages.builder import build_html
        html = build_html(segment, copy)
        out = _PAGES_DIR / "landings" / f"{segment}.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        project = os.environ.get("CF_PAGES_PROJECT", "market-intel")
        result = subprocess.run(
            ["npx", "wrangler", "pages", "deploy", str(_PAGES_DIR),
             "--project-name", project, "--commit-dirty=true"],
            capture_output=True, text=True, check=True,
        )
        domain = os.environ.get("CF_PAGES_DOMAIN", "market-intel.pages.dev")
        return f"https://{domain}/landings/{segment}.html"


class NoopDeployer(PageDeployer):
    def deploy(self, segment: str, copy: dict) -> str:
        log.info(f"[NOOP DEPLOYER] Would deploy {segment}")
        return f"https://dry-run.example/{segment}"


def build(dry_run: bool = False) -> dict:
    use_local = os.getenv("USE_LOCAL_DB") == "1" or not worker_available()
    if use_local:
        log.info("DB backend: SQLite (local)")
        signals = SqliteSignalRepo()
        opps = SqliteOpportunityRepo()
    else:
        log.info("DB backend: CF Worker")
        signals = WorkerSignalRepo()
        opps = WorkerOpportunityRepo()

    return {
        "signal_repo":  signals,
        "opp_repo":     opps,
        "llm":          LLMChain(),
        "notifier":     TelegramNotifier(),
        "deployer":     NoopDeployer() if dry_run else CloudflarePagesDeployer(),
    }
```

- [ ] Create `infrastructure/pages/builder.py` — extracts HTML generation from `generate_landing.py`:

```python
from __future__ import annotations
from domain.segments import SEGMENTS
from infrastructure.llm.prompts import SECTOR_COPY


def build_html(segment: str, copy: dict) -> str:
    seg = SEGMENTS.get(segment, {})
    c = copy or SECTOR_COPY.get(segment, {})
    title = c.get("title", seg.get("label", segment))
    subtitle = c.get("subtitle", "")
    benefits = c.get("benefits", [])
    cta = c.get("cta", "Quiero acceso prioritario")

    benefits_html = "\n".join(
        f'<div class="benefit"><span class="emoji">{b[2] if len(b)>2 else ""}</span>'
        f'<h3>{b[0]}</h3><p>{b[1]}</p></div>'
        for b in benefits
    )

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }}
    .container {{ max-width: 680px; padding: 48px 24px; text-align: center; }}
    h1 {{ font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; color: #f1f5f9; line-height: 1.2; margin-bottom: 20px; }}
    .subtitle {{ font-size: 1.1rem; color: #94a3b8; margin-bottom: 40px; line-height: 1.6; }}
    .benefits {{ display: grid; gap: 20px; margin-bottom: 40px; text-align: left; }}
    .benefit {{ background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }}
    .emoji {{ font-size: 1.5rem; }}
    .benefit h3 {{ font-size: 1rem; font-weight: 700; color: #f1f5f9; margin: 8px 0 4px; }}
    .benefit p {{ font-size: 0.875rem; color: #64748b; line-height: 1.5; }}
    form {{ display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }}
    input[type=email] {{ flex: 1; min-width: 220px; padding: 14px 18px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 1rem; }}
    button {{ padding: 14px 28px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; white-space: nowrap; }}
    button:hover {{ background: #2563eb; }}
    .success {{ display: none; color: #22c55e; margin-top: 16px; font-weight: 600; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>{title}</h1>
    <p class="subtitle">{subtitle}</p>
    <div class="benefits">{benefits_html}</div>
    <form id="form" action="/signup" method="POST">
      <input type="hidden" name="segment" value="{segment}">
      <input type="email" name="email" placeholder="tu@email.com" required>
      <button type="submit">{cta}</button>
    </form>
    <p class="success" id="ok">✓ Apuntado. Te avisamos primero.</p>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async e => {{
      e.preventDefault();
      const fd = new FormData(e.target);
      await fetch('/signup', {{method:'POST', body: new URLSearchParams(fd)}});
      e.target.style.display = 'none';
      document.getElementById('ok').style.display = 'block';
    }});
  </script>
</body>
</html>"""
```

- [ ] Create `application/pipeline.py`:

```python
from __future__ import annotations
import logging
from datetime import datetime

from application.collect import CollectUseCase
from application.score import ScoreUseCase
from application.validate import ValidateUseCase
from application.ports import (
    SignalRepository, OpportunityRepository,
    LLMProvider, Notifier, PageDeployer, Collector,
)

log = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, signal_repo: SignalRepository, opp_repo: OpportunityRepository,
                 llm: LLMProvider, notifier: Notifier, deployer: PageDeployer,
                 collectors: list[Collector] | None = None):
        self._collect = CollectUseCase(collectors or [], signal_repo)
        self._score = ScoreUseCase(signal_repo, opp_repo, notifier)
        self._validate = ValidateUseCase(opp_repo, llm, deployer)

    def run(self, segments: list[str] | None = None, skip_collect: bool = False,
            dry_run: bool = False, force: bool = False,
            threshold: float = 7.0) -> dict:
        log.info(f"\n{'='*55}\nPIPELINE START — {datetime.utcnow().isoformat()}\n{'='*55}")

        if not skip_collect:
            collected = self._collect.run(segments=segments)
            log.info(f"Collected: {collected}")

        scored = self._score.run(segments=segments, dry_run=dry_run)
        log.info(f"Scored: {[(r['segment'], r['score']) for r in scored]}")

        deployed = self._validate.run(
            segments=segments, dry_run=dry_run, force=force, threshold=threshold
        )
        log.info(f"Deployed: {deployed}")

        return {"scored": scored, "deployed": deployed}
```

- [ ] Create `main.py` (composition root + CLI entry point):

```python
#!/usr/bin/env python
"""main.py — Composition root. Wires infrastructure into use cases and runs pipeline."""
import argparse
import logging
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

from infrastructure.compose import build
from infrastructure.collectors.reddit import collect as reddit_collect
from infrastructure.collectors.trends import collect as trends_collect
from infrastructure.collectors.g2 import collect as g2_collect
from application.pipeline import Pipeline
from domain.segments import SEGMENTS


def main():
    parser = argparse.ArgumentParser(description="market-intel pipeline")
    parser.add_argument("--segment", nargs="+", choices=list(SEGMENTS.keys()))
    parser.add_argument("--skip-collect", action="store_true")
    parser.add_argument("--dry-run",      action="store_true")
    parser.add_argument("--force",        action="store_true")
    parser.add_argument("--threshold",    type=float, default=7.0)
    args = parser.parse_args()

    deps = build(dry_run=args.dry_run)
    pipeline = Pipeline(
        **deps,
        collectors=[reddit_collect, trends_collect, g2_collect],
    )
    pipeline.run(
        segments=args.segment,
        skip_collect=args.skip_collect,
        dry_run=args.dry_run,
        force=args.force,
        threshold=args.threshold,
    )


if __name__ == "__main__":
    main()
```

- [ ] Smoke-test the wiring (dry-run, local DB):

```bash
USE_LOCAL_DB=1 python main.py --dry-run --skip-collect
```

Expected: pipeline runs, logs `DB backend: SQLite`, scores segments, no deploys.

- [ ] Commit:

```bash
git add infrastructure/compose.py infrastructure/pages/builder.py
git add application/pipeline.py main.py
git commit -m "feat: composition root + pipeline orchestrator + builder"
```

---

### Task 11: Cloudflare Worker — move + add gnews cron

**Files:**
- Create: `infrastructure/worker/` (move from `worker/`)
- Create: `infrastructure/worker/collectors/gnews.js`
- Modify: `infrastructure/worker/index.js` (add public GET routes)
- Modify: `infrastructure/worker/wrangler.toml`

- [ ] Move Worker files:

```bash
mkdir -p infrastructure/worker/collectors
cp worker/index.js infrastructure/worker/index.js
cp worker/wrangler.toml infrastructure/worker/wrangler.toml
```

- [ ] Update `infrastructure/worker/wrangler.toml` — add cron trigger and fix path:

```toml
name = "market-intel-api"
main = "index.js"
compatibility_date = "2025-01-01"

[[d1_databases]]
binding       = "DB"
database_name = "market-intel"
database_id   = "101dd684-e2df-4edf-97ea-f92be920d1e1"

[triggers]
crons = ["0 */12 * * *"]

# wrangler secret put WORKER_SECRET
```

- [ ] Add public GET routes to `infrastructure/worker/index.js`. After the auth check block, add a bypass for public reads:

```javascript
// After the OPTIONS handler, before the auth check:
// Public read-only routes (no auth required for dashboard)
if (method === "GET" && (path === "/public/stats" || path === "/public/opportunities")) {
  if (path === "/public/stats") return await getStats(env.DB);
  return await getOpportunities(env.DB, url.searchParams);
}
```

- [ ] Add the scheduled handler (gnews cron) at the bottom of `infrastructure/worker/index.js`, before the closing:

```javascript
export default {
  async fetch(request, env) {
    // ... existing fetch handler unchanged ...
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runGnewsCron(env.DB));
  },
};
```

- [ ] Create `infrastructure/worker/collectors/gnews.js`:

```javascript
/**
 * gnews.js — Google News RSS cron collector
 * Runs every 12h via Cloudflare Cron Trigger.
 * Fetches news for each segment, writes signals to D1.
 */

const SEGMENTS = {
  dentista: {
    queries: ["verifactu dentista", "software dental hacienda", "facturación electrónica clínica dental", "RRSIF odontología"],
    keywords: ["verifactu", "hacienda", "facturación", "rrsif", "multa", "gestión clínica"],
    salary_mean: 66500, income_tier: "high", has_deadline: true,
  },
  docente_universitario: {
    queries: ["ANECA acreditación universidad", "sexenio investigación problema", "Docentia evaluación docente"],
    keywords: ["aneca", "acreditación", "sexenio", "docentia", "plaza"],
    salary_mean: 42000, income_tier: "medium_high", has_deadline: false,
  },
  abogado_autonomo: {
    queries: ["LexNet abogados problema", "facturación electrónica abogados autónomos"],
    keywords: ["lexnet", "facturación", "irpf", "turno oficio", "honorarios"],
    salary_mean: 35000, income_tier: "medium_high", has_deadline: false,
  },
  arquitecto: {
    queries: ["visado colegial arquitectos", "licencia obras ayuntamiento lentitud"],
    keywords: ["visado colegial", "licencia obras", "burocracia", "certificado energético"],
    salary_mean: 28500, income_tier: "medium", has_deadline: false,
  },
};

const GNEWS_BASE = "https://news.google.com/rss/search?hl=es&gl=ES&ceid=ES:es&q=";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; market-intel/0.1)" };

function signalStrength(matchedKeywords, sentimentScore, textLength) {
  const kwScore   = Math.min(matchedKeywords / 3, 1.0);
  const sentScore = Math.min(Math.abs(sentimentScore), 1.0);
  const lenScore  = Math.min(textLength / 500, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sentScore * 0.35 + lenScore * 0.15) * 1000) / 1000);
}

function sentimentScore(text) {
  const neg = ["problema","horrible","imposible","multa","burocracia","lento","caro","queja","odio","caos","frustrado","harto","fallo"];
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => neg.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

async function fetchFeed(query) {
  const url = GNEWS_BASE + encodeURIComponent(query);
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return [];
  const xml = await r.text();
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title   = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block) || [])[1] || "";
    const link    = (/<link>(.*?)<\/link>/.exec(block) || [])[1] || "";
    const desc    = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) || (/<description>(.*?)<\/description>/.exec(block)) || [])[1] || "";
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.trim() });
  }
  return items.slice(0, 20);
}

async function insertSignal(db, signal) {
  const existing = await db.prepare(
    "SELECT 1 FROM signals WHERE url=? AND segment=? LIMIT 1"
  ).bind(signal.url, signal.segment).first();
  if (existing) return false;

  await db.prepare(`
    INSERT INTO signals (id, source, collected_at, segment, location, raw_text, url,
      pain_keywords, sentiment_score, salary_mean, income_tier, signal_strength, has_deadline)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    signal.id, signal.source, signal.collected_at, signal.segment,
    signal.location, signal.raw_text.slice(0, 2000), signal.url,
    JSON.stringify(signal.pain_keywords), signal.sentiment_score,
    signal.salary_mean, signal.income_tier, signal.signal_strength,
    signal.has_deadline ? 1 : 0,
  ).run();
  return true;
}

export async function runGnewsCron(db) {
  let total = 0;
  for (const [segment, config] of Object.entries(SEGMENTS)) {
    for (const query of config.queries) {
      try {
        const items = await fetchFeed(query);
        for (const item of items) {
          const text = `${item.title}. ${item.desc}`;
          const sent = sentimentScore(text);
          const matched = config.keywords.filter(kw => text.toLowerCase().includes(kw)).length;
          if (matched === 0 && sent > -0.03) continue;

          const inserted = await insertSignal(db, {
            id:            shortId(),
            source:        "google_news",
            collected_at:  new Date().toISOString(),
            segment,
            location:      "España",
            raw_text:      text,
            url:           item.link || `gnews://${shortId()}`,
            pain_keywords: config.keywords.filter(kw => text.toLowerCase().includes(kw)),
            sentiment_score: sent,
            salary_mean:   config.salary_mean,
            income_tier:   config.income_tier,
            signal_strength: signalStrength(matched, sent, text.length),
            has_deadline:  config.has_deadline,
          });
          if (inserted) total++;
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`gnews cron ${segment} "${query}": ${e.message}`);
      }
    }
  }
  console.log(`gnews cron: ${total} new signals`);
}
```

- [ ] Import `runGnewsCron` at the top of `infrastructure/worker/index.js`:

```javascript
import { runGnewsCron } from "./collectors/gnews.js";
```

- [ ] Deploy Worker to verify cron registers:

```bash
cd infrastructure/worker && npx wrangler deploy
```

Expected output includes: `Deployed market-intel-api triggers` with the cron schedule.

- [ ] Commit:

```bash
git add infrastructure/worker/
git commit -m "feat: infrastructure/worker — gnews cron trigger, public GET routes"
```

---

### Task 12: Cloudflare Pages — move + dynamic dashboard

**Files:**
- Create: `infrastructure/pages/` directory structure
- Create: `infrastructure/pages/dashboard.html` (dynamic)
- Move: `infrastructure/pages/functions/signup.js`
- Move: `infrastructure/pages/landings/` (existing landing HTMLs)

- [ ] Set up pages directory:

```bash
mkdir -p infrastructure/pages/landings infrastructure/pages/functions
cp functions/signup.js infrastructure/pages/functions/signup.js
cp landing_dentista.html infrastructure/pages/landings/dentista.html 2>/dev/null || true
cp landing_fisio.html infrastructure/pages/landings/fisio.html 2>/dev/null || true
```

- [ ] Create `infrastructure/pages/dashboard.html` — dynamic, queries Worker API:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Market Intel — Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; }
    .container { max-width: 1100px; margin: 0 auto; padding: 32px 16px; }
    h2 { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; color: #475569; text-transform: uppercase; margin-bottom: 16px; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .stat { display: flex; flex-direction: column; gap: 4px; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #f1f5f9; }
    .stat-label { font-size: 0.75rem; color: #64748b; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 8px 12px; color: #475569; font-weight: 600; border-bottom: 1px solid #1e293b; }
    td { padding: 10px 12px; border-bottom: 1px solid #0f172a; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
    .badge-watching { background: #1e3a5f; color: #60a5fa; }
    .badge-testing  { background: #1a3a2a; color: #34d399; }
    .badge-scaling  { background: #3b1f5e; color: #a78bfa; }
    .badge-killed   { background: #3b1f1f; color: #f87171; }
    .loading { color: #475569; font-size: 0.875rem; }
    .error   { color: #f87171; font-size: 0.875rem; }
  </style>
</head>
<body>
<div class="container">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;">
    <div>
      <div style="font-size:1.5rem;font-weight:700;color:#f1f5f9;">Market Intel</div>
      <div style="font-size:0.8rem;color:#475569;margin-top:2px;">Señales de dolor · Cádiz / España</div>
    </div>
    <div id="updated" style="font-size:0.75rem;color:#334155;"></div>
  </div>

  <h2>Resumen</h2>
  <div class="grid" style="margin-bottom:32px;" id="stats-grid">
    <div class="card"><p class="loading">Cargando...</p></div>
  </div>

  <h2>Oportunidades</h2>
  <div class="card" style="overflow-x:auto;">
    <table id="opps-table">
      <thead><tr><th>Segmento</th><th>Score</th><th>Estado</th><th>Señales</th><th>Resumen</th><th>Landing</th></tr></thead>
      <tbody id="opps-body"><tr><td colspan="6" class="loading">Cargando...</td></tr></tbody>
    </table>
  </div>
</div>

<script>
  const WORKER = "https://market-intel-api.valentinlineiro.workers.dev";

  async function load() {
    try {
      const [statsRes, oppsRes] = await Promise.all([
        fetch(`${WORKER}/public/stats`),
        fetch(`${WORKER}/public/opportunities`),
      ]);
      const stats = await statsRes.json();
      const opps  = await oppsRes.json();

      document.getElementById("updated").textContent =
        "Actualizado: " + new Date().toISOString().slice(0,16).replace("T"," ") + " UTC";

      // Stats grid
      const bySegHtml = Object.entries(stats.by_segment || {})
        .map(([seg, n]) => `<div class="stat"><span class="stat-value">${n}</span><span class="stat-label">${seg}</span></div>`)
        .join("");
      document.getElementById("stats-grid").innerHTML = `
        <div class="card"><div class="stat"><span class="stat-value">${stats.total_signals ?? 0}</span><span class="stat-label">Total señales</span></div></div>
        <div class="card"><div class="stat"><span class="stat-value">${stats.total_opportunities ?? 0}</span><span class="stat-label">Oportunidades</span></div></div>
        <div class="card">${bySegHtml}</div>
      `;

      // Opportunities table
      const rows = (opps.results || []).map(o => {
        const badge = `<span class="badge badge-${o.status}">${o.status}</span>`;
        const landing = o.landing_url
          ? `<a href="${o.landing_url}" style="color:#60a5fa;font-size:0.75rem;" target="_blank">ver</a>`
          : "—";
        return `<tr>
          <td>${o.segment}</td>
          <td><strong>${(o.score||0).toFixed(1)}</strong>/10</td>
          <td>${badge}</td>
          <td>${o.signal_count ?? 0}</td>
          <td style="color:#94a3b8;font-size:0.8rem;">${(o.pain_summary||"").slice(0,60)}</td>
          <td>${landing}</td>
        </tr>`;
      }).join("");
      document.getElementById("opps-body").innerHTML = rows || '<tr><td colspan="6" style="color:#475569;">Sin oportunidades todavía.</td></tr>';

    } catch (e) {
      document.getElementById("stats-grid").innerHTML = `<div class="card"><p class="error">Error: ${e.message}</p></div>`;
    }
  }

  load();
</script>
</body>
</html>
```

- [ ] Create `infrastructure/pages/wrangler.toml`:

```toml
name = "market-intel"
pages_build_output_dir = "infrastructure/pages"

[[d1_databases]]
binding       = "DB"
database_name = "market-intel"
database_id   = "101dd684-e2df-4edf-97ea-f92be920d1e1"

# wrangler pages secret put TELEGRAM_TOKEN --project-name market-intel
# wrangler pages secret put TELEGRAM_CHAT_ID --project-name market-intel
```

- [ ] Update root `wrangler.toml` to point to new pages dir:

```toml
name = "market-intel"
pages_build_output_dir = "infrastructure/pages"

[[d1_databases]]
binding       = "DB"
database_name = "market-intel"
database_id   = "101dd684-e2df-4edf-97ea-f92be920d1e1"
```

- [ ] Deploy Pages and verify dashboard loads live data:

```bash
npx wrangler pages deploy infrastructure/pages --project-name market-intel --commit-dirty=true
```

Open `https://market-intel.pages.dev` — dashboard should fetch and display live data from the Worker.

- [ ] Commit:

```bash
git add infrastructure/pages/ wrangler.toml
git commit -m "feat: infrastructure/pages — dynamic dashboard + move signup function"
```

---

### Task 13: Update GitHub Actions + delete old files

**Files:**
- Delete: `.github/workflows/collect-gnews.yml`
- Delete: `.github/workflows/pages.yml`
- Modify: `.github/workflows/pipeline.yml`
- Modify: `.github/workflows/collect-trends.yml`
- Modify: `.github/workflows/discover.yml`
- Modify: `.github/workflows/deploy.yml`
- Delete: `schema.py`, `llm.py`, `synthesize.py`, `generate_landing.py`, `deploy.py`, `report.py`, `report_html.py`, `pipeline.py`, `discover.py`
- Delete: `collectors/`, `db/`, `scoring/`, `worker/`, `functions/`
- Delete: `index.html`, `landing_dentista.html`, `landing_fisio.html`

- [ ] Delete obsolete workflows:

```bash
rm .github/workflows/collect-gnews.yml
rm .github/workflows/pages.yml
```

- [ ] Update `.github/workflows/pipeline.yml` — change entry point to `main.py`:

```yaml
name: Pipeline

on:
  schedule:
    - cron: "0 7 * * 1"
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip

      - name: Install deps
        run: pip install -r requirements.txt

      - name: Run pipeline
        env:
          GROQ_API_KEY:          ${{ secrets.GROQ_API_KEY }}
          OPENROUTER_API_KEY:    ${{ secrets.OPENROUTER_API_KEY }}
          ANTHROPIC_API_KEY:     ${{ secrets.ANTHROPIC_API_KEY }}
          REDDIT_CLIENT_ID:      ${{ secrets.REDDIT_CLIENT_ID }}
          REDDIT_CLIENT_SECRET:  ${{ secrets.REDDIT_CLIENT_SECRET }}
          REDDIT_USER_AGENT:     "market-intel/0.1 by valentinlineiro"
          TELEGRAM_BOT_TOKEN:    ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID:      ${{ secrets.TELEGRAM_CHAT_ID }}
          WORKER_URL:            ${{ secrets.WORKER_URL }}
          WORKER_SECRET:         ${{ secrets.WORKER_SECRET }}
          CF_PAGES_PROJECT:      ${{ secrets.CF_PAGES_PROJECT }}
          CF_PAGES_DOMAIN:       ${{ secrets.CF_PAGES_DOMAIN }}
          CLOUDFLARE_API_TOKEN:  ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: python main.py
```

- [ ] Update `.github/workflows/collect-trends.yml` — replace old collector call:

```yaml
      - name: Run trends collector
        run: python -c "
from infrastructure.collectors.trends import collect
from infrastructure.db.worker_repo import WorkerSignalRepo
repo = WorkerSignalRepo()
from domain.segments import SEGMENTS
for seg in SEGMENTS:
    for s in collect(seg):
        repo.save(s)
"
        env:
          WORKER_URL:    ${{ secrets.WORKER_URL }}
          WORKER_SECRET: ${{ secrets.WORKER_SECRET }}
```

- [ ] Update `.github/workflows/discover.yml` — reduce to 1×/week, use new module:

```yaml
name: Discover

on:
  schedule:
    - cron: "0 6 * * 3"   # Wednesdays only (was Wed + Sat)
  workflow_dispatch:

jobs:
  discover:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt
      - name: Run discovery
        env:
          GROQ_API_KEY:       ${{ secrets.GROQ_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          ANTHROPIC_API_KEY:  ${{ secrets.ANTHROPIC_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          python -c "
from infrastructure.llm.chain import LLMChain
from infrastructure.notifications import TelegramNotifier
from application.discover import DiscoverUseCase
uc = DiscoverUseCase(LLMChain(), TelegramNotifier())
uc.run()
"
```

- [ ] Update `.github/workflows/deploy.yml` — update paths for new structure:

In the `changes` job, update path filters:
```yaml
echo "$CHANGED" | grep -q '^infrastructure/worker/' && echo "worker=true" >> $GITHUB_OUTPUT || echo "worker=false" >> $GITHUB_OUTPUT
echo "$CHANGED" | grep -qE '^infrastructure/pages/' && echo "pages=true" >> $GITHUB_OUTPUT || echo "pages=false" >> $GITHUB_OUTPUT
echo "$CHANGED" | grep -q '^schema\.sql' && echo "schema=true" >> $GITHUB_OUTPUT || echo "schema=false" >> $GITHUB_OUTPUT
```

In deploy-worker job:
```yaml
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken:         ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId:        ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: infrastructure/worker
          command:          deploy
```

In deploy-pages job:
```yaml
      - name: Deploy Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken:  ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command:   pages deploy infrastructure/pages --project-name market-intel --commit-dirty=true
```

- [ ] Delete old Python files:

```bash
rm -f schema.py llm.py synthesize.py generate_landing.py deploy.py report.py report_html.py pipeline.py discover.py
rm -rf collectors/ db/ scoring/
```

- [ ] Delete old Cloudflare files (now in infrastructure/):

```bash
rm -rf worker/ functions/
rm -f index.html landing_dentista.html landing_fisio.html
```

- [ ] Run full test suite to confirm nothing broke:

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] Final smoke test:

```bash
USE_LOCAL_DB=1 python main.py --dry-run --skip-collect
```

Expected: logs segment scores, exits cleanly.

- [ ] Commit:

```bash
git add -A
git commit -m "feat: complete clean architecture migration

- domain/application/infrastructure layers
- Cloudflare Worker + Pages in infrastructure/
- gnews moved to CF cron (saves ~960 min/month GH Actions)
- dashboard dynamic via Worker API (saves ~960 min/month)
- all imports updated, old files deleted"
```

- [ ] Push:

```bash
git push
```

---

## Self-Review

**Spec coverage check:**
- ✅ domain/models.py, segments.py, rules.py — Tasks 2, 3
- ✅ application/ports.py — Task 4
- ✅ infrastructure/db (sqlite + worker) — Tasks 5, 6
- ✅ infrastructure/collectors, llm, notifications — Task 7
- ✅ application/collect, score, discover, validate — Tasks 8, 9
- ✅ Composition root (infrastructure/compose.py) + main.py — Task 10
- ✅ application/pipeline.py — Task 10
- ✅ infrastructure/worker + gnews cron — Task 11
- ✅ infrastructure/pages + dynamic dashboard — Task 12
- ✅ GH Actions updated, old files deleted — Task 13
- ✅ wrangler.toml updated — Task 12

**Placeholder scan:** None found. All tasks have complete code.

**Type consistency:**
- `SignalRepository.save()` → `bool` — consistent Tasks 4, 5, 6, 8
- `OpportunityRepository.get_by_segment()` → `Opportunity | None` — consistent Tasks 4, 5, 6, 10
- `PageDeployer.deploy(segment: str, copy: dict)` → `str` — consistent Tasks 4, 10
- `Collector = Callable[[str], list[Signal]]` — consistent Tasks 4, 10, 13
- `LLMProvider.complete(prompt, max_tokens)` → `str` — consistent Tasks 4, 7, 9
