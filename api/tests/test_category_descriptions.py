"""Category descriptions through the existing category and config routes.
Needs TEST_DATABASE_URL (Task 4 Step 1), like the Splitwise route tests."""

import os

import httpx
import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

from app import db  # noqa: E402
from app.auth import get_current_user  # noqa: E402
from app.main import app  # noqa: E402

COMMUTE = "cabs, autos, metro, bus"
BASE = {"name": "Commute", "icon": "🚕", "color": "#64d2ff"}


@pytest.fixture
async def client():
    app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user"}
    async with db.acquire() as conn:
        await conn.execute("TRUNCATE transactions, accounts, categories CASCADE")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await db.close_pool()


async def add(client, **extra):
    r = await client.post("/api/categories", json={**BASE, **extra})
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_with_description_and_read_it_back(client):
    assert (await add(client, description=COMMUTE))["description"] == COMMUTE
    listed = {c["name"]: c for c in (await client.get("/api/config")).json()["categories"]}
    assert listed["Commute"]["description"] == COMMUTE
    assert listed["Transfer"]["description"] == ""  # reserved rows have none


async def test_create_without_description_is_empty(client):
    assert (await add(client))["description"] == ""


async def test_edit_without_description_keeps_it(client):
    # What the app sent before this change: name, icon and colour only.
    created = await add(client, description=COMMUTE)
    r = await client.patch(f"/api/categories/{created['id']}", json={**BASE, "icon": "🛺"})
    assert r.status_code == 200, r.text
    assert (r.json()["icon"], r.json()["description"]) == ("🛺", COMMUTE)


async def test_edit_changes_trims_or_clears_description(client):
    created = await add(client, description=COMMUTE)
    url = f"/api/categories/{created['id']}"
    assert (await client.patch(url, json={**BASE, "description": "  cabs and metro "})).json()["description"] == "cabs and metro"
    assert (await client.patch(url, json={**BASE, "description": ""})).json()["description"] == ""


async def test_description_over_200_chars_is_rejected(client):
    r = await client.post("/api/categories", json={**BASE, "description": "a" * 201})
    assert r.status_code == 400
