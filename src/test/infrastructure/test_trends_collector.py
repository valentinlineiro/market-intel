from unittest.mock import patch, MagicMock

from infrastructure.collectors.trends import collect, _fetch_rss

RSS_SAMPLE = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    "<rss><channel>"
    "<item>"
    "<title>Problemas con el software de facturacion dental y verifactu</title>"
    "<description>Clinicas con hacienda y gestion clinica.</description>"
    "<link>https://example.com/news/1</link>"
    "</item>"
    "<item>"
    "<title>Gran dia soleado en Madrid</title>"
    "<description>El tiempo mejora esta semana.</description>"
    "<link>https://example.com/news/2</link>"
    "</item>"
    "</channel></rss>"
).encode("utf-8")


def _mock_get(content: bytes):
    resp = MagicMock()
    resp.content = content
    resp.raise_for_status = MagicMock()
    return resp


def test_fetch_rss_returns_items():
    with patch("infrastructure.collectors.trends.requests.get", return_value=_mock_get(RSS_SAMPLE)):
        items = _fetch_rss("verifactu dental")
    assert len(items) == 2
    assert "verifactu" in items[0]["text"].lower() or "facturacion" in items[0]["text"].lower()


def test_fetch_rss_returns_empty_on_error():
    with patch("infrastructure.collectors.trends.requests.get", side_effect=Exception("timeout")):
        items = _fetch_rss("verifactu dental")
    assert items == []


def test_collect_filters_by_pain_keywords():
    with patch("infrastructure.collectors.trends.requests.get", return_value=_mock_get(RSS_SAMPLE)):
        with patch("infrastructure.collectors.trends.time.sleep"):
            signals = collect("dentista")
    assert len(signals) >= 1
    assert all(s.signal_strength > 0.05 for s in signals)


def test_collect_returns_empty_for_unknown_segment():
    signals = collect("nonexistent_segment")
    assert signals == []
