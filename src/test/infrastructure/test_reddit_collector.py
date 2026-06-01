from unittest.mock import patch, MagicMock

from infrastructure.collectors.hn import collect, _fetch


def _make_hit(title: str, story_text: str = "", object_id: str = "123") -> dict:
    return {"title": title, "story_text": story_text, "objectID": object_id, "url": "", "num_comments": 5}


def test_collect_returns_empty_on_network_error(monkeypatch):
    """HN API error → empty list, no crash."""
    with patch("infrastructure.collectors.hn.requests.get", side_effect=Exception("timeout")):
        signals = collect("dentista")
    assert signals == []


def test_collect_filters_by_pain_keywords():
    """Hits without pain keywords are discarded."""
    relevant = _make_hit("El software de facturación de mi clínica dental falla siempre")
    irrelevant = _make_hit("Great day at the beach today")
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"hits": [relevant, irrelevant]}
    mock_resp.raise_for_status = MagicMock()
    with patch("infrastructure.collectors.hn.requests.get", return_value=mock_resp):
        with patch("infrastructure.collectors.hn.time.sleep"):
            signals = collect("dentista")
    assert len(signals) >= 1
    assert any("dental" in s.raw_text.lower() for s in signals)


def test_collect_returns_empty_for_unknown_segment():
    signals = collect("nonexistent_segment")
    assert signals == []


def test_fetch_returns_empty_on_http_error():
    mock_resp = MagicMock()
    mock_resp.raise_for_status.side_effect = Exception("500")
    with patch("infrastructure.collectors.hn.requests.get", return_value=mock_resp):
        result = _fetch("some query")
    assert result == []


def test_collect_skips_hits_with_no_text():
    empty_hit = {"title": "", "story_text": "", "objectID": "1", "url": "", "num_comments": 3}
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"hits": [empty_hit]}
    mock_resp.raise_for_status = MagicMock()
    with patch("infrastructure.collectors.hn.requests.get", return_value=mock_resp):
        with patch("infrastructure.collectors.hn.time.sleep"):
            signals = collect("dentista")
    assert signals == []
