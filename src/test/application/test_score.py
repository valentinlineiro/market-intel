import pytest
from unittest.mock import MagicMock
from domain.models import Signal, Opportunity, ActiveSegment
from application.score import ScoreUseCase

DENTISTA = ActiveSegment(
    key="dentista", label="Dentista / Clínica dental",
    keywords=["verifactu", "hacienda", "facturación"],
    income_tier="high", has_deadline=True, discovery_score=15.0,
)

@pytest.fixture
def signal_repo():
    repo = MagicMock()
    repo.get.return_value = [
        Signal(segment="dentista", url="http://a.com", signal_strength=0.8,
               pain_keywords_found=["verifactu", "multa"], sentiment_score=-0.4)
        for _ in range(10)
    ]
    repo.count.return_value = 10
    return repo

@pytest.fixture
def opp_repo():
    repo = MagicMock()
    repo.get_by_segment.return_value = None
    return repo

@pytest.fixture
def notifier():
    return MagicMock()

def test_score_creates_opportunity(signal_repo, opp_repo, notifier):
    use_case = ScoreUseCase(signal_repo, opp_repo, notifier)
    results = use_case.run(segments=[DENTISTA])
    assert len(results) == 1
    assert results[0]["segment"] == "dentista"
    assert results[0]["score"] > 0
    assert opp_repo.upsert.call_count >= 1

def test_score_alerts_above_threshold(signal_repo, opp_repo, notifier):
    use_case = ScoreUseCase(signal_repo, opp_repo, notifier)
    results = use_case.run(segments=[DENTISTA])
    if results[0]["score"] >= 7.0:
        notifier.send.assert_called_once()
