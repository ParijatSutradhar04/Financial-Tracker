# Splitwise CSV Import with Laya Categorization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user upload a Splitwise CSV export from the app, have every expense description categorized by the Laya model running in a private Hugging Face Gradio Space, review the proposals, and record the user's share of each expense as a debit on the date given in the CSV.

**Architecture:** A new private Hugging Face Space (Gradio SDK, CPU Basic) loads the English Laya checkpoint (`convaiinnovations/laya`) and exposes a JSON `POST /classify` route next to a small Gradio test UI. The FastAPI backend on Vercel gains a `/api/splitwise` router with three endpoints: a classifier wake-up/status probe, a **preview** endpoint (parse CSV, drop already-imported rows, reuse remembered categories, call the Space only for descriptions it hasn't seen, return proposals — no DB writes), and an **import** endpoint (bulk-insert confirmed rows as debits in one DB transaction, record fingerprints for dedup, remember each description's confirmed category, re-sync the balance once). The Expo app gains an "Import Splitwise" button and a review modal.

**Tech Stack:** FastAPI + asyncpg + httpx (backend), pytest + pytest-asyncio (new backend tests), Supabase Postgres, Expo SDK 57 / React Native + NativeWind (app), `expo-document-picker` + `expo-file-system` (file reading), Gradio + FastAPI + `laya` + CPU PyTorch (Space).

**Spec:** There is no separate spec document. The "Design Decisions" section below is the spec, derived from the conversation of 2026-10-03.

---

## Design Decisions (the spec)

1. **Trigger:** Manual. The user uploads the CSV in the app whenever they have settled up in Splitwise. No cron.
2. **Splitwise category is ignored for categorization.** Every non-skipped row's description goes to Laya. The Splitwise `Category` column is read only to recognise settlement rows.
2a. **Only settled exports are accepted.** The per-member balances summed over every row must be zero, and must match the file's `Total balance` row. Otherwise preview returns 400 with who owes how much, and nothing is categorized or imported.
2b. **Settlement rows** (`Parijat S. paid Shalin C.`, Category `Payment`) are not expenses. They count towards the settlement check and are listed in the preview for information.
2c. **Each category has a short description, and Laya is given it.** Categories get a `description` field: plain words for what goes in the category, with no brand names. It is stored in the DB, editable in the existing Add/Edit Category form, and seeded from `finance.config.json`. Laya scores each expense against these descriptions, falling back to `Spending on <name>` when a description is empty. The agreed wording for every category is in `docs/categories.md`. Existing clients that edit a category without sending a description keep the stored one.
3. **Amount recorded = the user's share**, derived from the user's member column (the column holds the *net balance change* for that person, not their share):
   - net `< 0` → someone else paid → share = `-net`
   - net `> 0` → the user paid → share = `Cost - net` (assumes the user was the only payer)
   - net `= 0` → skipped ("your balance didn't change")
   - share `= 0` (the user paid the whole cost for others) → skipped
4. **Which column is "me":** chosen once in the modal from the CSV's member columns, remembered on the device (AsyncStorage key `splitwise.memberName`).
5. **Account:** one account per import, picked in the review step (defaults to the `primary` role account). All rows become `debit` transactions on it.
6. **Date:** the CSV date. Back-dated rows land at local midnight in `APP_TIMEZONE`; a row dated today gets the insert clock time — the same rule `insert_transaction` uses today. Future-dated rows are skipped (the reconciliation trigger would double count them).
7. **Dedup:** each row gets a SHA-256 fingerprint of `date | normalised description | cost | currency | occurrence-index-within-file`. Imported fingerprints are stored in a new `splitwise_imports` table. Re-uploading an overlapping export imports only new rows. The user's share is *not* part of the fingerprint, so editing a split in Splitwise after import does not create a duplicate.
7a. **Category memory (cache in front of Laya):** the user is asked about a description once, and the answer is reused after that. It saves Laya calls, and it fixes what Laya can't learn, such as local brands like Furlenco. Laya got Furlenco wrong under every wording tested (`docs/categories.md`).
   - **Key:** `memory_key(description)`. It lowercases, drops every token that contains a digit, turns punctuation into spaces and collapses whitespace. So `Grocery Ratnadeep 22/08` and `grocery ratnadeep 6/9` share the key `grocery ratnadeep`, and `Maintenance Sept26` becomes `maintenance`. If nothing is left (`22/08`), the row is never remembered and always goes to Laya.
   - **Stored:** in a new `category_memory` table (key → category name). On import, every imported row writes its **final** category, whether the user accepted Laya's proposal or changed it, because importing is the confirmation. A later import overwrites the earlier answer, and within one import the last row wins.
   - **Used:** at preview, rows whose key is remembered get that category with `source: "memory"` and `confidence: null`, and are never sent to Laya. A remembered category is used only if it is still a spendable category; otherwise the row goes to Laya. Rows that miss go to Laya once per distinct key, so a file with five `Ratnadeep` rows costs one prediction. They come back with `source: "laya"`.
   - **The classifier field:** it reports only the Laya call. It is `"not_run"` when every fresh row was remembered.
   - **In the app:** remembered rows show a small "Remembered" tag instead of a confidence check. The user can still change them, and the change is remembered on import.
   - Only descriptions and category names are stored or sent. Amounts, dates and names never are.
