"""Client for the Laya categorizer running in a private Hugging Face Space.

Any failure — unset URL, Space asleep past the deadline, HTTP error, or a
response that doesn't match the contract — surfaces as CategorizerUnavailable,
so the Splitwise preview can fall back to manual categorization instead of
failing the request.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import httpx

from ..config import settings

CHUNK_SIZE = 64
# Vercel Hobby functions stop at 300 s; leave room for parsing and DB work.
OVERALL_DEADLINE_SECONDS = 150.0
_REQUEST_TIMEOUT = httpx.Timeout(120.0, connect=15.0)


class CategorizerUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Prediction:
    category: str
    confidence: float


def _client(transport: httpx.AsyncBaseTransport | None, timeout: httpx.Timeout) -> httpx.AsyncClient:
    if not settings.laya_space_url:
        raise CategorizerUnavailable("LAYA_SPACE_URL is not set")
    headers = {"Authorization": f"Bearer {settings.laya_hf_token}"} if settings.laya_hf_token else {}
    return httpx.AsyncClient(
        base_url=settings.laya_space_url, headers=headers, timeout=timeout, transport=transport
    )


async def _classify_all(
    client: httpx.AsyncClient, descriptions: list[str], categories: list[dict]
) -> list[Prediction]:
    allowed = {c["name"] for c in categories}
    out: list[Prediction] = []
    for start in range(0, len(descriptions), CHUNK_SIZE):
        chunk = descriptions[start : start + CHUNK_SIZE]
        response = await client.post("/classify", json={"descriptions": chunk, "categories": categories})
        response.raise_for_status()
        results = response.json()["results"]
        if len(results) != len(chunk):
            raise CategorizerUnavailable(f"Expected {len(chunk)} results, got {len(results)}")
        for result in results:
            if result["category"] not in allowed:
                raise CategorizerUnavailable(f"Unknown category {result['category']!r}")
            out.append(Prediction(category=result["category"], confidence=float(result["confidence"])))
    return out


async def classify(
    descriptions: list[str],
    categories: list[dict],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[Prediction]:
    if not descriptions:
        return []
    try:
        async with _client(transport, _REQUEST_TIMEOUT) as client:
            return await asyncio.wait_for(
                _classify_all(client, descriptions, categories), timeout=OVERALL_DEADLINE_SECONDS
            )
    except asyncio.TimeoutError as exc:
        raise CategorizerUnavailable("Categorizer timed out") from exc
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise CategorizerUnavailable(f"Categorizer request failed: {exc}") from exc


async def is_ready(*, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    """A cheap probe. Calling it also wakes a sleeping Space."""
    try:
        async with _client(transport, httpx.Timeout(5.0)) as client:
            response = await client.get("/healthz")
            return response.status_code == 200
    except (CategorizerUnavailable, httpx.HTTPError):
        return False
