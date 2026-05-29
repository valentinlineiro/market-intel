"""
db/database.py

Router de acceso a datos. Prioridad de backend:
  1. Worker API  (WORKER_URL + WORKER_SECRET)         ← producción
  2. D1 REST API (CF_D1_DATABASE_ID + tokens)         ← fallback CI sin Worker
  3. SQLite local                                      ← desarrollo local

Interfaz pública idéntica en los tres casos.
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
from db import d1, worker_client

log = logging.getLogger(__name__)
DB_PATH = Path(__file__).parent.parent / "market_intel.db"


# ── Detección de backend ──────────────────────────────────────────────────

def _backend() -> str:
    if worker_client.available(): return "worker"
    if d1.available():            return "d1"
    return "sqlite"


# ── SQLite helpers ────────────────────────────────────────────────────────

def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ── Interfaz pública ──────────────────────────────────────────────────────

def init_db():
    b = _backend()
    log.info(f"DB backend: {b}")
    if b == "worker":
        # El Worker ya tiene D1 inicializado — health check
        try:
            worker_client.get("/health")
        except Exception as e:
            raise RuntimeError(f"Worker no responde: {e}")
    elif b == "d1":
        statements = [s.strip() for s in DDL.split(";") if s.strip()]
        for stmt in statements:
            try:
                d1.execute(stmt)
            except Exception as e:
                if "already exists" not in str(e).lower():
                    raise
    else:
        with _conn() as conn:
            conn.executescript(DDL)


def insert_signal(s: Signal) -> bool:
    seg_data = SEGMENTS.get(s.segment, {})
    b = _backend()

    if b == "worker":
        result = worker_client.post("/signals", {
            "id":             s.id,
            "source":         s.source.value,
            "collected_at":   s.collected_at.isoformat(),
            "segment":        s.segment,
            "location":       s.location,
            "raw_text":       s.raw_text[:2000],
            "url":            s.url,
            "pain_keywords":  s.pain_keywords_found,
            "sentiment_score":  s.sentiment_score,
            "salary_mean":      seg_data.get("salary_mean", 0),
            "income_tier":      seg_data.get("income_tier", ""),
            "signal_strength":  s.signal_strength,
            "has_deadline":     bool(seg_data.get("active_deadline")),
        })
        return result.get("inserted", False)

    params = [
        s.id, s.source.value, s.collected_at.isoformat(), s.segment,
        s.location, s.raw_text[:2000], s.url,
        json.dumps(s.pain_keywords_found), s.sentiment_score,
        seg_data.get("salary_mean", 0), seg_data.get("income_tier", ""),
        s.signal_strength, 1 if seg_data.get("active_deadline") else 0,
    ]
    sql = """INSERT OR IGNORE INTO signals
        (id, source, collected_at, segment, location, raw_text, url,
         pain_keywords, sentiment_score, salary_mean, income_tier,
         signal_strength, has_deadline)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"""

    if b == "d1":
        existing = d1.execute(
            "SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1",
            [s.url, s.segment]
        )
        if existing: return False
        d1.execute(sql.replace("INSERT OR IGNORE", "INSERT"), params)
        return True
    else:
        with _conn() as conn:
            return conn.execute(sql, params).rowcount > 0


def upsert_opportunity(o: Opportunity):
    b = _backend()

    if b == "worker":
        worker_client.post("/opportunities", {
            "id":                   o.id,
            "segment":              o.segment,
            "pain_summary":         o.pain_summary,
            "score":                o.score,
            "score_breakdown":      o.score_breakdown,
            "signal_ids":           o.signal_ids,
            "signal_count":         o.signal_count,
            "first_seen":           o.first_seen.isoformat(),
            "last_updated":         o.last_updated.isoformat(),
            "status":               o.status,
            "landing_url":          o.landing_url,
            "emails_captured":      o.emails_captured,
            "validation_deadline":  o.validation_deadline.isoformat() if o.validation_deadline else None,
            "telegram_alerted_at":  o.telegram_alerted_at.isoformat()  if o.telegram_alerted_at  else None,
        })
        return

    sql = """
        INSERT INTO opportunities
        (id, segment, pain_summary, score, score_breakdown, signal_ids,
         signal_count, first_seen, last_updated, status, landing_url,
         emails_captured, validation_deadline, telegram_alerted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            score=excluded.score, score_breakdown=excluded.score_breakdown,
            signal_ids=excluded.signal_ids, signal_count=excluded.signal_count,
            last_updated=excluded.last_updated, status=excluded.status,
            emails_captured=excluded.emails_captured, landing_url=excluded.landing_url,
            validation_deadline=excluded.validation_deadline,
            telegram_alerted_at=excluded.telegram_alerted_at
    """
    params = [
        o.id, o.segment, o.pain_summary, o.score,
        json.dumps(o.score_breakdown), json.dumps(o.signal_ids),
        o.signal_count, o.first_seen.isoformat(), o.last_updated.isoformat(),
        o.status, o.landing_url, o.emails_captured,
        o.validation_deadline.isoformat() if o.validation_deadline else None,
        o.telegram_alerted_at.isoformat()  if o.telegram_alerted_at  else None,
    ]
    if b == "d1":
        d1.execute(sql, params)
    else:
        with _conn() as conn:
            conn.execute(sql, params)


def get_signals(segment: Optional[str] = None, limit: int = 100) -> list[dict]:
    b = _backend()
    if b == "worker":
        p = {"limit": limit}
        if segment: p["segment"] = segment
        return worker_client.get("/signals", p).get("results", [])

    sql    = "SELECT * FROM signals" + (" WHERE segment = ?" if segment else "") + " ORDER BY collected_at DESC LIMIT ?"
    params = ([segment, limit] if segment else [limit])
    if b == "d1":   return d1.execute(sql, params)
    with _conn() as conn: return [dict(r) for r in conn.execute(sql, params).fetchall()]


def get_signal_count(segment: Optional[str] = None) -> int:
    b = _backend()
    if b == "worker":
        p = {"segment": segment} if segment else {}
        return worker_client.get("/signals/count", p).get("count", 0)

    sql    = "SELECT COUNT(*) as n FROM signals" + (" WHERE segment = ?" if segment else "")
    params = ([segment] if segment else [])
    if b == "d1":   return (d1.execute(sql, params) or [{"n": 0}])[0]["n"]
    with _conn() as conn: return conn.execute(sql, params).fetchone()[0]


def get_opportunities(status: Optional[str] = None) -> list[dict]:
    b = _backend()
    if b == "worker":
        p = {"status": status} if status else {}
        return worker_client.get("/opportunities", p).get("results", [])

    sql    = "SELECT * FROM opportunities" + (" WHERE status = ?" if status else "") + " ORDER BY score DESC"
    params = ([status] if status else [])
    if b == "d1":   return d1.execute(sql, params)
    with _conn() as conn: return [dict(r) for r in conn.execute(sql, params).fetchall()]


def signal_exists(url: str, segment: str) -> bool:
    # Optimización: el Worker ya hace dedup en insert — evitar round-trip extra
    b = _backend()
    sql    = "SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1"
    params = [url, segment]
    if b == "d1":     return bool(d1.execute(sql, params))
    if b == "worker": return False   # el Worker rechaza duplicados en POST /signals
    with _conn() as conn: return conn.execute(sql, params).fetchone() is not None


def get_stats() -> dict:
    b = _backend()
    if b == "worker":
        return worker_client.get("/stats")

    if b == "d1":
        total_signals = (d1.execute("SELECT COUNT(*) as n FROM signals") or [{"n":0}])[0]["n"]
        by_seg        = {r["segment"]: r["n"] for r in d1.execute("SELECT segment, COUNT(*) as n FROM signals GROUP BY segment")}
        total_opps    = (d1.execute("SELECT COUNT(*) as n FROM opportunities") or [{"n":0}])[0]["n"]
        top           = (d1.execute("SELECT score, pain_summary FROM opportunities ORDER BY score DESC LIMIT 1") or [None])[0]
    else:
        with _conn() as conn:
            total_signals = conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0]
            by_seg        = dict(conn.execute("SELECT segment, COUNT(*) FROM signals GROUP BY segment").fetchall())
            total_opps    = conn.execute("SELECT COUNT(*) FROM opportunities").fetchone()[0]
            top_row       = conn.execute("SELECT score, pain_summary FROM opportunities ORDER BY score DESC LIMIT 1").fetchone()
            top           = dict(top_row) if top_row else None

    return {"total_signals": total_signals, "by_segment": by_seg,
            "total_opportunities": total_opps, "top_opportunity": top, "backend": b}
