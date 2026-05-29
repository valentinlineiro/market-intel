"""
db/database.py

Router de acceso a datos. Detecta backend automáticamente:
  - D1 (Cloudflare) si CF_D1_DATABASE_ID + CLOUDFLARE_API_TOKEN están configuradas
  - SQLite local en caso contrario

Interfaz pública idéntica en ambos backends — ningún otro módulo cambia.
"""

import sqlite3
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from schema import DDL, Signal, Opportunity, SEGMENTS
from db import d1

log = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent / "market_intel.db"


# ── Detección de backend ──────────────────────────────────────────────────

def _use_d1() -> bool:
    return d1.available()


# ── SQLite local ──────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ── Interfaz pública ──────────────────────────────────────────────────────

def init_db():
    if _use_d1():
        log.info("Backend: Cloudflare D1")
        # D1 no soporta executescript múltiple — dividir por ";"
        statements = [s.strip() for s in DDL.split(";") if s.strip()]
        for stmt in statements:
            try:
                d1.execute(stmt)
            except Exception as e:
                # CREATE TABLE/INDEX IF NOT EXISTS puede dar "already exists" — ignorar
                if "already exists" not in str(e).lower():
                    raise
    else:
        log.debug("Backend: SQLite local (%s)", DB_PATH)
        with _get_conn() as conn:
            conn.executescript(DDL)


def insert_signal(s: Signal) -> bool:
    """Inserta señal. Ignora duplicados por (url, segment). Retorna True si insertada."""
    sql = """
        INSERT OR IGNORE INTO signals
        (id, source, collected_at, segment, location, raw_text, url,
         pain_keywords, sentiment_score, salary_mean, income_tier,
         signal_strength, has_deadline)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    """
    seg_data = SEGMENTS.get(s.segment, {})
    params = [
        s.id,
        s.source.value,
        s.collected_at.isoformat(),
        s.segment,
        s.location,
        s.raw_text[:2000],
        s.url,
        json.dumps(s.pain_keywords_found),
        s.sentiment_score,
        seg_data.get("salary_mean", 0),
        seg_data.get("income_tier", ""),
        s.signal_strength,
        1 if seg_data.get("active_deadline") else 0,
    ]

    if _use_d1():
        # D1 no tiene INSERT OR IGNORE — simular con NOT EXISTS
        sql = sql.replace("INSERT OR IGNORE", "INSERT")
        exists_sql = "SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1"
        existing = d1.execute(exists_sql, [s.url, s.segment])
        if existing:
            return False
        d1.execute(sql, params)
        return True
    else:
        with _get_conn() as conn:
            cur = conn.execute(sql, params)
            return cur.rowcount > 0


def upsert_opportunity(o: Opportunity):
    params = [
        o.id, o.segment, o.pain_summary, o.score,
        json.dumps(o.score_breakdown), json.dumps(o.signal_ids),
        o.signal_count,
        o.first_seen.isoformat(),
        o.last_updated.isoformat(),
        o.status, o.landing_url, o.emails_captured,
        o.validation_deadline.isoformat() if o.validation_deadline else None,
        o.telegram_alerted_at.isoformat() if o.telegram_alerted_at else None,
    ]

    if _use_d1():
        # D1 soporta ON CONFLICT (SQLite syntax)
        sql = """
            INSERT INTO opportunities
            (id, segment, pain_summary, score, score_breakdown, signal_ids,
             signal_count, first_seen, last_updated, status, landing_url,
             emails_captured, validation_deadline, telegram_alerted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                score               = excluded.score,
                score_breakdown     = excluded.score_breakdown,
                signal_ids          = excluded.signal_ids,
                signal_count        = excluded.signal_count,
                last_updated        = excluded.last_updated,
                status              = excluded.status,
                emails_captured     = excluded.emails_captured,
                landing_url         = excluded.landing_url,
                validation_deadline = excluded.validation_deadline,
                telegram_alerted_at = excluded.telegram_alerted_at
        """
        d1.execute(sql, params)
    else:
        sql = """
            INSERT INTO opportunities
            (id, segment, pain_summary, score, score_breakdown, signal_ids,
             signal_count, first_seen, last_updated, status, landing_url,
             emails_captured, validation_deadline, telegram_alerted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                score               = excluded.score,
                score_breakdown     = excluded.score_breakdown,
                signal_ids          = excluded.signal_ids,
                signal_count        = excluded.signal_count,
                last_updated        = excluded.last_updated,
                status              = excluded.status,
                emails_captured     = excluded.emails_captured,
                landing_url         = excluded.landing_url,
                validation_deadline = excluded.validation_deadline,
                telegram_alerted_at = excluded.telegram_alerted_at
        """
        with _get_conn() as conn:
            conn.execute(sql, params)


