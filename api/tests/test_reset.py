"""POST /api/reset: clears the ledger so accounts can be entered afresh.
Needs TEST_DATABASE_URL, like the other route tests."""

import os

import httpx
import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

from app import db  # noqa: E402
from app.auth import get_current_user  # noqa: E402
from app.main import app  # noqa: E402

TABLES = ("accounts", "transactions", "splitwise_imports", "categories", "category_memory")


async def counts() -> dict[str, int]:
    async with db.acquire() as conn:
        return {t: await conn.fetchval(f"SELECT count(*) FROM {t}") for t in TABLES}


@pytest.fixture
async def client():
    """A ledger with one of everything: an account, an expense on it, that
    expense's Splitwise import record, a category, and a remembered category."""
    app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user"}
    async with db.acquire() as conn:
        await conn.execute("TRUNCATE splitwise_imports, category_memory, transactions, accounts, categories CASCADE")
        account_id = await conn.fetchval(
            "INSERT INTO accounts (name, kind, last_reconciled_balance) VALUES ('Primary Account', 'bank', 10000) RETURNING id"
        )
        await conn.execute("INSERT INTO categories (name, icon, color) VALUES ('Food', '🍔', '#ff9f0a')")
        tx_id = await conn.fetchval(
            "INSERT INTO transactions (account_id, amount, type, category, description) "
            "VALUES ($1, 250, 'debit', 'Food', 'Dinner') RETURNING id",
            account_id,
        )
        await conn.execute("INSERT INTO splitwise_imports (fingerprint, transaction_id) VALUES ($1, $2)", "f" * 64, tx_id)
        await conn.execute("INSERT INTO category_memory (description_key, category) VALUES ('dinner', 'Food')")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await db.close_pool()


async def test_reset_clears_ledger_and_keeps_categories(client):
    r = await client.post("/api/reset", json={"confirm": "RESET"})
    assert r.status_code == 200, r.text
    assert r.json() == {"accounts": 1, "transactions": 1}
    assert await counts() == {
        "accounts": 0,
        "transactions": 0,
        "splitwise_imports": 0,
        "categories": 1,
        "category_memory": 1,
    }
    assert (await client.get("/api/accounts")).json() == []


@pytest.mark.parametrize("body", [{}, {"confirm": ""}, {"confirm": "reset"}, {"confirm": "yes"}])
async def test_reset_needs_the_exact_word(client, body):
    before = await counts()
    r = await client.post("/api/reset", json=body)
    assert r.status_code == 400
    assert await counts() == before


async def test_reset_needs_a_login(client):
    app.dependency_overrides.clear()
    before = await counts()
    r = await client.post("/api/reset", json={"confirm": "RESET"})
    assert r.status_code == 401
    assert await counts() == before


async def test_accounts_can_be_added_after_a_reset(client):
    await client.post("/api/reset", json={"confirm": "RESET"})
    r = await client.post("/api/accounts", json={"name": "Primary Account", "kind": "bank", "openingBalance": 42000})
    assert r.status_code == 201, r.text
    assert (r.json()["balance"], r.json()["role"]) == (42000, "primary")
