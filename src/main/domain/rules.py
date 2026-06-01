from domain.segments import SALARY_TIERS

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


def compute_opportunity_score(breakdown: dict) -> float:
    return round(sum(breakdown.get(k, 0) * w for k, w in SCORE_WEIGHTS.items()), 2)


def income_tier_score(income_tier: str) -> int:
    return SALARY_TIERS.get(income_tier, 2)


def urgency_score(has_deadline: bool) -> int:
    return 10 if has_deadline else 0


def volume_score(discovery_score: float) -> float:
    """Normalise discovery_score (unbounded) to 0–10."""
    return round(min(discovery_score / 20.0, 1.0) * 10, 2)
