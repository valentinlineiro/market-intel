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
