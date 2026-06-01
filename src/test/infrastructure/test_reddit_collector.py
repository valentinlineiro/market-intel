from unittest.mock import patch, MagicMock
import requests

from infrastructure.collectors.reddit import collect, _process_posts


def _make_post(title: str, selftext: str = "", permalink: str = "/r/test/1") -> dict:
    return {"title": title, "selftext": selftext, "permalink": permalink}


def test_collect_returns_empty_on_403(monkeypatch):
    """Reddit 403 (unauthenticated) → empty list, no crash."""
    response = MagicMock()
    response.status_code = 403
    response.raise_for_status.side_effect = requests.HTTPError("403")
    monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
    monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
    with patch("infrastructure.collectors.reddit._requests.get", return_value=response):
        signals = collect("dentista")
    assert signals == []


def test_process_posts_filters_by_keywords():
    """Posts without pain keywords are discarded."""
    relevant = _make_post("El software de facturación de mi clínica dental falla siempre")
    irrelevant = _make_post("Gran dia en la playa hoy")
    result = _process_posts([relevant, irrelevant], "dentista")
    assert len(result) == 1
    assert "dental" in result[0].raw_text.lower()


def test_process_posts_empty_input():
    assert _process_posts([], "dentista") == []


def test_get_reddit_client_returns_none_without_credentials(monkeypatch):
    """No credentials → None (falls back to public fetch)."""
    from infrastructure.collectors.reddit import get_reddit_client
    monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
    monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
    assert get_reddit_client() is None


def test_get_reddit_client_returns_none_when_praw_missing(monkeypatch):
    """Credentials set but praw not installed → None, no crash."""
    from infrastructure.collectors.reddit import get_reddit_client
    monkeypatch.setenv("REDDIT_CLIENT_ID", "fake_id")
    monkeypatch.setenv("REDDIT_CLIENT_SECRET", "fake_secret")
    with patch("builtins.__import__", side_effect=ImportError("No module named 'praw'")):
        result = get_reddit_client()
    assert result is None
