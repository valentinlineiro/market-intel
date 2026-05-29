"""
market_intel/schema.py
Schema central del sistema de inteligencia de mercado.
Todos los tipos de datos, constantes y lógica de scoring.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional
import uuid


# ─────────────────────────────────────────────
# SEGMENTOS — datos reales INE/CalcuLaboral 2023-2026
# ─────────────────────────────────────────────

SEGMENTS = {
    "dentista": {
        "label": "Dentista / Clínica dental",
        "cnae": "8621",                        # Actividades de medicina general
        "cno": "2211",                          # Médicos de familia y generalistas
        "salary_min": 25_000,
        "salary_mean": 66_500,                  # CalcuLaboral 2026, fuente INE EES
        "salary_max": 120_000,
        "income_tier": "high",
        "population_spain": 35_000,             # dentistas colegiados aprox.
        "population_cadiz": 400,                # estimado Colegio Dentistas Cádiz
        "pain_keywords": [
            "verifactu", "software homologado", "hacienda", "facturación",
            "rrsif", "multa", "gestión clínica", "historia clínica",
            "seguros dentales", "cuadro médico", "aseguradora",
        ],
        "active_deadline": "2026-01-01",        # RRSIF obligatorio
        "competition_proxy": 4.0,               # Clinic Cloud + Gesden con cuota alta
        "notes": "Deadline fiscal activo. Multas hasta 50k€. Mercado nacional.",
    },

    "docente_universitario": {
        "label": "Docente universitario (PDI)",
        "cnae": "8542",                         # Enseñanza universitaria
        "cno": "2310",                          # Profesores de universidades
        "salary_min": 28_000,
        "salary_mean": 42_000,                  # Titular Universidad, estimado
        "salary_max": 65_000,                   # Catedrático
        "income_tier": "medium_high",
        "population_spain": 120_000,            # PDI España aprox.
        "population_cadiz": 1_800,              # UCA aprox.
        "pain_keywords": [
            "aneca", "acreditación", "docentia", "sexenio", "quinquenio",
            "expediente", "méritos", "tramos", "evaluación docente",
            "profesor titular", "catedrático", "habilitación",
            "plaza", "concurso oposición", "estancias",
        ],
        "active_deadline": None,                # Proceso continuo, siempre activo
        "competition_proxy": 8.5,               # No hay solución clara para ANECA/Docentia
        "notes": "Dolor articulado públicamente. Proceso hasta 1 año de espera.",
    },

    "abogado_autonomo": {
        "label": "Abogado autónomo / despacho pequeño",
        "cnae": "6910",                         # Actividades jurídicas
        "cno": "2411",                          # Abogados
        "salary_min": 18_000,
        "salary_mean": 35_000,                  # Alta varianza — autónomo sin socios
        "salary_max": 150_000,
        "income_tier": "medium_high",
        "population_spain": 180_000,            # colegiados ejercientes
        "population_cadiz": 2_500,              # ICACADIZ aprox.
        "pain_keywords": [
            "gestoría", "contabilidad", "irpf", "iva trimestral",
            "facturación electrónica", "agenda", "expedientes",
            "turnos de oficio", "honorarios", "minuta",
            "pleito", "juzgado", "notificaciones",
        ],
        "active_deadline": None,
        "competition_proxy": 6.0,               # LexNet problemático; mercado fragmentado
        "notes": "Dolor crónico gestión fiscal/admin. Muy fragmentado.",
    },

    "arquitecto": {
        "label": "Arquitecto / estudio pequeño",
        "cnae": "7111",                         # Servicios técnicos de arquitectura
        "cno": "2141",                          # Arquitectos
        "salary_min": 16_000,
        "salary_mean": 28_500,                  # Alta varianza autónomo
        "salary_max": 65_000,
        "income_tier": "medium",
        "population_spain": 50_000,             # colegiados ejercientes
        "population_cadiz": 800,                # COAC aprox.
        "pain_keywords": [
            "visado colegial", "licencia obras", "ayuntamiento",
            "presupuesto", "mediciones", "certificado energético",
            "libro edificio", "iee", "informe técnico",
            "promotor", "aparejador", "aparato burocrático",
        ],
        "active_deadline": None,
        "competition_proxy": 7.5,               # Nada resuelve burocracia colegial bien
        "notes": "Burocracia colegial + municipal. Visados lentos.",
    },
}


# ─────────────────────────────────────────────
# FUENTES DE SEÑALES
# ─────────────────────────────────────────────

class SignalSource(str, Enum):
    GMAPS_REVIEWS   = "gmaps_reviews"
    REDDIT          = "reddit"
    G2_CAPTERRA     = "g2_capterra"
    FACEBOOK_GROUPS = "facebook_groups"
    GOOGLE_TRENDS   = "google_trends"
    GOOGLE_NEWS     = "google_news"
    JOB_POSTINGS    = "job_postings"
    COLEGIOS_WEB    = "colegios_web"
    TWITTER_X       = "twitter_x"


SOURCE_CONFIG = {
    SignalSource.GMAPS_REVIEWS: {
        "freq_hours": 24,
        "location_filter": True,    # filtra por Cádiz/Andalucía
        "geo": (36.5297, -6.2929),  # Cádiz centro
        "radius_km": 150,           # cubre provincia + Sevilla
    },
    SignalSource.REDDIT: {
        "freq_hours": 12,
        "location_filter": False,   # España entera
        "subreddits": ["spain", "Andalucia", "DerechoEspañol", "medicina"],
    },
    SignalSource.G2_CAPTERRA: {
        "freq_hours": 168,          # semanal
        "location_filter": False,
        "categories": ["dental-practice-management", "legal-practice-management",
                       "architecture", "higher-education"],
    },
    SignalSource.GOOGLE_TRENDS: {
        "freq_hours": 168,
        "location_filter": True,
        "geo_code": "ES-AN",        # Andalucía
    },
    SignalSource.JOB_POSTINGS: {
        "freq_hours": 48,
        "location_filter": True,
        "platforms": ["infojobs", "linkedin"],
        "location_query": "Cádiz OR Sevilla OR Andalucía",
    },
}


# ─────────────────────────────────────────────
# TIPOS DE DATOS
# ─────────────────────────────────────────────

@dataclass
class Signal:
    """Una señal de dolor detectada de una fuente."""

    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    source: SignalSource = SignalSource.REDDIT
    collected_at: datetime = field(default_factory=datetime.utcnow)

    # Profesional objetivo
    segment: str = ""                   # key de SEGMENTS
    location: str = ""                  # 'Cádiz' | 'Andalucía' | 'España'

    # Contenido
    raw_text: str = ""
    url: str = ""
    pain_keywords_found: list[str] = field(default_factory=list)
    sentiment_score: float = 0.0        # -1.0 (máximo dolor) a 0.0

    # Proxy económico — cruzado con SEGMENTS
    salary_mean: int = 0                # €/año del segmento
    income_tier: str = ""               # 'high' | 'medium_high' | 'medium'

    # Calidad de la señal
    signal_strength: float = 0.0        # 0.0 a 1.0
    has_active_deadline: bool = False


@dataclass
class Opportunity:
    """Una oportunidad de negocio agregada a partir de señales."""

    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    segment: str = ""
    pain_summary: str = ""              # 1 frase: el problema concreto

    # Score compuesto 0-10
    score: float = 0.0
    score_breakdown: dict = field(default_factory=dict)
    # {
    #   'dolor':          0-10  (intensidad + frecuencia señales)
    #   'capacidad_pago': 0-10  (salary_mean normalizado)
    #   'volumen':        0-10  (population_spain/cadiz)
    #   'competencia':    0-10  (inverso: 10=sin competencia, 0=saturado)
    #   'urgencia':       0-10  (deadline activo = +3 automático)
    # }

    signal_ids: list[str] = field(default_factory=list)
    signal_count: int = 0

    first_seen: datetime = field(default_factory=datetime.utcnow)
    last_updated: datetime = field(default_factory=datetime.utcnow)

    status: str = "watching"
    # watching → testing → killed | scaling

    # Validación
    landing_url: Optional[str] = None
    emails_captured: int = 0
    validation_deadline: Optional[datetime] = None
    kill_threshold_days: int = 7        # días sin señal = kill automático
    scale_threshold_emails: int = 30    # emails en 7 días = escalar

    # Alertas: evita spam en runs repetidos
    telegram_alerted_at: Optional[datetime] = None


# ─────────────────────────────────────────────
# SCORING
# ─────────────────────────────────────────────

SCORE_WEIGHTS = {
    "dolor":          0.30,
    "capacidad_pago": 0.25,
    "volumen":        0.20,
    "competencia":    0.15,
    "urgencia":       0.10,
}

SALARY_TIERS = {
    "high":         10,     # >50k medio
    "medium_high":  7,      # 30-50k medio
    "medium":       5,      # 20-30k medio
    "low":          2,      # <20k medio
}

def compute_opportunity_score(breakdown: dict) -> float:
    """
    Calcula score compuesto 0-10 a partir del breakdown.
    Aplica pesos definidos en SCORE_WEIGHTS.
    """
    return round(
        sum(breakdown.get(k, 0) * w for k, w in SCORE_WEIGHTS.items()),
        2
    )

def income_tier_score(segment_key: str) -> int:
    """Devuelve score de capacidad de pago a partir del segmento."""
    seg = SEGMENTS.get(segment_key, {})
    return SALARY_TIERS.get(seg.get("income_tier", "low"), 2)

def urgency_score(segment_key: str) -> int:
    """Score de urgencia: +10 si hay deadline activo, 0 si no."""
    seg = SEGMENTS.get(segment_key, {})
    return 10 if seg.get("active_deadline") else 0


# ─────────────────────────────────────────────
# KILL / SCALE RULES
# ─────────────────────────────────────────────

KILL_SCORE_THRESHOLD   = 5.0    # por debajo → kill automático
SCALE_SCORE_THRESHOLD  = 8.0    # por encima → trigger validación
ALERT_SCORE_THRESHOLD  = 7.0    # por encima → notificación Telegram


# ─────────────────────────────────────────────
# SQL — schema SQLite
# ─────────────────────────────────────────────

DDL = """
CREATE TABLE IF NOT EXISTS signals (
    id              TEXT PRIMARY KEY,
    source          TEXT NOT NULL,
    collected_at    TEXT NOT NULL,
    segment         TEXT NOT NULL,
    location        TEXT,
    raw_text        TEXT,
    url             TEXT,
    pain_keywords   TEXT,           -- JSON array
    sentiment_score REAL,
    salary_mean     INTEGER,
    income_tier     TEXT,
    signal_strength REAL,
    has_deadline    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS opportunities (
    id                  TEXT PRIMARY KEY,
    segment             TEXT NOT NULL,
    pain_summary        TEXT,
    score               REAL,
    score_breakdown     TEXT,       -- JSON
    signal_ids          TEXT,       -- JSON array
    signal_count        INTEGER DEFAULT 0,
    first_seen          TEXT,
    last_updated        TEXT,
    status              TEXT DEFAULT 'watching',
    landing_url         TEXT,
    emails_captured     INTEGER DEFAULT 0,
    validation_deadline TEXT,
    telegram_alerted_at TEXT        -- ISO timestamp of last alert sent; NULL = never
);

CREATE INDEX IF NOT EXISTS idx_signals_segment   ON signals(segment);
CREATE INDEX IF NOT EXISTS idx_signals_collected ON signals(collected_at);
CREATE INDEX IF NOT EXISTS idx_opps_score        ON opportunities(score DESC);
CREATE INDEX IF NOT EXISTS idx_opps_status       ON opportunities(status);

-- Dedup a nivel de BD: misma URL + segmento no entra dos veces
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_url_segment ON signals(url, segment);
"""
