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
        try:
            conn.executescript(_DDL)
        except Exception:
            # Partial DDL already applied (e.g. unique index blocked by existing dupes)
            # Tables are still created; proceed
            pass


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
