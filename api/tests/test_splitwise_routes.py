"""Route tests against a real Postgres test database.

Skipped unless TEST_DATABASE_URL is set (see Task 4 Step 1 of the plan for
creating financedb_test). conftest.py points DATABASE_URL at it before the app
is imported, so these can never touch the dev or Supabase databases.
"""

import os
import uuid

import httpx
import pytest

from tests.test_splitwise_parser import ROWS, SAMPLE, make_csv

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

from app import db  # noqa: E402
from app.auth import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.routes import splitwise as splitwise_routes  # noqa: E402
from app.services.categorizer import CategorizerUnavailable, Prediction  # noqa: E402

ME = "Parijat Sutradhar"
# What the preview must send to Laya for the fixture's categories.
CHOICES = [{"name": "Food", "description": "restaurants and food delivery"}, {"name": "Travel", "description": ""}]

# A later, settled export. "Dinner at Toit 20/9" and "Cab to airport" repeat
# descriptions from SAMPLE; "Snacks" appears twice in different case.
LATER = make_csv(
    [
        "2026-09-20,Dinner at Toit 20/9,Dining out,1000.00,INR,500.00,-500.00",
        "2026-09-21,Cab to airport,Taxi,600.00,INR,-300.00,300.00",
        "2026-09-21,Snacks,Dining out,100.00,INR,-50.00,50.00",
        "2026-09-22,snacks,Dining out,100.00,INR,-50.00,50.00",
        "2026-09-23,Asha K. paid Parijat S.,Payment,100.00,INR,-100.00,100.00",
    ]
)


@pytest.fixture
async def client():
    app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user"}
    async with db.acquire() as conn:
        await conn.execute("TRUNCATE splitwise_imports, category_memory, transactions, accounts, categories CASCADE")
        account_id = await conn.fetchval(
            "INSERT INTO accounts (name, kind, last_reconciled_balance) VALUES ('Primary Account', 'bank', 10000) RETURNING id"
        )
        await conn.execute(
            "INSERT INTO categories (name, icon, color, description) VALUES "
            "('Food', '🍔', '#ff9f0a', 'restaurants and food delivery'), ('Travel', '🚕', '#5b5cf6', '')"
        )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        c.account_id = str(account_id)
        yield c
    app.dependency_overrides.clear()
    await db.close_pool()


@pytest.fixture
def laya_ok(monkeypatch):
    calls = []

    async def fake(descriptions, categories, **_):
        calls.append((list(descriptions), list(categories)))
        return [Prediction("Food" if "Dinner" in d else "Travel", 0.9) for d in descriptions]

    monkeypatch.setattr(splitwise_routes.categorizer, "classify", fake)
    return calls


async def preview(client, member=ME, csv=SAMPLE):
    r = await client.post("/api/splitwise/preview", json={"csv": csv, "memberName": member})
    assert r.status_code == 200, r.text
    return r.json()


async def test_preview_without_member_lists_members(client, laya_ok):
    body = await preview(client, member=None)
    assert body["members"] == ["Parijat Sutradhar", "Asha Kumar"]
    assert body["memberName"] is None and body["rows"] == [] and body["classifier"] == "not_run"
    assert laya_ok == []


async def test_preview_categorizes_every_row(client, laya_ok):
    body = await preview(client)
    assert body["classifier"] == "ok"
    assert [(r["description"], r["amount"], r["category"], r["alreadyImported"]) for r in body["rows"]] == [
        ("Dinner at Toit", 600.0, "Food", False),
        ("Cab to airport", 450.0, "Travel", False),
    ]
    assert [r["source"] for r in body["rows"]] == ["laya", "laya"]
    assert [s["description"] for s in body["settlements"]] == ["Asha K. paid Parijat S."]
    assert all("paid" not in s["description"] for s in body["skipped"])
    assert laya_ok == [(["Dinner at Toit", "Cab to airport"], CHOICES)]  # descriptions included


async def test_preview_when_categorizer_down(client, monkeypatch):
    async def down(*_, **__):
        raise CategorizerUnavailable("asleep")

    monkeypatch.setattr(splitwise_routes.categorizer, "classify", down)
    body = await preview(client)
    assert body["classifier"] == "unavailable"
    assert [r["category"] for r in body["rows"]] == [None, None]


async def test_preview_rejects_unsettled_export(client, laya_ok):
    for member in (None, ME):
        r = await client.post("/api/splitwise/preview", json={"csv": make_csv(ROWS[:-1]), "memberName": member})
        assert r.status_code == 400
        assert r.json()["error"].startswith("This export isn't settled yet: Asha Kumar owes INR 240.00")
    assert laya_ok == []


async def test_preview_rejects_non_splitwise_file(client, laya_ok):
    r = await client.post("/api/splitwise/preview", json={"csv": "a,b\n1,2\n", "memberName": ME})
    assert r.status_code == 400
    assert "Splitwise export" in r.json()["error"]


