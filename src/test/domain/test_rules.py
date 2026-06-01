from domain.rules import compute_opportunity_score, income_tier_score, urgency_score, volume_score, SCORE_WEIGHTS

def test_compute_score_weighted():
    breakdown = {"dolor": 8.0, "capacidad_pago": 7.0, "volumen": 5.0, "competencia": 6.0, "urgencia": 10.0}
    score = compute_opportunity_score(breakdown)
    expected = round(8*0.30 + 7*0.25 + 5*0.20 + 6*0.15 + 10*0.10, 2)
    assert score == expected

def test_income_tier_high():
    assert income_tier_score("high") == 10

def test_income_tier_medium():
    assert income_tier_score("medium") == 5

def test_urgency_with_deadline():
    assert urgency_score(True) == 10

def test_urgency_without_deadline():
    assert urgency_score(False) == 0

def test_volume_score_normalised():
    assert volume_score(20.0) == 10.0
    assert volume_score(0.0)  == 0.0
    assert volume_score(10.0) == 5.0

def test_score_weights_sum_to_one():
    assert abs(sum(SCORE_WEIGHTS.values()) - 1.0) < 0.001
