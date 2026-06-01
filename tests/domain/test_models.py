from datetime import datetime
from domain.models import Signal, Opportunity, SignalSource

def test_signal_defaults():
    s = Signal(segment="dentista", raw_text="problema con hacienda")
    assert s.segment == "dentista"
    assert s.id != ""
    assert isinstance(s.collected_at, datetime)
    assert s.pain_keywords_found == []

def test_opportunity_defaults():
    o = Opportunity(segment="dentista")
    assert o.status == "watching"
    assert o.score == 0.0
    assert o.emails_captured == 0

def test_signal_source_values():
    assert SignalSource.REDDIT.value == "reddit"
    assert SignalSource.GOOGLE_NEWS.value == "google_news"
