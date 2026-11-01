"""Credit limits on credit cards, through POST/GET /api/accounts.
Needs TEST_DATABASE_URL, like the other route tests."""

import os

import httpx
import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

from app import db  # noqa: E402
from app.auth import get_current_user  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
async def client():
    app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user"}
    async with db.acquire() as conn:
        await conn.execute("TRUNCATE splitwise_imports, transactions, accounts CASCADE")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await db.close_pool()


CARD = {"name": "Travel Card", "kind": "credit_card", "openingBalance": -12000}


async def test_card_keeps_its_credit_limit(client):
    r = await client.post("/api/accounts", json={**CARD, "creditLimit": 150000})
    assert r.status_code == 201, r.text
    assert (r.json()["creditLimit"], r.json()["outstanding"]) == (150000, 12000)

    listed = {a["name"]: a for a in (await client.get("/api/accounts")).json()}
    assert listed["Travel Card"]["creditLimit"] == 150000


async def test_limit_is_optional(client):
    r = await client.post("/api/accounts", json=CARD)
    assert r.status_code == 201, r.text
    assert r.json()["creditLimit"] is None


async def test_bank_account_has_no_limit(client):
    r = await client.post("/api/accounts", json={"name": "Savings", "kind": "bank", "openingBalance": 5000})
    assert r.status_code == 201, r.text
    assert r.json()["creditLimit"] is None


async def test_bank_account_rejects_a_limit(client):
    r = await client.post("/api/accounts", json={"name": "Savings", "kind": "bank", "openingBalance": 5000, "creditLimit": 1000})
    assert r.status_code == 400
    assert (await client.get("/api/accounts")).json() == []


@pytest.mark.parametrize("limit", [0, -500, "lots"])
async def test_limit_must_be_a_positive_amount(client, limit):
    r = await client.post("/api/accounts", json={**CARD, "creditLimit": limit})
    assert r.status_code == 400


async def test_limit_survives_a_charge(client):
    # Every route that returns an account reads the same columns.
    card = (await client.post("/api/accounts", json={**CARD, "creditLimit": 150000})).json()
    async with db.acquire() as conn:
        await conn.execute("INSERT INTO categories (name, icon, color) VALUES ('Food', '🍔', '#ff9f0a') ON CONFLICT DO NOTHING")
    r = await client.post(
        "/api/transactions",
        json={"accountId": card["id"], "amount": 500, "category": "Food", "description": "Lunch", "date": "2026-10-01"},
    )
    assert r.status_code == 201, r.text
    assert (r.json()["account"]["creditLimit"], r.json()["account"]["outstanding"]) == (150000, 12500)