def get_signals(segment: Optional[str] = None, limit: int = 100) -> list[dict]:
    if segment:
        sql    = "SELECT * FROM signals WHERE segment = ? ORDER BY collected_at DESC LIMIT ?"
        params = [segment, limit]
    else:
        sql    = "SELECT * FROM signals ORDER BY collected_at DESC LIMIT ?"
        params = [limit]

    if _use_d1():
        rows = d1.execute(sql, params)
        # D1 devuelve pain_keywords como string — deserializar
        for r in rows:
            if isinstance(r.get("pain_keywords"), str):
                try:
                    r["pain_keywords"] = json.loads(r["pain_keywords"])
                except (json.JSONDecodeError, TypeError):
                    pass
        return rows
    else:
        with _get_conn() as conn:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]


def get_signal_count(segment: Optional[str] = None) -> int:
    if segment:
        sql    = "SELECT COUNT(*) as n FROM signals WHERE segment = ?"
        params = [segment]
    else:
        sql    = "SELECT COUNT(*) as n FROM signals"
        params = []

    if _use_d1():
        rows = d1.execute(sql, params)
        return rows[0]["n"] if rows else 0
    else:
        with _get_conn() as conn:
            return conn.execute(sql, params).fetchone()[0]


def get_opportunities(status: Optional[str] = None) -> list[dict]:
    if status:
        sql    = "SELECT * FROM opportunities WHERE status = ? ORDER BY score DESC"
        params = [status]
    else:
        sql    = "SELECT * FROM opportunities ORDER BY score DESC"
        params = []

    if _use_d1():
        return d1.execute(sql, params)
    else:
        with _get_conn() as conn:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]


def signal_exists(url: str, segment: str) -> bool:
    sql    = "SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1"
    params = [url, segment]

    if _use_d1():
        return bool(d1.execute(sql, params))
    else:
        with _get_conn() as conn:
            return conn.execute(sql, params).fetchone() is not None


def get_stats() -> dict:
    if _use_d1():
        total_signals = (d1.execute("SELECT COUNT(*) as n FROM signals") or [{"n": 0}])[0]["n"]
        by_seg_rows   = d1.execute("SELECT segment, COUNT(*) as n FROM signals GROUP BY segment")
        by_segment    = {r["segment"]: r["n"] for r in by_seg_rows}
        total_opps    = (d1.execute("SELECT COUNT(*) as n FROM opportunities") or [{"n": 0}])[0]["n"]
        top_rows      = d1.execute("SELECT score, pain_summary FROM opportunities ORDER BY score DESC LIMIT 1")
        top_score     = top_rows[0] if top_rows else None
    else:
        with _get_conn() as conn:
            total_signals = conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0]
            by_segment    = dict(conn.execute(
                "SELECT segment, COUNT(*) FROM signals GROUP BY segment"
            ).fetchall())
            total_opps    = conn.execute("SELECT COUNT(*) FROM opportunities").fetchone()[0]
            top_row       = conn.execute(
                "SELECT score, pain_summary FROM opportunities ORDER BY score DESC LIMIT 1"
            ).fetchone()
            top_score     = dict(top_row) if top_row else None

    return {
        "total_signals":       total_signals,
        "by_segment":          by_segment,
        "total_opportunities": total_opps,
        "top_opportunity":     top_score,
        "backend":             "d1" if _use_d1() else "sqlite",
    }
