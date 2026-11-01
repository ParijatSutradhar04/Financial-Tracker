import json

import httpx
import pytest

from app.services import categorizer
from app.services.categorizer import CategorizerUnavailable, Prediction, classify, is_ready

CATS = [{"name": "Food", "description": "restaurants, food delivery"}, {"name": "Travel", "description": ""}]


def transport_returning(handler):
    return httpx.MockTransport(handler)


async def test_classify_posts_chunks_with_token_and_maps_results():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["categories"] == CATS  # descriptions go to the Space untouched
        seen.append((request.url.path, request.headers["authorization"], len(body["descriptions"])))
        return httpx.Response(
            200, json={"results": [{"category": "Food", "confidence": 0.8} for _ in body["descriptions"]]}
        )

    out = await classify([f"item {i}" for i in range(70)], CATS, transport=transport_returning(handler))
    assert len(out) == 70 and out[0] == Prediction("Food", 0.8)
    assert seen == [("/classify", "Bearer test-token", 64), ("/classify", "Bearer test-token", 6)]


async def test_classify_empty_makes_no_request():
    def handler(request):
        raise AssertionError("should not be called")

    assert await classify([], CATS, transport=transport_returning(handler)) == []


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503, text="sleeping"),
        httpx.Response(200, json={"results": []}),  # wrong length
        httpx.Response(200, json={"results": [{"category": "Rent", "confidence": 0.9}]}),  # unknown label
        httpx.Response(200, text="not json"),
    ],
)
async def test_bad_responses_raise_unavailable(response):
    with pytest.raises(CategorizerUnavailable):
        await classify(["Dinner"], CATS, transport=transport_returning(lambda r: response))


async def test_network_error_raises_unavailable():
    def handler(request):
        raise httpx.ConnectError("boom")

    with pytest.raises(CategorizerUnavailable):
        await classify(["Dinner"], CATS, transport=transport_returning(handler))


async def test_timeout_raises_unavailable(monkeypatch):
    monkeypatch.setattr(categorizer, "OVERALL_DEADLINE_SECONDS", 0.05)

    async def slow(request):
        import asyncio

        await asyncio.sleep(1)
        return httpx.Response(200, json={"results": []})

    with pytest.raises(CategorizerUnavailable, match="timed out"):
        await classify(["Dinner"], CATS, transport=transport_returning(slow))


async def test_missing_url_raises_unavailable(monkeypatch):
    monkeypatch.setattr(categorizer.settings, "laya_space_url", None)
    with pytest.raises(CategorizerUnavailable, match="LAYA_SPACE_URL"):
        await classify(["Dinner"], CATS)


async def test_is_ready():
    ok = transport_returning(lambda r: httpx.Response(200, json={"status": "ok"}))
    down = transport_returning(lambda r: httpx.Response(503))
    assert await is_ready(transport=ok) is True
    assert await is_ready(transport=down) is False