8. **Review before write:** the preview never writes. The user can change any category, untick any row, and must fill in categories Laya couldn't provide.
9. **Laya unavailable** (Space asleep past the timeout, misconfigured, error): preview still succeeds with `category: null` on every row and `classifier: "unavailable"`; the UI shows a banner with Retry and lets the user categorize manually.
10. **Low confidence:** rows with Laya `answer_confidence < 0.5` are highlighted "Check this one". Not auto-rejected.
11. **Limits:** max 500 rows per preview/import; Laya called in chunks of 64; overall Laya deadline 150 s (fits Vercel Hobby's 300 s function limit).
12. **Security:** the Space is private. The backend authenticates to it with a Hugging Face fine-grained read token (`LAYA_HF_TOKEN`). The new API routes sit behind the existing Supabase JWT auth like every other route.
13. **Everything existing stays unchanged.** No existing route, service function, table, trigger, or modal changes behavior. The only edits to existing files are additive (new router registration, new settings fields, new API client methods, a new dashboard button, an optional `wide` prop on `Overlay` that defaults to the current width, and the optional category `description` field from 2c).

### Known limitation (tell the user, don't "fix")
Recording only the user's share on one chosen account keeps *net worth* right, but per-account balances can drift if the real cash flow was different (e.g. you paid the full bill on a card and were paid back to the bank). The existing Reconcile flow corrects that. If the user also records Splitwise expenses manually via Add Expense, importing will double count them.

---

## Global Constraints

- Python backend runs on Vercel's Python runtime; new runtime deps must be small. Only `httpx` is added to `api/requirements.txt`. Test-only deps go in `api/requirements-dev.txt`, never in `requirements.txt`.
- Wire format is camelCase via the existing `CamelModel` in `api/app/schemas.py`. Snake_case internally.
- Currency: INR only. Rows in any other currency are skipped with a reason.
- Max rows per request: `500`. Laya chunk size: `64`. Laya overall deadline: `150` seconds. Low-confidence threshold: `0.5`.
- Do not modify `insert_transaction`, `sync_balance`, `lock_accounts`, the triggers, or any existing route.
- Schema changes go in a new numbered migration (`migrations/004_splitwise_imports.sql`) **and** are appended to `supabase/init.sql` (the root `init.sql` is a symlink to it).
- The Expo app is SDK 57. Per `app/AGENTS.md`, check https://docs.expo.dev/versions/v57.0.0/ for `expo-document-picker` and `expo-file-system` before writing code that uses them; adjust the import if the documented API differs from this plan.
- Install Expo packages with `npx expo install`, never plain `npm install`, so versions match SDK 57.
- Laya model: English checkpoint only, loaded with `laya.load("convaiinnovations/laya")` (bypasses the language router, which can misroute short text).

## Review Focus

1. **Uploading the same or an overlapping export twice** → previously imported rows show as "already imported" and are never inserted again, even if the import endpoint is called directly with them. Pinned in Task 5 (`test_reimport_skips_duplicates`) and Task 2 (`test_fingerprint_stable_across_files`).
2. **The Space is asleep or slow** (first upload after days of inactivity) → preview returns within the deadline with `classifier: "unavailable"` instead of a 500 or a Vercel timeout. Pinned in Task 3 (`test_timeout_raises_unavailable`) and Task 5 (`test_preview_when_categorizer_down`).
3. **A CSV that was opened and re-saved in Excel** (BOM added, dates reformatted to `14/09/2026`) → BOM tolerated; non-ISO dates skipped with a readable reason rather than crashing or importing on a wrong date. Pinned in Task 2 (`test_bom_is_tolerated`, `test_non_iso_date_is_skipped`).
4. **Two genuinely identical expenses on the same day** (two coffees, same price) → both imported, and still deduped correctly on re-upload. Pinned in Task 2 (`test_identical_rows_get_distinct_fingerprints`).
5. **An unsettled export, or one edited after export** → rejected at preview with a message saying who owes what, before any Laya call. Pinned in Task 2 (`test_unsettled_export_reports_who_owes`, `test_total_row_that_does_not_add_up_is_rejected`) and Task 5 (`test_preview_rejects_unsettled_export`).
6. **A category renamed or deleted between preview and import** → import is rejected with a message naming the bad category, and nothing is written. Pinned in Task 5 (`test_import_rejects_unknown_category_atomically`).
7. **The user corrects a category, then imports next month's export** → the corrected category comes back for the same description (even with a different date suffix) without asking Laya. A remembered category that was deleted since is ignored. Pinned in Task 2 (`test_memory_key_*`) and Task 5 (`test_memory_hit_skips_laya`, `test_import_remembers_corrected_category`, `test_memory_ignores_deleted_category`).

---

## File Structure

**Hugging Face Space (new directory, pushed to its own HF git remote):**
- `laya_space/classifier.py` — pure function turning descriptions + categories (name and description) into Laya questions and mapping results. No Laya import, so it is testable without the model.
- `laya_space/app.py` — loads the model, FastAPI routes `/healthz` and `/classify`, Gradio test UI, mounted together.
- `laya_space/requirements.txt` — Space dependencies (CPU torch).
- `laya_space/README.md` — HF Space front-matter config.
- `laya_space/tests/test_classifier.py` — unit tests with a fake agent.

**Backend:**
- Create `migrations/004_splitwise_imports.sql` (categories `description` column, then the import tables); modify `supabase/init.sql` (append).
- Modify `api/app/services/categories.py`, `api/app/routes/categories.py`, `api/app/finance_config.py` — category descriptions.
- Create `api/app/services/splitwise.py` — CSV parsing, share calculation, fingerprints, category-memory keys. Pure.
- Create `api/app/services/categorizer.py` — HTTP client for the Space.
- Create `api/app/services/splitwise_import.py` — DB reads/writes for dedup, category memory and bulk insert.
- Create `api/app/routes/splitwise.py` — the three endpoints.
- Modify `api/app/schemas.py` (append models), `api/app/config.py` (two settings), `api/app/main.py` (register router), `api/requirements.txt` (`httpx`), `api/.env.example` (two vars).
- Create `api/requirements-dev.txt`, `api/pytest.ini`, `api/tests/conftest.py`, `api/tests/test_splitwise_parser.py`, `api/tests/test_categorizer.py`, `api/tests/test_category_descriptions.py`, `api/tests/test_splitwise_routes.py`.

**App:**
- Create `app/src/splitwiseFile.ts` — pick a CSV and read its text on web and native.
- Create `app/src/components/modals/ImportSplitwiseModal.tsx`.
- Modify `app/src/components/modals/CategoryFormModal.tsx` and `ManageCategoriesModal.tsx` (description field).
- Modify `app/src/api.ts` (category `description`, import types + three methods), `app/src/components/Overlay.tsx` (optional `wide` prop), `app/src/screens/Dashboard.tsx` (button + modal).

---

### Task 1: Laya categorizer Space

**Files:**
- Create: `laya_space/classifier.py`, `laya_space/app.py`, `laya_space/requirements.txt`, `laya_space/README.md`
- Test: `laya_space/tests/test_classifier.py`

**Interfaces:**
- Produces (HTTP, consumed by Task 3):
  - `GET /healthz` → `200 {"status": "ok"}`
  - `POST /classify` body `{"descriptions": string[1..64], "categories": [{"name": string, "description": string}][1..50]}` → `200 {"results": [{"category": string, "confidence": number}]}` in input order, each `category` is one of the category names. `description` may be empty or omitted.
- Produces (Python): `classify(agent, descriptions: list[str], categories: list[dict], batch_size: int = 32) -> list[dict]`, where each category is `{"name": str, "description": str}`.

**Category descriptions are what Laya scores against** (Design Decision 2c). The criterion for each category is its description, such as `"rent, society maintenance, move-in charges, monthly furniture and appliance rental"`. If the description is empty, the criterion falls back to `"Spending on <name>"`. In the 2026-10-04 test on the real export, short plain descriptions got 39 of 54 right, against 18 of 54 for names alone (`docs/categories.md`).

- [ ] **Step 1: Write the failing test**

`laya_space/tests/test_classifier.py`:

```python
import pytest

from classifier import build_questions, classify


class FakeAgent:
    """Mimics laya's agent.predict_batch result shape."""

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def predict_batch(self, states, questions, batch_size, sort_by_length):
        self.calls.append((states, questions, batch_size, sort_by_length))
        return [
            {"answers": {"category": {"choice": choice, "answer_confidence": conf}}}
            for choice, conf in self.answers[: len(states)]
        ]


CATS = [
    {"name": "Eating Out", "description": "restaurants, food delivery, snacks"},
    {"name": "Travel", "description": ""},
]


def test_build_questions_uses_descriptions_as_criteria():
    q = build_questions(CATS)
    assert q["category"]["type"] == "choice"
    assert list(q["category"]["criteria"].keys()) == ["Eating Out", "Travel"]
    assert q["category"]["criteria"]["Eating Out"] == "restaurants, food delivery, snacks"
    assert q["category"]["criteria"]["Travel"] == "Spending on travel"  # no description: fall back to the name


def test_classify_maps_results_in_order():
    agent = FakeAgent([("Eating Out", 0.91), ("Travel", 0.42)])
    out = classify(agent, ["Dinner at Toit", "Cab to airport"], CATS)
    assert out == [
        {"category": "Eating Out", "confidence": 0.91},
        {"category": "Travel", "confidence": 0.42},
    ]
    states, _, batch_size, sort_by_length = agent.calls[0]
    assert states == [{"body": "Dinner at Toit"}, {"body": "Cab to airport"}]
    assert batch_size == 32 and sort_by_length is True


def test_classify_empty_input_skips_model():
    agent = FakeAgent([])
    assert classify(agent, [], CATS) == []
    assert agent.calls == []


def test_classify_rejects_label_outside_categories():
    agent = FakeAgent([("Groceries", 0.9)])
    with pytest.raises(ValueError, match="Groceries"):
        classify(agent, ["Milk"], CATS)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd laya_space && python3 -m venv .venv && .venv/bin/pip install pytest && .venv/bin/python -m pytest tests -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'classifier'`

Also add `laya_space/tests/conftest.py` so `classifier` imports from the parent dir:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

- [ ] **Step 3: Write minimal implementation**

`laya_space/classifier.py`:

```python
"""Turns expense descriptions + the user's categories into one Laya `choice`
question and maps the answers back. Kept free of any `laya` import so it can
be tested with a fake agent.

Each category is {"name", "description"}. Laya scores a description against
each category's criterion, so a short plain description ("cabs, autos,
metro, bus") works far better than the bare name (docs/categories.md)."""

from __future__ import annotations

QUESTION_ID = "category"


def _criterion(category: dict) -> str:
    return (category.get("description") or "").strip() or f"Spending on {category['name'].lower()}"


def build_questions(categories: list[dict]) -> dict:
    return {
        QUESTION_ID: {
            "type": "choice",
            "instructions": "Which spending category does this personal expense belong to?",
            "criteria": {c["name"]: _criterion(c) for c in categories},
        }
    }


def classify(agent, descriptions: list[str], categories: list[dict], batch_size: int = 32) -> list[dict]:
    if not descriptions:
        return []

    allowed = {c["name"] for c in categories}
    results = agent.predict_batch(
        [{"body": d} for d in descriptions],
        build_questions(categories),
        batch_size=batch_size,
        sort_by_length=True,
    )

    out: list[dict] = []
    for result in results:
        answer = result["answers"][QUESTION_ID]
        label = answer["choice"]
        if label not in allowed:
            raise ValueError(f"Model returned {label!r}, which is not one of the categories")
        out.append({"category": label, "confidence": float(answer["answer_confidence"])})
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd laya_space && .venv/bin/python -m pytest tests -v`
Expected: 4 passed

- [ ] **Step 5: Write the Space app, requirements and config**

`laya_space/app.py`:

```python
"""Private HF Space: Laya (English checkpoint) behind a JSON API plus a small
Gradio page for trying descriptions by hand. Gradio and FastAPI share one
server on port 7860, which is what Gradio-SDK Spaces expose."""

from __future__ import annotations

import gradio as gr
import laya
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field

from classifier import classify

# Downloaded on first boot, then served from the Space's cache.
agent = laya.load("convaiinnovations/laya")

api = FastAPI()


class CategoryChoice(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    description: str = Field(default="", max_length=200)


class ClassifyIn(BaseModel):
    descriptions: list[str] = Field(min_length=1, max_length=64)
    categories: list[CategoryChoice] = Field(min_length=1, max_length=50)


@api.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


# Plain `def` so FastAPI runs the CPU-bound model call in its threadpool.
@api.post("/classify")
def classify_route(body: ClassifyIn) -> dict:
    descriptions = [d.strip()[:500] for d in body.descriptions]
    return {"results": classify(agent, descriptions, [c.model_dump() for c in body.categories])}


def try_it(description: str, categories: str) -> str:
    # One category per line, as "Name: description" or just "Name".
    cats = []
    for line in categories.splitlines():
        name, _, desc = line.partition(":")
        if name.strip():
            cats.append({"name": name.strip(), "description": desc.strip()})
    if not description.strip() or not cats:
        return "Enter a description and at least one category."
    [result] = classify(agent, [description], cats)
    return f"{result['category']} (confidence {result['confidence']:.2f})"


demo = gr.Interface(
    fn=try_it,
    inputs=[
        gr.Textbox(label="Expense description", value="Dinner at Toit"),
        gr.Textbox(
            label="Categories (one per line, Name: description)",
            lines=4,
            value=(
                "Groceries: food and ingredients bought to cook at home\n"
                "Eating Out: restaurants, food delivery, ready-to-eat food, snacks, sweets\n"
                "Commute: cabs, autos, metro, bus\n"
                "Shopping & Personal Care: clothes, shoes, gadgets, haircut, toiletries"
            ),
        ),
    ],
    outputs=gr.Textbox(label="Prediction"),
    title="Laya categorizer",
)

app = gr.mount_gradio_app(api, demo, path="/")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
```

`laya_space/requirements.txt` (the first line makes pip pull the CPU-only torch wheel, which is far smaller than the CUDA one):

```
--extra-index-url https://download.pytorch.org/whl/cpu
torch
laya
fastapi
uvicorn
```

`laya_space/README.md` — set `sdk_version` to the newest version printed by `pip index versions gradio` (Gradio itself is installed by the Space from this field, so it is not in requirements.txt):

```markdown
---
title: Laya Categorizer
emoji: 🧾
colorFrom: indigo
colorTo: green
sdk: gradio
sdk_version: 5.49.1
python_version: "3.11"
app_file: app.py
pinned: false
---

Private Space used by the Financial Tracker API to categorize Splitwise
expenses with the English Laya checkpoint (`convaiinnovations/laya`).
`POST /classify` with `{"descriptions": [...], "categories": [{"name": ..., "description": ...}]}`.
```

- [ ] **Step 6: Smoke-test the real model locally (confirms the result keys)**

```bash
cd laya_space
.venv/bin/pip install --extra-index-url https://download.pytorch.org/whl/cpu torch laya gradio fastapi uvicorn
.venv/bin/python app.py
# in another terminal:
curl -s localhost:7860/healthz
curl -s -X POST localhost:7860/classify -H 'content-type: application/json' \
  -d '{"descriptions":["Dinner at Toit","Uber to office","Eggs and onions"],"categories":[{"name":"Eating Out","description":"restaurants, food delivery, ready-to-eat food, snacks, sweets"},{"name":"Commute","description":"cabs, autos, metro, bus"},{"name":"Groceries","description":"food and ingredients bought to cook at home"},{"name":"Others"}]}'
```
Expected: `{"status":"ok"}`, then three results whose categories look sensible. If the call fails with a `KeyError`, print one raw `agent.predict_batch` result, fix the keys in `classifier.py` (and the `FakeAgent` in the test to match), and re-run Steps 4 and 6.

- [ ] **Step 7: Create and deploy the private Space (DEFERRED)**

> **Deferred by the user on 2026-10-04. Skip this step.** Hugging Face now requires a PRO account for Gradio and Docker Spaces; a free account gets HTTP 402. Hosting is still undecided. Nothing else in the plan waits on it: all tests fake the Space. With `LAYA_SPACE_URL` unset, preview returns `classifier: "unavailable"`, and the user picks categories by hand. The category memory still fills from those choices. When hosting is decided, update this step and then do Task 5 Step 8 and Task 7 Step 2. The steps below are the original Hugging Face instructions.

1. On huggingface.co: New Space → name `laya-categorizer` → SDK **Gradio** → hardware **CPU basic (free)** → visibility **Private**. If the free account cannot create it, stop and tell the user.
2. Clone the Space's own git repo outside this project, copy the files in, and push. This avoids nesting a git repo inside this one:
   ```bash
   git clone https://huggingface.co/spaces/<hf-username>/laya-categorizer /tmp/laya-categorizer
   cp laya_space/app.py laya_space/classifier.py laya_space/requirements.txt laya_space/README.md /tmp/laya-categorizer/
   cd /tmp/laya-categorizer && git add -A && git commit -m "Laya categorizer Space" && git push
   ```
   Repeat the copy, commit and push whenever `laya_space/` changes.
3. Create a fine-grained token at huggingface.co/settings/tokens with **read access to the `laya-categorizer` Space repo only**.
4. Wait for the Space to show "Running", then verify with the token:
   ```bash
   curl -s https://<hf-username>-laya-categorizer.hf.space/healthz -H "Authorization: Bearer $HF_TOKEN"
   ```
   Expected: `{"status":"ok"}`. Without the header: an HTTP 404 (private Space).

- [ ] **Step 8: Commit (parent repo)**

```bash
git add laya_space/classifier.py laya_space/app.py laya_space/requirements.txt laya_space/README.md laya_space/tests
git commit -m "feat: add Laya categorizer Hugging Face Space"
```

---

### Task 2: Splitwise CSV parser + test harness

**Files:**
- Create: `api/app/services/splitwise.py`, `api/requirements-dev.txt`, `api/pytest.ini`, `api/tests/__init__.py` (empty), `api/tests/conftest.py`
- Test: `api/tests/test_splitwise_parser.py`

**Interfaces:**
- Produces:
  - `class SplitwiseCsvError(ValueError)`
  - `@dataclass(frozen=True) class ParsedRow: fingerprint: str; date: str; description: str; amount: float; cost: float`
  - `@dataclass(frozen=True) class SkippedRow: line: int; description: str; reason: str`
  - `@dataclass(frozen=True) class Settlement: line: int; date: str; description: str; amount: float; currency: str`
  - `@dataclass(frozen=True) class Balance: member: str; currency: str; amount: float` (positive = is owed, negative = owes)
  - `@dataclass(frozen=True) class ParsedCsv: members: list[str]; member_name: str | None; rows: list[ParsedRow]; skipped: list[SkippedRow]; settlements: list[Settlement]; unsettled: list[Balance]` with property `settled -> bool` (`True` when `unsettled` is empty)
  - `parse_splitwise_csv(text: str, member_name: str | None, today: str) -> ParsedCsv`. When `member_name` is `None` or not a member column, it returns `member_name=None` and empty `rows`/`skipped`, but `members`, `settlements` and `unsettled` are always filled in, so the caller can reject an unsettled file before asking who the user is.
  - `unsettled_message(unsettled: list[Balance]) -> str`
  - `memory_key(description: str) -> str`: the category-memory key (Design Decision 7a). An empty string means "don't remember this row".

**Export format, confirmed against the user's real export on 2026-10-03** (`~/Downloads/flat_2026-10-03_export.csv`, two members, 63 rows; never commit a real export, it contains names and money):
- Header `Date,Description,Category,Cost,Currency,<Full Name>,<Full Name>`, no BOM, followed by a **blank line**.
- Dates are `YYYY-MM-DD`. Descriptions often have **trailing spaces** and can be **quoted with commas inside** (`"Garam Masala, Chole Masala and Curd"`).
- Each member column is that person's net balance change for the row (paid minus owed). Every row's member columns sum to zero.
- **Settlement rows** have Category `Payment` and a description like `Parijat S. paid Shalin C.` Names there are abbreviated, unlike the header, so never match them against member names. They move balances but are not expenses.
- The file ends with a blank line and `<date>,Total balance, , ,INR,<balance>,<balance>`. The per-member sums of all rows matched this row exactly, to the paisa.
- One real row had the user paying the whole cost for the other person (`Cost 70.00`, user's net `+70.00`), so the user's share is zero.
- The sample was **not settled** (the user owes 4,927.07). A settled export has `0.00` (possibly `-0.00`) for every member in the Total balance row.

**Settlement rules (from the user, 2026-10-03):**
- The import is only allowed for a **settled** export: every member's balance, summed over all rows of a currency, must be zero. Settlement rows, future-dated rows and rows skipped as expenses all count towards the balance, because Splitwise counts them.
- The Total balance row, when present, must equal those sums. If it doesn't, the file was edited or truncated and is rejected with `SplitwiseCsvError`.
- Settlement rows are recognised by Category `Payment`, or by a blank Category plus a description of the form `<someone> paid <someone>`. They are returned in `settlements` for display and never become expenses or skipped rows.
- A row whose balance can't be read as a number makes the whole file an error, because settlement can't be verified.

- [ ] **Step 1: Set up the test harness**

`api/requirements-dev.txt`:

```
-r requirements.txt
pytest>=8,<9
pytest-asyncio>=0.24,<1.0
```

`api/pytest.ini`:

```ini
[pytest]
testpaths = tests
asyncio_mode = auto
asyncio_default_fixture_loop_scope = function
```

`api/tests/conftest.py` — must run before anything imports `app.config`, because `Settings` reads env vars at import time. It points `DATABASE_URL` at the test DB, or at an unreachable address, so no test can ever touch the real Supabase database from `api/.env` (`load_dotenv` does not override variables that are already set):

```python
import os

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL or "postgres://invalid:invalid@127.0.0.1:1/none"
os.environ.setdefault("APP_TIMEZONE", "Asia/Kolkata")
os.environ["LAYA_SPACE_URL"] = "https://laya.test"
os.environ["LAYA_HF_TOKEN"] = "test-token"
```

Install: `cd api && .venv/bin/pip install -r requirements-dev.txt` (create `api/.venv` with `python3 -m venv .venv` if it does not exist).

- [ ] **Step 2: Write the failing tests**

`api/tests/test_splitwise_parser.py`. The sample is anonymised but laid out exactly like the real export: blank line after the header, a trailing space, a quoted description with a comma, abbreviated names in the settlement row, and a computed Total balance row.

```python
import csv
from decimal import Decimal

import pytest

from app.services.splitwise import (
    Balance,
    Settlement,
    SplitwiseCsvError,
    memory_key,
    parse_splitwise_csv,
    unsettled_message,
)

TODAY = "2026-10-03"
ME = "Parijat Sutradhar"
HEADER = "Date,Description,Category,Cost,Currency,Parijat Sutradhar,Asha Kumar"
ROWS = [
    "2026-09-01,Dinner at Toit ,Dining out,1200.00,INR,600.00,-600.00",  # I paid
    "2026-09-02,Cab to airport,Taxi,900.00,INR,-450.00,450.00",  # Asha paid
    '2026-09-03,"Garam masala, curd",Groceries,90.00,INR,90.00,-90.00',  # I paid all of it for Asha
    "2026-09-04,Movie tickets,Movies,500.00,INR,0.00,0.00",  # not involved
    "2026-09-05,Asha K. paid Parijat S.,Payment,240.00,INR,-240.00,240.00",  # settles the 240 Asha owed
]


def make_csv(rows=ROWS, total=True):
    """Lays rows out like a real export, with one Total balance row per currency."""
    sums: dict[str, list[Decimal]] = {}
    for cells in csv.reader(rows):
        per = sums.setdefault(cells[4], [Decimal(0), Decimal(0)])
        per[0] += Decimal(cells[5])
        per[1] += Decimal(cells[6])
    totals = [f"2026-10-03,Total balance, , ,{cur},{a:.2f},{b:.2f}" for cur, (a, b) in sums.items()] if total else []
    return "\n".join([HEADER, "", *rows, "", *totals]) + "\n"


SAMPLE = make_csv()  # settled: both balances are 0.00


def parse(text=SAMPLE, member=ME, today=TODAY):
    return parse_splitwise_csv(text, member, today)


def test_members_and_settlement_known_without_member():
    result = parse(member=None)
    assert result.members == ["Parijat Sutradhar", "Asha Kumar"]
    assert result.member_name is None
    assert result.rows == [] and result.skipped == []
    assert result.settled and len(result.settlements) == 1


def test_unknown_member_behaves_like_no_member():
    result = parse(member="Someone Else")
    assert result.member_name is None and result.rows == []


def test_share_when_i_paid_and_when_someone_else_paid():
    rows = parse().rows
    assert [(r.date, r.description, r.amount) for r in rows] == [
        ("2026-09-01", "Dinner at Toit", 600.0),  # trailing space stripped; paid 1200, net +600 -> share 600
        ("2026-09-02", "Cab to airport", 450.0),  # Asha paid, my net -450 -> share 450
    ]
    assert rows[0].cost == 1200.0


def test_settlement_rows_are_returned_separately_not_as_expenses():
    result = parse()
    assert result.settlements == [
        Settlement(line=7, date="2026-09-05", description="Asha K. paid Parijat S.", amount=240.0, currency="INR")
    ]
    assert all("paid" not in s.description for s in result.skipped)


def test_settlement_recognised_by_description_when_category_is_blank():
    rows = [*ROWS[:-1], "2026-09-05,Asha K. paid Parijat S.,,240.00,INR,-240.00,240.00"]
    result = parse(make_csv(rows))
    assert len(result.settlements) == 1 and len(result.rows) == 2


def test_rows_with_no_share_for_me_are_skipped_with_reasons():
    skipped = parse().skipped
    assert [(s.line, s.description, s.reason) for s in skipped] == [
        (5, "Garam masala, curd", "You paid the whole amount for others, so none of it is your expense"),
        (6, "Movie tickets", "Your balance didn't change, so you weren't part of this expense"),
    ]


def test_settled_export():
    result = parse()
    assert result.settled and result.unsettled == []


def test_unsettled_export_reports_who_owes():
    result = parse(make_csv(ROWS[:-1]))  # drop the settlement row
    assert not result.settled
    assert result.unsettled == [
        Balance(member="Parijat Sutradhar", currency="INR", amount=240.0),
        Balance(member="Asha Kumar", currency="INR", amount=-240.0),
    ]
    assert unsettled_message(result.unsettled) == (
        "This export isn't settled yet: Asha Kumar owes INR 240.00. "
        "Settle up in Splitwise, export again and upload the new file."
    )
    assert not parse(make_csv(ROWS[:-1]), member=None).settled


def test_unsettled_without_total_row_is_still_detected():
    assert not parse(make_csv(ROWS[:-1], total=False)).settled


def test_negative_zero_total_counts_as_settled():
    text = SAMPLE.replace("Total balance, , ,INR,0.00,0.00", "Total balance, , ,INR,-0.00,0.00")
    assert parse(text).settled


def test_total_row_that_does_not_add_up_is_rejected():
    text = SAMPLE.replace("Total balance, , ,INR,0.00,0.00", "Total balance, , ,INR,-10.00,10.00")
    with pytest.raises(SplitwiseCsvError, match="Total balance"):
        parse(text)


def test_unreadable_balance_is_an_error():
    text = SAMPLE.replace("INR,-450.00,450.00", "INR,-450.00,abc")
    with pytest.raises(SplitwiseCsvError, match="isn't a number"):
        parse(text)


def test_bom_is_tolerated():
    assert len(parse("\ufeff" + SAMPLE).rows) == 2


def test_non_iso_date_is_skipped():
    text = SAMPLE.replace("2026-09-01,Dinner", "01/09/2026,Dinner")
    result = parse(text)
    assert [r.description for r in result.rows] == ["Cab to airport"]
    assert result.skipped[0].reason == "Unrecognised date '01/09/2026' (expected YYYY-MM-DD)"


def test_future_date_and_other_currency_skipped():
    rows = [ROWS[0].replace("2026-09-01", "2026-12-01"), ROWS[1].replace(",INR,", ",USD,"), *ROWS[2:]]
    reasons = [s.reason for s in parse(make_csv(rows)).skipped]
    assert "Dated in the future" in reasons
    assert "Currency USD is not supported" in reasons


def test_bad_cost_skipped():
    rows = [ROWS[0].replace("1200.00", "abc"), *ROWS[1:]]
    assert parse(make_csv(rows)).skipped[0].reason == "Amount is not a number"


def test_not_a_splitwise_file():
    with pytest.raises(SplitwiseCsvError, match="doesn't look like a Splitwise export"):
        parse("Txn Date,Narration,Amount\n2026-09-01,UPI,100\n")


def test_empty_file():
    with pytest.raises(SplitwiseCsvError, match="empty"):
        parse("\n\n")


def test_no_member_columns():
    with pytest.raises(SplitwiseCsvError, match="no people"):
        parse("Date,Description,Category,Cost,Currency\n", member=None)


def test_identical_rows_get_distinct_fingerprints():
    coffee = "2026-09-06,Coffee,Dining out,200.00,INR,-100.00,100.00"
    rows = parse(make_csv([*ROWS, coffee, coffee])).rows
    coffees = [r for r in rows if r.description == "Coffee"]
    assert len(coffees) == 2
    assert coffees[0].fingerprint != coffees[1].fingerprint


def test_fingerprint_stable_across_files():
    a = {r.description: r.fingerprint for r in parse().rows}
    # A later export with an extra row and different whitespace/case in a description.
    snack = "2026-09-06,Snacks,Dining out,100.00,INR,-50.00,50.00"
    later = make_csv([ROWS[0].replace("Dinner at Toit ", "dinner  at TOIT"), *ROWS[1:], snack])
    b = {r.description.lower(): r.fingerprint for r in parse(later).rows}
    assert b["dinner  at toit"] == a["Dinner at Toit"]
    assert b["cab to airport"] == a["Cab to airport"]


def test_fingerprint_ignores_my_share():
    edited = make_csv([ROWS[0], ROWS[1].replace("-450.00,450.00", "-300.00,300.00"), *ROWS[2:]])
    before = {r.description: r.fingerprint for r in parse().rows}
    after = {r.description: r for r in parse(edited).rows}
    assert after["Cab to airport"].fingerprint == before["Cab to airport"]
    assert after["Cab to airport"].amount == 300.0


def test_memory_key_drops_dates_numbers_and_punctuation():
    # Real descriptions from the export, which repeat with a different date each time.
    assert memory_key("Grocery Ratnadeep 22/08") == "grocery ratnadeep"
    assert memory_key("  grocery  RATNADEEP 6/9 ") == "grocery ratnadeep"
    assert memory_key("Maintenance Sept26") == "maintenance"
    assert memory_key("Breakfast+ Ratnadeep 6/9") == "breakfast ratnadeep"
    assert memory_key("Garam Masala, Chole Masala and Curd") == "garam masala chole masala and curd"


def test_memory_key_empty_when_only_numbers():
    assert memory_key("22/08") == ""
    assert memory_key(" - ") == ""
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd api && .venv/bin/python -m pytest tests/test_splitwise_parser.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.splitwise'`

- [ ] **Step 4: Write the implementation**

`api/app/services/splitwise.py`:

```python
"""Parses a Splitwise "Export as spreadsheet" CSV into the user's share of
each expense, and checks that the export is settled.

The file has one column per person after Date/Description/Category/Cost/
Currency. Each of those holds that person's *net* balance change for the row
(paid minus owed), not their share, so the share is derived from it. The
Category column is only used to spot settlement rows; categorization itself
is done by Laya, not Splitwise.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

REQUIRED_COLUMNS = ("date", "description", "category", "cost", "currency")
SUPPORTED_CURRENCY = "INR"
_CENT = Decimal("0.01")
# Splitwise's settle-up description, e.g. "Parijat S. paid Shalin C."
_PAID_RE = re.compile(r"^\S.*\s+paid\s+\S.*$", re.IGNORECASE)
_HAS_DIGIT_RE = re.compile(r"\S*\d\S*")
_NON_WORD_RE = re.compile(r"[^\w]+")


class SplitwiseCsvError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedRow:
    fingerprint: str
    date: str
    description: str
    amount: float
    cost: float


@dataclass(frozen=True)
class SkippedRow:
    line: int
    description: str
    reason: str


@dataclass(frozen=True)
class Settlement:
    line: int
    date: str
    description: str
    amount: float
    currency: str


@dataclass(frozen=True)
class Balance:
    member: str
    currency: str
    amount: float  # positive: is owed money; negative: owes money


@dataclass(frozen=True)
class ParsedCsv:
    members: list[str]
    member_name: str | None
    rows: list[ParsedRow]
    skipped: list[SkippedRow]
    settlements: list[Settlement]
    unsettled: list[Balance]

    @property
    def settled(self) -> bool:
        return not self.unsettled


def unsettled_message(unsettled: list[Balance]) -> str:
    owing = [b for b in unsettled if b.amount < 0] or unsettled
    parts = [f"{b.member} owes {b.currency} {abs(b.amount):,.2f}" for b in owing]
    return (
        f"This export isn't settled yet: {'; '.join(parts)}. "
        "Settle up in Splitwise, export again and upload the new file."
    )


def memory_key(description: str) -> str:
    """Key for the category memory. The same purchase recurs with a different
    date or number in it ("Grocery Ratnadeep 22/08", "... 6/9"), so tokens
    with a digit are dropped. Empty means there is nothing worth remembering."""
    text = _HAS_DIGIT_RE.sub(" ", description.lower())
    return " ".join(_NON_WORD_RE.sub(" ", text).split())


def _is_blank(cells: list[str]) -> bool:
    return not any(c.strip() for c in cells)


def _valid_iso_date(value: str) -> bool:
    if len(value) != 10:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _is_settlement(category: str, description: str) -> bool:
    if category.lower() == "payment":
        return True
    return not category and bool(_PAID_RE.match(description))


def _to_decimal(value: str) -> Decimal:
    """Parses a number; blank means zero. Raises InvalidOperation for junk or non-finite values."""
    number = Decimal(value or "0")
    if not number.is_finite():
        raise InvalidOperation(value)
    return number


def _fingerprint(date_: str, description: str, cost: Decimal, currency: str, occurrence: int) -> str:
    normalised = " ".join(description.lower().split())
    key = "|".join((date_, normalised, f"{cost:.2f}", currency, str(occurrence)))
    return hashlib.sha256(key.encode("utf8")).hexdigest()


def parse_splitwise_csv(text: str, member_name: str | None, today: str) -> ParsedCsv:
    lines = list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))

    header_index = next((i for i, cells in enumerate(lines) if not _is_blank(cells)), None)
    if header_index is None:
        raise SplitwiseCsvError("The file is empty")

    header = [c.strip() for c in lines[header_index]]
    if tuple(h.lower() for h in header[:5]) != REQUIRED_COLUMNS:
        raise SplitwiseCsvError(
            "This doesn't look like a Splitwise export: expected the columns "
            "Date, Description, Category, Cost, Currency"
        )

    members = [h for h in header[5:] if h]
    if not members:
        raise SplitwiseCsvError("The export has no people columns, so your share can't be worked out")
    member_cols = {m: header.index(m) for m in members}
    if member_name not in member_cols:
        member_name = None

    rows: list[ParsedRow] = []
    skipped: list[SkippedRow] = []
    settlements: list[Settlement] = []
    balances: defaultdict[str, defaultdict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    totals: dict[str, dict[str, Decimal]] = {}
    occurrences: Counter[tuple] = Counter()

    # csv line numbers are 1-based and the header is line header_index + 1.
    for line_no, raw in enumerate(lines[header_index + 1 :], start=header_index + 2):
        if _is_blank(raw):
            continue
        cells = [c.strip() for c in raw] + [""] * max(0, len(header) - len(raw))
        date_s, description, category, cost_s, currency = cells[:5]
        currency = currency.upper()

        try:
            row_balances = {m: _to_decimal(cells[col]) for m, col in member_cols.items()}
        except InvalidOperation as exc:
            raise SplitwiseCsvError(
                f"Line {line_no} has a balance that isn't a number, so I can't check whether the export is settled"
            ) from exc

        if description.lower() == "total balance":
            totals[currency] = row_balances
            continue
        for m, value in row_balances.items():
            balances[currency][m] += value

        if _is_settlement(category, description):
            try:
                amount = float(_to_decimal(cost_s))
            except InvalidOperation:
                amount = 0.0
            settlements.append(
                Settlement(line=line_no, date=date_s, description=description, amount=amount, currency=currency)
            )
            continue
        if member_name is None:
            continue

        def skip(reason: str) -> None:
            skipped.append(SkippedRow(line=line_no, description=description or "(no description)", reason=reason))

        if not _valid_iso_date(date_s):
            skip(f"Unrecognised date '{date_s}' (expected YYYY-MM-DD)")
            continue
        if date_s > today:
            skip("Dated in the future")
            continue
        if currency != SUPPORTED_CURRENCY:
            skip(f"Currency {currency or '(blank)'} is not supported")
            continue
        if not description:
            skip("Missing description")
            continue
        try:
            cost = _to_decimal(cost_s)
        except InvalidOperation:
            skip("Amount is not a number")
            continue

        net = row_balances[member_name]
        if net == 0:
            skip("Your balance didn't change, so you weren't part of this expense")
            continue
        # net < 0: someone else paid and my share is what I now owe.
        # net > 0: I paid; my share is the cost minus what the others owe me
        # (assumes I was the only payer).
        share = (-net if net < 0 else cost - net).quantize(_CENT)
        if share == 0:
            skip("You paid the whole amount for others, so none of it is your expense")
            continue
        if share < 0:
            skip("Your balance change is bigger than the cost; check this expense in Splitwise")
            continue

        description = description[:500]
        key = (date_s, " ".join(description.lower().split()), f"{cost:.2f}", currency)
        occurrences[key] += 1

        rows.append(
            ParsedRow(
                fingerprint=_fingerprint(date_s, description, cost, currency, occurrences[key]),
                date=date_s,
                description=description,
                amount=float(share),
                cost=float(cost),
            )
        )

    for currency, total in totals.items():
        if any(total[m].quantize(_CENT) != balances[currency][m].quantize(_CENT) for m in members):
            raise SplitwiseCsvError(
                "The Total balance row doesn't match the rows above it. "
                "Export again from Splitwise and upload the file without editing it."
            )

    unsettled = [
        Balance(member=m, currency=currency, amount=float(balances[currency][m].quantize(_CENT)))
        for currency in sorted(balances)
        for m in members
        if balances[currency][m].quantize(_CENT) != 0
    ]

    return ParsedCsv(
        members=members,
        member_name=member_name,
        rows=rows,
        skipped=skipped,
        settlements=settlements,
        unsettled=unsettled,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && .venv/bin/python -m pytest tests/test_splitwise_parser.py -v`
Expected: 24 passed

- [ ] **Step 6: Check against the real export, without committing it**

The user's real export is unsettled, so it must fail the settlement check with the right figure:

```bash
cd api && .venv/bin/python -c "
from app.services.splitwise import parse_splitwise_csv, unsettled_message
p = parse_splitwise_csv(open('$HOME/Downloads/flat_2026-10-03_export.csv').read(), 'Parijat Sutradhar', '2026-10-03')
print(len(p.rows), 'rows', len(p.skipped), 'skipped', len(p.settlements), 'settlements')
print(unsettled_message(p.unsettled))"
```

Expected: `60 rows 1 skipped 2 settlements`, and the message says `Parijat Sutradhar owes INR 4,927.07`. This was verified when the plan was written. If the file is gone, skip this step and say so in the task report.

- [ ] **Step 7: Commit**

```bash
git add api/app/services/splitwise.py api/requirements-dev.txt api/pytest.ini api/tests/__init__.py api/tests/conftest.py api/tests/test_splitwise_parser.py
git commit -m "feat(api): parse Splitwise CSV exports and require a settled export"
```

---

### Task 3: Categorizer client

**Files:**
- Create: `api/app/services/categorizer.py`
- Modify: `api/app/config.py` (add two settings at the end of `Settings`), `api/requirements.txt`, `api/.env.example`
- Test: `api/tests/test_categorizer.py`

**Interfaces:**
- Consumes: the Space HTTP contract from Task 1.
- Produces:
  - `class CategorizerUnavailable(Exception)`
  - `@dataclass(frozen=True) class Prediction: category: str; confidence: float`
  - `async def classify(descriptions: list[str], categories: list[dict], *, transport: httpx.AsyncBaseTransport | None = None) -> list[Prediction]`. Each category is `{"name": str, "description": str}` and is passed to the Space as is.
  - `async def is_ready(*, transport: httpx.AsyncBaseTransport | None = None) -> bool`
  - `settings.laya_space_url: str | None`, `settings.laya_hf_token: str | None`

- [ ] **Step 1: Add settings, dependency and env example**

Append inside `class Settings` in `api/app/config.py`, after `supabase_url`:

```python
    # Private Hugging Face Space running the Laya categorizer, e.g.
    # https://<user>-laya-categorizer.hf.space, and a fine-grained HF token
    # with read access to that Space. Unset means Splitwise imports still
    # work, but every category has to be picked by hand.
    laya_space_url: str | None = os.environ.get("LAYA_SPACE_URL")
    laya_hf_token: str | None = os.environ.get("LAYA_HF_TOKEN")
```

Append to `api/requirements.txt`:

```
httpx>=0.27,<1.0
```

Append to `api/.env.example`:

```
# Laya categorizer Space used by Splitwise import (optional)
LAYA_SPACE_URL=https://<hf-username>-laya-categorizer.hf.space
LAYA_HF_TOKEN=hf_xxx
```

Run `cd api && .venv/bin/pip install -r requirements-dev.txt`.

- [ ] **Step 2: Write the failing tests**

`api/tests/test_categorizer.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd api && .venv/bin/python -m pytest tests/test_categorizer.py -v`
Expected: FAIL with `ImportError: cannot import name 'categorizer'`

- [ ] **Step 4: Write the implementation**

`api/app/services/categorizer.py`:

```python
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
```

Note: `response.json()` on non-JSON raises `json.JSONDecodeError`, a `ValueError` subclass, so it is covered.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && .venv/bin/python -m pytest tests -v`
Expected: all parser + categorizer tests pass (34 passed)

- [ ] **Step 6: Commit**

```bash
git add api/app/services/categorizer.py api/app/config.py api/requirements.txt api/.env.example api/tests/test_categorizer.py
git commit -m "feat(api): add client for the Laya categorizer Space"
```

---

### Task 4: Category descriptions

Design Decision 2c. The column is added here, before the Splitwise tables, because Task 5's preview reads it.

**Files:**
- Create: `migrations/004_splitwise_imports.sql`
- Modify: `supabase/init.sql` (start section 7), `api/app/services/categories.py`, `api/app/schemas.py` (`CategoryOut`, `CategoryIn`), `api/app/routes/categories.py`, `api/app/finance_config.py` (`ConfiguredCategory`), `app/src/api.ts`, `app/src/components/modals/CategoryFormModal.tsx`, `app/src/components/modals/ManageCategoriesModal.tsx`
- Test: `api/tests/test_category_descriptions.py`

**Interfaces:**
- Consumes: the test harness from Task 2 (`conftest.py`, `pytest.ini`).
- Produces:
  - Column `categories.description VARCHAR(200) NOT NULL DEFAULT ''`.
  - `list_categories(conn)` dicts gain `"description": str`, consumed by Task 5.
  - `GET /api/config`, `POST /api/categories` and `PATCH /api/categories/{id}` responses gain `description: string`. It is `""` for the reserved Transfer, Salary and Adjustment rows.
  - `POST` and `PATCH /api/categories` accept an optional `description` of up to 200 characters, trimmed. On `PATCH`, an omitted or `null` description keeps the stored one, so an older app build can't wipe it.
  - TypeScript: `Category.description: string` and `export interface CategoryInput { name: string; icon: string; color: string; description?: string }`.

- [ ] **Step 1: Write the migration, update init.sql, create the test DB**

`migrations/004_splitwise_imports.sql`:

```sql
-- 004_splitwise_imports.sql
--
-- Brings an already-initialised database in line with the updated init.sql.
-- Apply locally with:
--
--   docker exec -i finance-db psql -U postgres -d financedb \
--     < migrations/004_splitwise_imports.sql
--
-- and on Supabase by pasting it into the SQL editor (or psql against the
-- direct connection, port 5432). Safe to run more than once.
--
-- Everything the Splitwise import needs: a short description per category
-- for the Laya categorizer, and (added in Task 5) the dedup and
-- category-memory tables.

BEGIN;

-- Plain words for what goes in the category (docs/categories.md). Laya
-- scores each expense against these; empty falls back to the name.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description VARCHAR(200) NOT NULL DEFAULT '';

COMMIT;
```

Append to the end of `supabase/init.sql`:

```sql

-- 7. Splitwise import
-- Short description per category, given to the Laya categorizer
-- (docs/categories.md). Empty means Laya only sees the name.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description VARCHAR(200) NOT NULL DEFAULT '';
```

Apply to the local dev DB: `docker exec -i finance-db psql -U postgres -d financedb < migrations/004_splitwise_imports.sql`
Expected: `BEGIN`, `ALTER TABLE`, `COMMIT`

Create the test DB (once):

```bash
docker exec finance-db psql -U postgres -c "CREATE DATABASE financedb_test"
docker exec -i finance-db psql -U postgres -d financedb_test < supabase/init.sql
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/financedb_test
```

- [ ] **Step 2: Write the failing tests**

`api/tests/test_category_descriptions.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd api && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/financedb_test .venv/bin/python -m pytest tests/test_category_descriptions.py -v`
Expected: FAIL with `KeyError: 'description'` in the first four tests. The last test fails because the API returns 201.

- [ ] **Step 4: Backend implementation**

`api/app/services/categories.py`:

```python
CATEGORY_COLUMNS = "id, name, icon, color, spendable, hidden, description"
```

In `to_category`, add after `"hidden"`:

```python
        "description": row["description"],
```

Replace `create_category` and `update_category`:

```python
async def create_category(
    conn: asyncpg.connection.Connection, name: str, icon: str, color: str, description: str = ""
) -> dict:
    _check_color(color)
    row = await conn.fetchrow(
        f"""INSERT INTO categories (name, icon, color, description)
                 VALUES ($1, $2, $3, $4)
              RETURNING {CATEGORY_COLUMNS}""",
        name,
        icon,
        color,
        description,
    )
    return to_category(row)


async def update_category(
    conn: asyncpg.connection.Connection,
    category_id: str,
    name: str,
    icon: str,
    color: str,
    description: str | None = None,
) -> dict:
    """description=None keeps the stored one (clients that predate the field)."""
    _check_color(color)
    row = await conn.fetchrow(
        f"""UPDATE categories
               SET name = $2, icon = $3, color = $4, description = COALESCE($5, description)
             WHERE id = $1::uuid
         RETURNING {CATEGORY_COLUMNS}""",
        category_id,
        name,
        icon,
        color,
        description,
    )
    if row is None:
        raise not_found(f"Category {category_id} not found")
    return to_category(row)
```

In `provision_categories`, seed the description too:

```python
        row = await conn.fetchrow(
            """INSERT INTO categories (name, icon, color, description)
                    VALUES ($1, $2, $3, $4)
               ON CONFLICT (name) DO NOTHING
                 RETURNING name""",
            category.name,
            category.icon,
            category.color,
            category.description,
        )
```

`api/app/schemas.py`: add to `CategoryOut`, after `hidden`:

```python
    description: str = ""
```

and to `CategoryIn`, after `color`:

```python
    description: Optional[str] = Field(default=None, max_length=200)

    @field_validator("description")
    @classmethod
    def _description(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v is not None else None
```

`api/app/routes/categories.py`:

```python
        row = await create_category(conn, body.name, body.icon, body.color, body.description or "")
```

```python
        row = await update_category(conn, category_id, body.name, body.icon, body.color, body.description)
```

`api/app/finance_config.py`: add to `ConfiguredCategory`, after `color`:

```python
    description: str = Field(default="", max_length=200)
```

`provision_categories` only inserts missing categories. Categories that already exist get their description from the app (Step 6). When the new set in `docs/categories.md` ships, its config block already includes descriptions.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/financedb_test .venv/bin/python -m pytest -v`
Expected: all pass (39 passed: 24 parser, 10 categorizer, 5 here).

- [ ] **Step 6: App: show and edit the description**

`app/src/api.ts`: add to `Category`, after `hidden`:

```ts
  /** Plain words for what goes in the category; the Splitwise import's categorizer reads it. */
  description: string;
```

Add below `AppConfig`:

```ts
export interface CategoryInput {
  name: string;
  icon: string;
  color: string;
  description?: string;
}
```

Change the `addCategory` and `updateCategory` body types from `{ name: string; icon: string; color: string }` to `CategoryInput`.

`app/src/components/modals/ManageCategoriesModal.tsx`: import `CategoryInput` with `Category`, and type `onAdd` as `(input: CategoryInput) => Promise<void>` and `onEdit` as `(id: string, input: CategoryInput) => Promise<void>`. `Dashboard.tsx` passes `input` straight through, so it needs no change.

`app/src/components/modals/CategoryFormModal.tsx`:
- Import `CategoryInput` and type `onSave` as `(input: CategoryInput) => Promise<void>`.
- Add state `const [description, setDescription] = useState(category?.description ?? '');`.
- In `submit`, send `{ name: name.trim(), icon: icon.trim(), color: color.trim(), description: description.trim() }`.
- Add this field between the Icon/Colour row and the error line:

```tsx
        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">What goes in it</Text>
          <TextInput
            className="rounded-xl border border-border px-3 py-3 text-sm text-ink"
            placeholder="e.g. cabs, autos, metro, bus"
            value={description}
            onChangeText={setDescription}
            maxLength={200}
            multiline
          />
          <Text className="text-[10px] text-muted">A few plain words, no brand names. Helps the Splitwise import pick this category.</Text>
        </View>
```

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

Check by hand with `EXPO_PUBLIC_API_URL=http://localhost:3001 npx expo start --web`:
1. Edit Rent, enter `rent, society maintenance, move-in charges, monthly furniture and appliance rental` and save. Open it again and the text is still there.
2. Change only the icon of a category that has a description. The description stays.
3. Add a category with no description. It saves as before.

- [ ] **Step 7: Commit**

```bash
git add migrations/004_splitwise_imports.sql supabase/init.sql api/app/services/categories.py api/app/schemas.py api/app/routes/categories.py api/app/finance_config.py api/tests/test_category_descriptions.py app/src/api.ts app/src/components/modals/CategoryFormModal.tsx app/src/components/modals/ManageCategoriesModal.tsx
git commit -m "feat: add a description to categories for the Laya categorizer"
```

---

### Task 5: Migration, import service and `/api/splitwise` routes

**Files:**
- Create: `api/app/services/splitwise_import.py`, `api/app/routes/splitwise.py`
- Modify: `migrations/004_splitwise_imports.sql` and `supabase/init.sql` (both from Task 4), `api/app/schemas.py` (append models), `api/app/main.py` (import + register router)
- Test: `api/tests/test_splitwise_routes.py`

**Interfaces:**
- Consumes: `parse_splitwise_csv`, `SplitwiseCsvError`, `unsettled_message`, `memory_key`, `ParsedCsv.settled`, `ParsedCsv.settlements` (Task 2); `categorizer.classify`, `categorizer.is_ready`, `CategorizerUnavailable` (Task 3); `list_categories` with `description` (Task 4); existing `lock_accounts`, `sync_balance`, `category_names`, `today_iso`, `acquire`, `transaction`.
- Produces (HTTP, consumed by Task 6), all behind Supabase JWT auth:
  - `GET /api/splitwise/classifier-status` → `{ready: boolean}`
  - `POST /api/splitwise/preview` body `{csv: string, memberName: string|null}` → `{members: string[], memberName: string|null, rows: [{fingerprint, date, description, amount, category: string|null, confidence: number|null, source: "memory"|"laya"|null, alreadyImported: boolean}], skipped: [{line, description, reason}], settlements: [{line, date, description, amount}], classifier: "ok"|"unavailable"|"not_run"}`. An unsettled export is a `400` whose `error` is `unsettled_message(...)`.
  - `POST /api/splitwise/import` body `{accountId, rows: [{fingerprint, date, description, amount, category}]}` (1–500 rows) → `201 {imported: number, skippedDuplicates: number, account: Account}`
- Produces (Python): `already_imported(conn, fingerprints: list[str]) -> set[str]`; `recall_categories(conn, keys: list[str]) -> dict[str, str]` (memory key → remembered category name); `import_rows(conn, tz_name: str, account_id: str, rows: list[SplitwiseImportRowIn]) -> dict` returning `{"imported": int, "skipped_duplicates": int, "account": dict}`.

- [ ] **Step 1: Add the tables to the migration and init.sql**

In `migrations/004_splitwise_imports.sql` (created in Task 4), insert between the `ALTER TABLE categories …` line and `COMMIT;`:

```sql

-- One row per Splitwise expense already imported, keyed on a fingerprint of
-- date/description/cost/currency/occurrence, so re-uploading an overlapping
-- export never records the same expense twice. Transactions stay immutable;
-- this table only points at them.
CREATE TABLE IF NOT EXISTS splitwise_imports (
    fingerprint CHAR(64) PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp()
);

-- The category the user confirmed for each description (keyed by
-- splitwise.memory_key), so a repeat description is categorized without
-- calling Laya. It holds a category *name*, not a foreign key: a renamed or
-- deleted category is simply ignored at lookup time.
CREATE TABLE IF NOT EXISTS category_memory (
    description_key TEXT PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp()
);
```

Append to the end of `supabase/init.sql`, after the section 7 `ALTER TABLE` from Task 4:

```sql

-- One row per Splitwise expense already imported, keyed on a fingerprint of
-- date/description/cost/currency/occurrence (api/app/services/splitwise.py),
-- so re-uploading an overlapping export never records an expense twice.
CREATE TABLE IF NOT EXISTS splitwise_imports (
    fingerprint CHAR(64) PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp()
);

-- Category the user last confirmed for each description, keyed by
-- splitwise.memory_key, so repeats skip Laya. A category name, not a foreign
-- key: names that no longer exist are ignored at lookup time.
CREATE TABLE IF NOT EXISTS category_memory (
    description_key TEXT PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp()
);
```

Apply to the local dev DB and to the test DB from Task 4 Step 1. The migration is safe to re-run:

```bash
docker exec -i finance-db psql -U postgres -d financedb < migrations/004_splitwise_imports.sql
docker exec -i finance-db psql -U postgres -d financedb_test < migrations/004_splitwise_imports.sql
```
Expected for each: `BEGIN`, `ALTER TABLE`, `CREATE TABLE`, `CREATE TABLE`, `COMMIT`

- [ ] **Step 2: Append the schemas**

Append to `api/app/schemas.py`:

```python
# ---------------------------------------------------------------------------
# Splitwise import
# ---------------------------------------------------------------------------

_FINGERPRINT_RE = re.compile(r"^[0-9a-f]{64}$")
SPLITWISE_MAX_ROWS = 500


class SplitwisePreviewIn(CamelModel):
    csv: str = Field(min_length=1, max_length=1_000_000)
    member_name: Optional[str] = None


class SplitwisePreviewRowOut(CamelModel):
    fingerprint: str
    date: str
    description: str
    amount: float
    category: Optional[str] = None
    confidence: Optional[float] = None
    source: Optional[Literal["memory", "laya"]] = None
    already_imported: bool


class SplitwiseSkippedOut(CamelModel):
    line: int
    description: str
    reason: str


class SplitwiseSettlementOut(CamelModel):
    line: int
    date: str
    description: str
    amount: float


class SplitwisePreviewOut(CamelModel):
    members: list[str]
    member_name: Optional[str] = None
    rows: list[SplitwisePreviewRowOut]
    skipped: list[SplitwiseSkippedOut]
    settlements: list[SplitwiseSettlementOut]
    classifier: Literal["ok", "unavailable", "not_run"]


class SplitwiseImportRowIn(CamelModel):
    fingerprint: str
    date: str
    description: str
    amount: float
    category: str = Field(min_length=1, max_length=50)

    @field_validator("fingerprint")
    @classmethod
    def _fingerprint(cls, v: str) -> str:
        if not _FINGERPRINT_RE.match(v):
            raise ValueError("Expected a row fingerprint")
        return v

    @field_validator("date")
    @classmethod
    def _date(cls, v: str) -> str:
        return _validate_not_in_future(_validate_iso_date(v))

    @field_validator("description")
    @classmethod
    def _description(cls, v: str) -> str:
        return _validate_description(v, required=True)

    @field_validator("amount")
    @classmethod
    def _amount(cls, v: object) -> float:
        return _validate_positive_money(v)


class SplitwiseImportIn(CamelModel):
    account_id: str
    rows: list[SplitwiseImportRowIn] = Field(min_length=1, max_length=SPLITWISE_MAX_ROWS)

    @field_validator("account_id")
    @classmethod
    def _account_id(cls, v: str) -> str:
        return _validate_uuid(v)

    @model_validator(mode="after")
    def _unique_fingerprints(self) -> "SplitwiseImportIn":
        prints = [r.fingerprint for r in self.rows]
        if len(set(prints)) != len(prints):
            raise ValueError("Each row may only appear once")
        return self


class SplitwiseImportOut(CamelModel):
    imported: int
    skipped_duplicates: int
    account: AccountOut


class ClassifierStatusOut(CamelModel):
    ready: bool
```

- [ ] **Step 3: Write the failing route tests**

`api/tests/test_splitwise_routes.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd api && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/financedb_test .venv/bin/python -m pytest tests/test_splitwise_routes.py -v`
Expected: FAIL with `ImportError: cannot import name 'splitwise' from 'app.routes'`

- [ ] **Step 5: Write the import service**

`api/app/services/splitwise_import.py`:

```python
"""DB side of the Splitwise import: which rows are already in, the category
memory, and a bulk insert of the rest.

Inserts every row in one statement rather than calling insert_transaction per
row: the API runs far from the database (see KNOWN_ISSUES.md), so hundreds of
sequential round trips would blow past the function time limit. The
timestamp rule matches insert_transaction exactly.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import asyncpg

from ..errors import bad_request
from .balances import lock_accounts, sync_balance
from .categories import category_names
from .dates import parse_iso_date, today_iso
from .splitwise import memory_key


def transaction_timestamp(tz_name: str, date_: str) -> datetime | None:
    """None means "use the insert clock time", for a row dated today; a
    back-dated row lands at local midnight on its own day."""
    if date_ == today_iso(tz_name):
        return None
    year, month, day = parse_iso_date(date_)
    return datetime(year, month, day, tzinfo=ZoneInfo(tz_name))


async def already_imported(conn: asyncpg.connection.Connection, fingerprints: list[str]) -> set[str]:
    if not fingerprints:
        return set()
    rows = await conn.fetch(
        "SELECT fingerprint FROM splitwise_imports WHERE fingerprint = ANY($1::text[])", fingerprints
    )
    return {row["fingerprint"] for row in rows}


async def recall_categories(conn: asyncpg.connection.Connection, keys: list[str]) -> dict[str, str]:
    """Remembered category per memory key. The caller checks the category
    still exists, since the table stores names, not foreign keys."""
    if not keys:
        return {}
    rows = await conn.fetch(
        "SELECT description_key, category FROM category_memory WHERE description_key = ANY($1::text[])", keys
    )
    return {row["description_key"]: row["category"] for row in rows}


async def import_rows(conn: asyncpg.connection.Connection, tz_name: str, account_id: str, rows: list) -> dict:
    """Must run inside db.transaction(). `rows` are SplitwiseImportRowIn."""
    names = await category_names(conn)
    unknown = sorted({r.category for r in rows if r.category not in names})
    if unknown:
        raise bad_request(f"Unknown category: {', '.join(unknown)}. Re-run the preview and pick again.")

    # The account lock also serializes two imports of the same file.
    await lock_accounts(conn, [account_id])

    existing = await already_imported(conn, [r.fingerprint for r in rows])
    fresh = [r for r in rows if r.fingerprint not in existing]

    if fresh:
        ids = [uuid.uuid4() for _ in fresh]
        await conn.execute(
            """INSERT INTO transactions (id, account_id, amount, type, category, description, transaction_date)
               SELECT r.id, $1::uuid, r.amount, 'debit', r.category, r.description,
                      COALESCE(r.ts, clock_timestamp())
                 FROM unnest($2::uuid[], $3::numeric[], $4::text[], $5::text[], $6::timestamptz[])
                      AS r(id, amount, category, description, ts)""",
            account_id,
            ids,
            [Decimal(str(r.amount)) for r in fresh],
            [r.category for r in fresh],
            [r.description for r in fresh],
            [transaction_timestamp(tz_name, r.date) for r in fresh],
        )
        await conn.execute(
            """INSERT INTO splitwise_imports (fingerprint, transaction_id)
               SELECT * FROM unnest($1::text[], $2::uuid[])""",
            [r.fingerprint for r in fresh],
            ids,
        )

        # Importing is the user's confirmation, so remember each row's final
        # category, whether it was Laya's or the user's. Last row wins per key.
        remembered = {key: r.category for r in fresh if (key := memory_key(r.description))}
        if remembered:
            await conn.execute(
                """INSERT INTO category_memory (description_key, category)
                   SELECT * FROM unnest($1::text[], $2::text[])
                   ON CONFLICT (description_key)
                   DO UPDATE SET category = EXCLUDED.category, updated_at = clock_timestamp()""",
                list(remembered),
                list(remembered.values()),
            )

    account = await sync_balance(conn, account_id)
    return {"imported": len(fresh), "skipped_duplicates": len(rows) - len(fresh), "account": account}
```

- [ ] **Step 6: Write the routes and register them**

`api/app/routes/splitwise.py`:

```python
"""Splitwise CSV import.

/preview parses the export, drops rows already imported, reuses the category
the user confirmed before for a repeat description, and asks the Laya
categorizer about the rest. It never writes. /import records the rows the
user confirmed and remembers their categories. /classifier-status lets the app wake the
Hugging Face Space as soon as the import modal opens.
"""

from __future__ import annotations

import logging
from typing import NamedTuple, Optional

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from ..config import settings
from ..db import acquire
from ..db import transaction as db_transaction
from ..errors import bad_request
from ..schemas import (
    SPLITWISE_MAX_ROWS,
    AccountOut,
    ClassifierStatusOut,
    SplitwiseImportIn,
    SplitwiseImportOut,
    SplitwisePreviewIn,
    SplitwisePreviewOut,
    SplitwisePreviewRowOut,
    SplitwiseSettlementOut,
    SplitwiseSkippedOut,
)
from ..services import categorizer
from ..services.categories import list_categories
from ..services.dates import today_iso
from ..services.splitwise import SplitwiseCsvError, memory_key, parse_splitwise_csv, unsettled_message
from ..services.splitwise_import import already_imported, import_rows, recall_categories

logger = logging.getLogger("finance_api")
router = APIRouter()


class Suggestion(NamedTuple):
    category: str
    confidence: Optional[float]
    source: str  # "memory" or "laya"


@router.get("/classifier-status", response_model=ClassifierStatusOut)
async def classifier_status() -> ClassifierStatusOut:
    return ClassifierStatusOut(ready=await categorizer.is_ready())


@router.post("/preview", response_model=SplitwisePreviewOut)
async def preview(body: SplitwisePreviewIn) -> SplitwisePreviewOut:
    try:
        parsed = parse_splitwise_csv(body.csv, body.member_name, today_iso(settings.timezone))
    except SplitwiseCsvError as exc:
        raise bad_request(str(exc)) from exc

    # The user only imports after settling up. Checked before the member step
    # and before any DB or Laya call, so an unsettled file costs nothing.
    if not parsed.settled:
        raise bad_request(unsettled_message(parsed.unsettled))

    if len(parsed.rows) > SPLITWISE_MAX_ROWS:
        raise bad_request(
            f"The export has {len(parsed.rows)} expenses; import at most {SPLITWISE_MAX_ROWS} at a time"
        )

    async with acquire() as conn:
        imported = await already_imported(conn, [r.fingerprint for r in parsed.rows])
        # Laya scores against each category's description (docs/categories.md).
        choices = [
            {"name": c["name"], "description": c["description"]} for c in await list_categories(conn) if c["spendable"]
        ]
        fresh = [r for r in parsed.rows if r.fingerprint not in imported]
        keys = {r.fingerprint: memory_key(r.description) for r in fresh}
        remembered = await recall_categories(conn, sorted({k for k in keys.values() if k}))

    names = {c["name"] for c in choices}
    suggestions: dict[str, Suggestion] = {}
    # Rows Laya must see, grouped so each distinct description is asked once.
    # A row with an empty key can't be grouped, so it stands alone.
    ask: dict[str, list] = {}
    for r in fresh:
        category = remembered.get(keys[r.fingerprint])
        if category in names:  # only while it can still be picked
            suggestions[r.fingerprint] = Suggestion(category, None, "memory")
        else:
            ask.setdefault(keys[r.fingerprint] or r.fingerprint, []).append(r)

    classifier = "not_run"
    if ask and choices:
        try:
            results = await categorizer.classify([group[0].description for group in ask.values()], choices)
            for group, p in zip(ask.values(), results):
                for r in group:
                    suggestions[r.fingerprint] = Suggestion(p.category, p.confidence, "laya")
            classifier = "ok"
        except categorizer.CategorizerUnavailable as exc:
            logger.warning("Laya categorizer unavailable: %s", exc)
            classifier = "unavailable"

    return SplitwisePreviewOut(
        members=parsed.members,
        member_name=parsed.member_name,
        rows=[
            SplitwisePreviewRowOut(
                fingerprint=r.fingerprint,
                date=r.date,
                description=r.description,
                amount=r.amount,
                category=s.category if s else None,
                confidence=s.confidence if s else None,
                source=s.source if s else None,
                already_imported=r.fingerprint in imported,
            )
            for r in parsed.rows
            for s in [suggestions.get(r.fingerprint)]
        ],
        skipped=[SplitwiseSkippedOut(line=s.line, description=s.description, reason=s.reason) for s in parsed.skipped],
        settlements=[
            SplitwiseSettlementOut(line=s.line, date=s.date, description=s.description, amount=s.amount)
            for s in parsed.settlements
        ],
        classifier=classifier,
    )


@router.post("/import", status_code=status.HTTP_201_CREATED, response_model=SplitwiseImportOut)
async def import_expenses(body: SplitwiseImportIn) -> JSONResponse:
    async with db_transaction() as conn:
        result = await import_rows(conn, settings.timezone, body.account_id, body.rows)

    out = SplitwiseImportOut(
        imported=result["imported"],
        skipped_duplicates=result["skipped_duplicates"],
        account=AccountOut(**result["account"]),
    )
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=out.model_dump(by_alias=True))
```

In `api/app/main.py`, add `splitwise` to the routes import (keep alphabetical) and register it after `payday`:

```python
from .routes import accounts, categories, config, credits, health, payday, reconcile, salary, splitwise, transactions, transfers
```

```python
app.include_router(splitwise.router, prefix="/api/splitwise", dependencies=[require_auth])
```

- [ ] **Step 7: Run all backend tests**

Run: `cd api && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/financedb_test .venv/bin/python -m pytest -v`
Expected: all pass (54 passed). Also run once without `TEST_DATABASE_URL`: route tests show as skipped, others pass.

If `test_preview_categorizes_every_row` fails on camelCase keys, confirm FastAPI serializes `response_model` by alias (it does by default); do not switch to snake_case on the wire.

- [ ] **Step 8: Manual check against the real Space**

Put `LAYA_SPACE_URL` and `LAYA_HF_TOKEN` in `api/.env`, start the API (`cd api && .venv/bin/uvicorn app.main:app --port 3001`), get a session token from the app (browser devtools → Supabase session `access_token`), then:

```bash
curl -s -X POST localhost:3001/api/splitwise/preview \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  --data "$(jq -Rs '{csv: ., memberName: "<your Splitwise name>"}' < /path/to/real_export.csv)" | jq '.classifier, .rows[:5]'
```
Expected: `"ok"` and sensible categories. Report the categories for the first rows to the user as an early accuracy signal.

- [ ] **Step 9: Commit**

```bash
git add migrations/004_splitwise_imports.sql supabase/init.sql api/app/schemas.py api/app/services/splitwise_import.py api/app/routes/splitwise.py api/app/main.py api/tests/test_splitwise_routes.py
git commit -m "feat(api): Splitwise preview and import endpoints with dedup and category memory"
```

---

### Task 6: App — file picking, API client, import modal, dashboard button

**Files:**
- Create: `app/src/splitwiseFile.ts`, `app/src/components/modals/ImportSplitwiseModal.tsx`
- Modify: `app/src/api.ts`, `app/src/components/Overlay.tsx`, `app/src/screens/Dashboard.tsx`, `app/package.json` + lock (via `npx expo install`)

**Interfaces:**
- Consumes: the three HTTP endpoints from Task 5.
- Produces: `pickCsvText(): Promise<{ name: string; text: string } | null>`; `ImportSplitwiseModal` props `{ accounts: Account[]; catalog: Catalog; onClose(): void; onImport(input: SplitwiseImportInput): Promise<SplitwiseImportResult> }`; `Overlay` optional prop `wide?: boolean`.

There is no frontend test runner in this project. Verification is the TypeScript check plus the manual checklist in Step 7.

- [ ] **Step 1: Install the Expo modules**

Read https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/ and https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/ first. Then:

```bash
cd app && npx expo install expo-document-picker expo-file-system
```
Expected: both added to `app/package.json` with SDK-57-compatible versions.

- [ ] **Step 2: Add the file helper**

`app/src/splitwiseFile.ts` (if the v57 docs show a different file-reading API than `new File(uri).text()`, use the documented one):

```ts
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Lets the user pick a Splitwise CSV export and returns its text. Web gets a
 * browser File object straight from the picker; native reads the copy the
 * picker places in the app's cache directory.
 */
export async function pickCsvText(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const text = Platform.OS === 'web' && asset.file ? await asset.file.text() : await new File(asset.uri).text();
  return { name: asset.name, text };
}
```

- [ ] **Step 3: Extend the API client**

In `app/src/api.ts`, add after the `Payday` interface:

```ts
export interface SplitwisePreviewRow {
  fingerprint: string;
  date: string;
  description: string;
  /** The user's share of the expense, which is what gets recorded. */
  amount: number;
  /** The suggested category; null when Laya couldn't be reached and nothing was remembered. */
  category: string | null;
  /** Laya's confidence; null for remembered rows. */
  confidence: number | null;
  /** "memory": the category the user confirmed for this description before. */
  source: 'memory' | 'laya' | null;
  alreadyImported: boolean;
}

export interface SplitwiseSkipped {
  line: number;
  description: string;
  reason: string;
}

export interface SplitwisePreview {
  members: string[];
  /** Null when the member column still needs choosing. */
  memberName: string | null;
  rows: SplitwisePreviewRow[];
  skipped: SplitwiseSkipped[];
  /** "X paid Y" rows. Not expenses; shown so the user can see the settle-up. */
  settlements: { line: number; date: string; description: string; amount: number }[];
  classifier: 'ok' | 'unavailable' | 'not_run';
}

export interface SplitwiseImportInput {
  accountId: string;
  rows: { fingerprint: string; date: string; description: string; amount: number; category: string }[];
}

export interface SplitwiseImportResult {
  imported: number;
  skippedDuplicates: number;
  account: Account;
}
```

Add to the `api` object, after `deleteCategory`:

```ts
  splitwiseClassifierStatus: () => request<{ ready: boolean }>('/splitwise/classifier-status'),

  splitwisePreview: (body: { csv: string; memberName: string | null }) =>
    request<SplitwisePreview>('/splitwise/preview', {
      method: 'POST',
      body: json(body),
    }),

  splitwiseImport: (body: SplitwiseImportInput) =>
    request<SplitwiseImportResult>('/splitwise/import', {
      method: 'POST',
      body: json(body),
    }),
```

- [ ] **Step 4: Give Overlay an optional wide layout**

Replace the inner `Pressable` line in `app/src/components/Overlay.tsx` and the signature:

```tsx
export function Overlay({ children, onClose, wide = false }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
```

```tsx
        <Pressable className={wide ? 'w-full max-w-2xl rounded-2xl bg-white p-6' : 'w-full max-w-md rounded-2xl bg-white p-6'} onPress={() => {}}>
```

Existing modals don't pass `wide`, so they render exactly as before.

- [ ] **Step 5: Write the import modal**

`app/src/components/modals/ImportSplitwiseModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  api,
  type Account,
  type SplitwiseImportInput,
  type SplitwiseImportResult,
  type SplitwisePreview,
  type SplitwisePreviewRow,
  type SplitwiseSkipped,
} from '../../api';
import type { Catalog } from '../../utils';
import { fmt, fmtDate, shortName } from '../../utils';
import { pickCsvText } from '../../splitwiseFile';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';
import { Select } from '../Select';

const MEMBER_KEY = 'splitwise.memberName';
const LOW_CONFIDENCE = 0.5;

type Step = 'pick' | 'member' | 'review' | 'done';

interface ReviewRow extends SplitwisePreviewRow {
  include: boolean;
  chosen: string | null;
}

interface ImportSplitwiseModalProps {
  accounts: Account[];
  catalog: Catalog;
  onClose: () => void;
  onImport: (input: SplitwiseImportInput) => Promise<SplitwiseImportResult>;
}

export function ImportSplitwiseModal({ accounts, catalog, onClose, onImport }: ImportSplitwiseModalProps) {
  const banks = accounts.filter(a => a.kind === 'bank');
  const cards = accounts.filter(a => a.kind === 'credit_card');
  const defaultAccount = accounts.find(a => a.role === 'primary') ?? accounts[0];

  const [step, setStep] = useState<Step>('pick');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [memberName, setMemberName] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [alreadyCount, setAlreadyCount] = useState(0);
  const [skipped, setSkipped] = useState<SplitwiseSkipped[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [settlements, setSettlements] = useState<SplitwisePreview['settlements']>([]);
  const [classifier, setClassifier] = useState<'ok' | 'unavailable' | 'not_run'>('not_run');
  const [accountId, setAccountId] = useState(defaultAccount?.id ?? '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SplitwiseImportResult | null>(null);

  // Wakes the Hugging Face Space while the user is still finding the file,
  // so the categorizer is more likely to be up by the time preview runs.
  useEffect(() => {
    api.splitwiseClassifierStatus().catch(() => {});
  }, []);

  async function runPreview(text: string, member: string | null) {
    setBusy('Reading and categorizing… the first run of the day can take a minute');
    setError('');
    try {
      const preview = await api.splitwisePreview({ csv: text, memberName: member });
      setMembers(preview.members);
      if (!preview.memberName) {
        setMemberName(preview.members[0] ?? null);
        setStep('member');
        return;
      }
      await AsyncStorage.setItem(MEMBER_KEY, preview.memberName);
      setRows(
        preview.rows.filter(r => !r.alreadyImported).map(r => ({ ...r, include: true, chosen: r.category })),
      );
      setAlreadyCount(preview.rows.filter(r => r.alreadyImported).length);
      setSkipped(preview.skipped);
      setSettlements(preview.settlements);
      setClassifier(preview.classifier);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file');
    } finally {
      setBusy('');
    }
  }

  async function pickFile() {
    setError('');
    try {
      const picked = await pickCsvText();
      if (!picked) return;
      setCsv(picked.text);
      setFileName(picked.name);
      await runPreview(picked.text, await AsyncStorage.getItem(MEMBER_KEY));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the file');
    }
  }

  function update(fingerprint: string, patch: Partial<ReviewRow>) {
    setRows(current => current.map(r => (r.fingerprint === fingerprint ? { ...r, ...patch } : r)));
  }

  const included = rows.filter(r => r.include);
  const missing = included.filter(r => !r.chosen).length;
  const total = included.reduce((sum, r) => sum + r.amount, 0);

  async function submit() {
    if (included.length === 0) {
      setError('Tick at least one expense to import');
      return;
    }
    if (missing > 0) {
      setError(`Pick a category for ${missing} expense${missing === 1 ? '' : 's'}`);
      return;
    }
    setBusy('Importing…');
    setError('');
    try {
      const res = await onImport({
        accountId,
        rows: included.map(r => ({
          fingerprint: r.fingerprint,
          date: r.date,
          description: r.description,
          amount: r.amount,
          category: r.chosen as string,
        })),
      });
      setResult(res);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import the expenses');
    } finally {
      setBusy('');
    }
  }

  const categoryOptions = catalog.spendable.map(c => ({ label: c.name, value: c.name }));

  return (
    <Overlay onClose={onClose} wide={step === 'review'}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-ink">Import from Splitwise</Text>
          <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        {step === 'pick' && (
          <View className="gap-3">
            <Text className="text-sm text-ink-secondary">
              In Splitwise, open a group or friend and choose Export as spreadsheet. Pick that CSV here. Your share of each
              expense is recorded on the date it happened, and categories are suggested for you to review.
            </Text>
            <Pressable onPress={pickFile} disabled={!!busy} className="rounded-xl bg-accent py-3" style={{ opacity: busy ? 0.5 : 1 }}>
              <Text className="text-center text-sm font-semibold text-white">{busy ? 'Working…' : 'Choose CSV file'}</Text>
            </Pressable>
          </View>
        )}

        {step === 'member' && (
          <View className="gap-3">
            <Text className="text-sm text-ink-secondary">Which person in {fileName || 'this export'} is you?</Text>
            <Select
              value={memberName ?? ''}
              onChange={setMemberName}
              options={members.map(m => ({ label: m, value: m }))}
            />
            <Pressable
              onPress={() => runPreview(csv, memberName)}
              disabled={!memberName || !!busy}
              className="rounded-xl bg-accent py-3"
              style={{ opacity: !memberName || busy ? 0.5 : 1 }}
            >
              <Text className="text-center text-sm font-semibold text-white">{busy ? 'Working…' : 'Continue'}</Text>
            </Pressable>
          </View>
        )}

        {step === 'review' && (
          <View className="gap-4">
            {classifier === 'unavailable' && (
              <View className="flex-row items-center justify-between gap-3 rounded-xl border border-[#ff9f0a]/40 bg-[#ff9f0a]/[0.08] px-4 py-3">
                <Text className="flex-1 text-xs text-ink-secondary">
                  The categorizer didn't respond. Pick categories yourself, or try again in a minute.
                </Text>
                <Pressable onPress={() => runPreview(csv, memberName)} disabled={!!busy}>
                  <Text className="text-xs font-semibold text-accent">{busy ? 'Retrying…' : 'Retry'}</Text>
                </Pressable>
              </View>
            )}

            <Text className="text-xs text-muted">
              {rows.length} new expense{rows.length === 1 ? '' : 's'}
              {alreadyCount > 0 ? ` · ${alreadyCount} already imported` : ''}
              {skipped.length > 0 ? ` · ${skipped.length} skipped` : ''}
            </Text>
            {settlements.length > 0 && (
              <Text className="text-xs text-muted">
                Settled up: {settlements.map(t => `${t.description} ${fmt(t.amount)} on ${fmtDate(t.date)}`).join(' · ')}
              </Text>
            )}

            {rows.length === 0 ? (
              <Text className="text-sm text-ink-secondary">Nothing new to import from this file.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {rows.map(r => {
                  const suggested = r.chosen !== null && r.chosen === r.category;
                  const low = suggested && r.source === 'laya' && (r.confidence ?? 1) < LOW_CONFIDENCE;
                  const remembered = suggested && r.source === 'memory';
                  return (
                    <View key={r.fingerprint} className="flex-row items-center gap-3 border-b border-surface py-2">
                      <Pressable
                        onPress={() => update(r.fingerprint, { include: !r.include })}
                        className="h-5 w-5 items-center justify-center rounded border border-border"
                        style={{ backgroundColor: r.include ? '#5b5cf6' : 'transparent' }}
                      >
                        {r.include && <Text className="text-[10px] text-white">✓</Text>}
                      </Pressable>
                      <View className="flex-[2]" style={{ opacity: r.include ? 1 : 0.4 }}>
                        <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                          {r.description}
                        </Text>
                        <Text className="font-mono text-xs text-muted">
                          {fmtDate(r.date)} · {fmt(r.amount)}
                        </Text>
                      </View>
                      <View className="flex-[1.4] gap-0.5">
                        <Select
                          value={r.chosen ?? ''}
                          onChange={value => update(r.fingerprint, { chosen: value || null })}
                          options={[...(r.chosen ? [] : [{ label: 'Pick a category', value: '' }]), ...categoryOptions]}
                        />
                        {low && <Text className="text-[10px] font-medium text-[#ff9f0a]">Check this one</Text>}
                        {remembered && <Text className="text-[10px] text-muted">Remembered</Text>}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {skipped.length > 0 && (
              <View className="gap-1">
                <Pressable onPress={() => setShowSkipped(v => !v)}>
                  <Text className="text-xs font-medium text-accent">
                    {showSkipped ? 'Hide' : 'Show'} {skipped.length} skipped row{skipped.length === 1 ? '' : 's'}
                  </Text>
                </Pressable>
                {showSkipped &&
                  skipped.map(s => (
                    <Text key={s.line} className="text-xs text-muted">
                      Line {s.line}: {s.description}. {s.reason}.
                    </Text>
                  ))}
              </View>
            )}

            {rows.length > 0 && (
              <View className="gap-1">
                <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Record against</Text>
                <Select
                  value={accountId}
                  onChange={setAccountId}
                  groups={[
                    ...(banks.length > 0 ? [{ label: 'Accounts', options: banks.map(a => ({ label: shortName(a.name), value: a.id })) }] : []),
                    ...(cards.length > 0 ? [{ label: 'Credit Cards', options: cards.map(a => ({ label: a.name, value: a.id })) }] : []),
                  ]}
                />
              </View>
            )}

            {rows.length > 0 && (
              <Pressable onPress={submit} disabled={!!busy} className="rounded-xl bg-accent py-3" style={{ opacity: busy ? 0.5 : 1 }}>
                <Text className="text-center text-sm font-semibold text-white">
                  {busy ? 'Importing…' : `Import ${included.length} expense${included.length === 1 ? '' : 's'} · ${fmt(total)}`}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {step === 'done' && result && (
          <View className="gap-3">
            <Text className="text-sm text-ink">
              Imported {result.imported} expense{result.imported === 1 ? '' : 's'}.
              {result.skippedDuplicates > 0 ? ` ${result.skippedDuplicates} were already in your ledger.` : ''}
            </Text>
            <Pressable onPress={onClose} className="rounded-xl bg-accent py-3">
              <Text className="text-center text-sm font-semibold text-white">Done</Text>
            </Pressable>
          </View>
        )}

        {busy && (step === 'pick' || step === 'member') && <Text className="text-xs text-muted">{busy}</Text>}
        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}
      </View>
    </Overlay>
  );
}
```

- [ ] **Step 6: Wire it into the dashboard**

In `app/src/screens/Dashboard.tsx`:

1. Add the import next to the other modals:
   ```tsx
   import { ImportSplitwiseModal } from '../components/modals/ImportSplitwiseModal';
   ```
2. Add state next to `showAddCredit`:
   ```tsx
   const [showSplitwise, setShowSplitwise] = useState(false);
   ```
3. Add a button immediately before the Add Credit button in the header button row:
   ```tsx
   <Pressable
     onPress={() => setShowSplitwise(true)}
     disabled={accounts.length === 0 || catalog.spendable.length === 0}
     className="rounded-xl border border-border px-3 py-2"
     style={{ opacity: accounts.length === 0 || catalog.spendable.length === 0 ? 0.4 : 1 }}
   >
     <Text className="text-xs font-medium text-ink-secondary">Import Splitwise</Text>
   </Pressable>
   ```
4. Render the modal after the `AddCreditModal` block:
   ```tsx
   {showSplitwise && accounts.length > 0 && catalog.spendable.length > 0 && (
     <ImportSplitwiseModal
       accounts={accounts}
       catalog={catalog}
       onClose={() => setShowSplitwise(false)}
       onImport={async input => {
         const result = await api.splitwiseImport(input);
         await refresh();
         return result;
       }}
     />
   )}
   ```

- [ ] **Step 7: Type-check and verify by hand**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

Then with the API from Task 5 Step 8 running and `EXPO_PUBLIC_API_URL=http://localhost:3001 npx expo start --web`, check each:
1. Add Expense, Add Credit, Add Salary, Transfer, Reconcile, Manage Categories still open at their usual width and still save.
2. Import Splitwise → Choose CSV → member prompt appears the first time → review list shows only your-share amounts and Laya's categories.
3. Change a category, untick a row, pick an account, import → dashboard shows the rows in the right months and the account balance drops by the shown total.
4. Import the same file again → "Nothing new to import", with the already-imported count.
4a. Upload a later export that repeats a description you corrected in step 3 → that row shows your corrected category with a "Remembered" tag and no "Check this one".
5. Stop the Space (or set a wrong `LAYA_SPACE_URL`) → banner with Retry, categories empty, import blocked until each ticked row has one.
6. A non-Splitwise CSV → readable error, modal stays usable.
7. On an Android dev build (`npx expo run:android` or the existing EAS dev profile), repeat step 2 to confirm native file reading.

- [ ] **Step 8: Commit**

```bash
git add app/src/splitwiseFile.ts app/src/components/modals/ImportSplitwiseModal.tsx app/src/api.ts app/src/components/Overlay.tsx app/src/screens/Dashboard.tsx app/package.json app/package-lock.json
git commit -m "feat(app): import Splitwise CSV with Laya-suggested categories"
```

---

### Task 7: Deploy

**Files:** none in the repo beyond what earlier tasks committed.

- [ ] **Step 1: Apply the migration to Supabase**

Paste `migrations/004_splitwise_imports.sql` into the Supabase SQL editor and run it. Verify: `SELECT count(*) FROM splitwise_imports;` returns `0`, and `SELECT name, description FROM categories LIMIT 1;` runs. Then fill in each category's description in the app (Manage categories → edit), using `docs/categories.md`.

- [ ] **Step 2: Set Vercel environment variables (DEFERRED until Laya hosting is decided, see Task 1 Step 7)**

Skip while hosting is undecided. Without these, the import works and the user picks categories by hand.

In the Vercel project → Settings → Environment Variables (Production and Preview): `LAYA_SPACE_URL=https://<hf-username>-laya-categorizer.hf.space` and `LAYA_HF_TOKEN=<fine-grained token>`.

- [ ] **Step 3: Deploy and smoke-test**

Push/deploy as the project normally does. Then: `curl -s https://<app-domain>/api/health` returns `{"status":"ok"}`; in the deployed app, run Task 6 Step 7 checks 2–4 with a real export.

- [ ] **Step 4: Update docs**

Add a short "Splitwise import" entry to `KNOWN_ISSUES.md` under a new heading describing the known limitation from the Design Decisions section (per-account drift; don't also add Splitwise expenses by hand). Commit:

```bash
git add KNOWN_ISSUES.md
git commit -m "docs: note Splitwise import limitations"
```
