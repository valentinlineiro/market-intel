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
