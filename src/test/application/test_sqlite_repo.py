import pytest
from datetime import datetime
from domain.models import Signal, Opportunity, SignalSource
from infrastructure.db.sqlite_repo import SqliteSignalRepo, SqliteOpportunityRepo

@pytest.fixture
def signal_repo(tmp_path):
    db = tmp_path / "test.db"
    return SqliteSignalRepo(db_path=str(db))

@pytest.fixture
def opp_repo(tmp_path):
    db = tmp_path / "test.db"
    return SqliteOpportunityRepo(db_path=str(db))

def test_save_and_get(signal_repo):
    s = Signal(segment="dentista", raw_text="problema verifactu", url="http://x.com/1")
    assert signal_repo.save(s) is True
    results = signal_repo.get(segment="dentista")
    assert len(results) == 1
    assert results[0].segment == "dentista"

def test_dedup(signal_repo):
    s = Signal(segment="dentista", url="http://x.com/1")
    signal_repo.save(s)
    s2 = Signal(segment="dentista", url="http://x.com/1")
    assert signal_repo.save(s2) is False

def test_count(signal_repo):
    signal_repo.save(Signal(segment="dentista", url="http://a.com"))
    signal_repo.save(Signal(segment="arquitecto", url="http://b.com"))
    assert signal_repo.count(segment="dentista") == 1
    assert signal_repo.count() == 2

def test_upsert_opportunity(opp_repo):
    o = Opportunity(segment="dentista", score=7.5, status="watching")
    opp_repo.upsert(o)
    result = opp_repo.get_by_segment("dentista")
    assert result is not None
    assert result.score == 7.5

def test_upsert_updates(opp_repo):
    o = Opportunity(segment="dentista", score=7.5)
    opp_repo.upsert(o)
    o.score = 8.0
    opp_repo.upsert(o)
    assert opp_repo.get_by_segment("dentista").score == 8.0