async def to_import_rows(client):
    return [
        {k: row[k] for k in ("fingerprint", "date", "description", "amount", "category")}
        for row in (await preview(client))["rows"]
    ]


async def test_import_debits_share_and_backdates(client, laya_ok):
    rows = await to_import_rows(client)
    r = await client.post("/api/splitwise/import", json={"accountId": client.account_id, "rows": rows})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["imported"] == 2 and body["skippedDuplicates"] == 0
    assert body["account"]["balance"] == 10000 - 600 - 450

    tx = (await client.get("/api/transactions?from=2026-09-01&to=2026-09-30")).json()
    assert sorted((t["date"], t["description"], t["amount"], t["type"], t["category"]) for t in tx) == [
        ("2026-09-01", "Dinner at Toit", 600.0, "debit", "Food"),
        ("2026-09-02", "Cab to airport", 450.0, "debit", "Travel"),
    ]


async def test_reimport_skips_duplicates(client, laya_ok):
    rows = await to_import_rows(client)
    await client.post("/api/splitwise/import", json={"accountId": client.account_id, "rows": rows})

    again = await preview(client)
    assert all(r["alreadyImported"] for r in again["rows"])
    assert again["classifier"] == "not_run"

    r = await client.post("/api/splitwise/import", json={"accountId": client.account_id, "rows": rows})
    assert r.status_code == 201
    assert r.json()["imported"] == 0 and r.json()["skippedDuplicates"] == 2
    assert r.json()["account"]["balance"] == 10000 - 600 - 450


async def test_memory_hit_skips_laya(client, laya_ok):
    rows = await to_import_rows(client)
    await client.post("/api/splitwise/import", json={"accountId": client.account_id, "rows": rows})
    laya_ok.clear()

    body = await preview(client, csv=LATER)
    assert [(r["description"], r["category"], r["source"], r["confidence"]) for r in body["rows"]] == [
        ("Dinner at Toit 20/9", "Food", "memory", None),  # date suffix ignored by the key
        ("Cab to airport", "Travel", "memory", None),
        ("Snacks", "Travel", "laya", 0.9),
        ("snacks", "Travel", "laya", 0.9),
    ]
    # Only the unseen description goes to Laya, and only once for both rows.
    assert laya_ok == [(["Snacks"], CHOICES)]
    assert body["classifier"] == "ok"


async def test_import_remembers_corrected_category(client, laya_ok):
    rows = await to_import_rows(client)
    rows[1]["category"] = "Food"  # the user overrides Laya's "Travel"
    await client.post("/api/splitwise/import", json={"accountId": client.account_id, "rows": rows})

    cab = next(r for r in (await preview(client, csv=LATER))["rows"] if r["description"] == "Cab to airport")
    assert (cab["category"], cab["source"]) == ("Food", "memory")


async def test_memory_ignores_deleted_category(client, laya_ok):
    async with db.acquire() as conn:
        await conn.execute("INSERT INTO category_memory (description_key, category) VALUES ('snacks', 'Gone')")

    body = await preview(client, csv=LATER)
    assert {(r["description"], r["source"]) for r in body["rows"]} >= {("Snacks", "laya"), ("snacks", "laya")}
    assert "Snacks" in laya_ok[0][0]


async def test_import_rejects_unknown_category_atomically(client, laya_ok):
    rows = await to_import_rows(client)
    rows[1]["category"] = "Deleted Category"
    r = await client.post("/api/splitwise/import", json={"accountId": client.account_id, "rows": rows})
    assert r.status_code == 400
    assert "Deleted Category" in r.json()["error"]
    async with db.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM transactions") == 0
        assert await conn.fetchval("SELECT count(*) FROM splitwise_imports") == 0


async def test_import_unknown_account_is_404(client, laya_ok):
    rows = await to_import_rows(client)
    r = await client.post("/api/splitwise/import", json={"accountId": str(uuid.uuid4()), "rows": rows})
    assert r.status_code == 404


async def test_import_rejects_future_date(client, laya_ok):
    rows = await to_import_rows(client)
    rows[0]["date"] = "2999-01-01"
    r = await client.post("/api/splitwise/import", json={"accountId": client.account_id, "rows": rows})
    assert r.status_code == 400


async def test_existing_add_expense_still_works(client):
    r = await client.post(
        "/api/transactions",
        json={"accountId": client.account_id, "amount": 100, "category": "Food", "description": "Lunch", "date": "2026-09-10"},
    )
    assert r.status_code == 201
    assert r.json()["account"]["balance"] == 9900


async def test_classifier_status(client, monkeypatch):
    async def ready(**_):
        return True

    monkeypatch.setattr(splitwise_routes.categorizer, "is_ready", ready)
    r = await client.get("/api/splitwise/classifier-status")
    assert r.json() == {"ready": True}

