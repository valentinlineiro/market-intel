# Segments are now discovered dynamically. This file keeps only SALARY_TIERS
# so existing imports don't break, and SEGMENTS stays as an empty dict.
SEGMENTS: dict[str, dict] = {}

SALARY_TIERS: dict[str, int] = {
    "high": 10,
    "medium_high": 7,
    "medium": 5,
    "low": 2,
}
