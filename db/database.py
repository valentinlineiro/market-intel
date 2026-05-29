"""
db/database.py
Capa de acceso a SQLite. Operaciones atómicas sobre signals y opportunities.
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Optional
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from schema import DDL, Signal, Opportunity, SEGMENTS

DB_PATH = Path(__file__).parent.parent / "market_intel.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript(DDL)


def insert_signal(s: Signal) -> bool:
    """Inserta señal. Ignora duplicados por (source, url, segment)."""
    sql = """
        INSERT OR IGNORE INTO signals
        (id, source, collected_at, segment, location, raw_text, url,
         pain_keywords, sentiment_score, salary_mean, income_tier,
         signal_strength, has_deadline)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    """
    seg_data = SEGMENTS.get(s.segment, {})
    with get_conn() as conn:
        cur = conn.execute(sql, (
            s.id,
            s.source.value,
            s.collected_at.isoformat(),
            s.segment,
            s.location,
            s.raw_text[:2000],          # truncar textos largos
            s.url,
            json.dumps(s.pain_keywords_found),
            s.sentiment_score,
            seg_data.get("salary_mean", 0),
            seg_data.get("income_tier", ""),
            s.signal_strength,
            1 if seg_data.get("active_deadline") else 0,
        ))
        return cur.rowcount > 0


def upsert_opportunity(o: Opportunity):
    sql = """
        INSERT INTO opportunities
        (id, segment, pain_summary, score, score_breakdown, signal_ids,
         signal_count, first_seen, last_updated, status, landing_url,
         emails_captured, validation_deadline)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            score          = excluded.score,
            score_breakdown= excluded.score_breakdown,
            signal_ids     = excluded.signal_ids,
            signal_count   = excluded.signal_count,
            last_updated   = excluded.last_updated,
            status         = excluded.status,
            emails_captured= excluded.emails_captured
    """
    with get_conn() as conn:
        conn.execute(sql, (
            o.id,
            o.segment,
            o.pain_summary,
            o.score,
            json.dumps(o.score_breakdown),
            json.dumps(o.signal_ids),
            o.signal_count,
            o.first_seen.isoformat(),
            o.last_updated.isoformat(),
            o.status,
            o.landing_url,
            o.emails_captured,
            o.validation_deadline.isoformat() if o.validation_deadline else None,
        ))


def get_signals(segment: Optional[str] = None, limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM signals"
    params = []
    if segment:
        sql += " WHERE segment = ?"
        params.append(segment)
    sql += " ORDER BY collected_at DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def get_opportunities(status: Optional[str] = None) -> list[dict]:
    sql = "SELECT * FROM opportunities"
    params = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY score DESC"
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def signal_exists(url: str, segment: str) -> bool:
    sql = "SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1"
    with get_conn() as conn:
        return conn.execute(sql, (url, segment)).fetchone() is not None


def get_stats() -> dict:
    with get_conn() as conn:
        total_signals = conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0]
        by_segment = dict(conn.execute(
            "SELECT segment, COUNT(*) FROM signals GROUP BY segment"
        ).fetchall())
        total_opps = conn.execute("SELECT COUNT(*) FROM opportunities").fetchone()[0]
        top_score = conn.execute(
            "SELECT score, pain_summary FROM opportunities ORDER BY score DESC LIMIT 1"
        ).fetchone()
    return {
        "total_signals": total_signals,
        "by_segment": by_segment,
        "total_opportunities": total_opps,
        "top_opportunity": dict(top_score) if top_score else None,
    }
