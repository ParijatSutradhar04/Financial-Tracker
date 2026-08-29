# Multi-user support — design

Status: approved, not yet planned/implemented. See `KNOWN_ISSUES.md` for the
roadmap pointer.

## Context

The app is single-user today: the DB schema has no `user_id` anywhere,
categories live in a static file bundled with the deployment
(`api/config/finance.config.json`), and there is no registration flow —
`LoginScreen.tsx` is sign-in only, and accounts/cards are created once via
`scripts/provision.py` reading that static file.

Target: support **fewer than 10 users**, all people the owner knows
personally. This is explicitly not a scale problem — no new infrastructure,
no connection-pool sizing work, no read replicas. It's a data-modeling and
UI problem: each user needs their own accounts, cards, categories, and
ledger, isolated from everyone else's.

Decisions made before this design (see conversation, not re-litigated here):
- **Existing production data is preserved.** The current single set of
  accounts/transactions gets backfilled to belong to the owner's existing
  Supabase Auth user, rather than wiped.
- **Signup is open.** Anyone with the app URL can sign up via a normal
  email/password Sign Up screen — no invite system. Acceptable because each
  user only ever sees their own data once this design ships.
- **New users get pre-filled default categories** (the current starter set:
  Grocery, Rent, Electricity, Gym, Food, Outing, Local Travel, Travel,
  Others), editable/deletable from there, rather than starting from zero.
- **Isolation is enforced in application code (`WHERE user_id = ...`), not
  Postgres RLS**, for now. RLS is documented as a future migration path
  (Section 7) in case the user count or trust model changes later.

## 1. Schema changes

### `accounts`

Add two columns:

```sql
ALTER TABLE accounts ADD COLUMN user_id UUID REFERENCES auth.users(id);
ALTER TABLE accounts ADD COLUMN role VARCHAR(10) CHECK (role IN ('primary', 'salary'));
```

- `role` is new as a **stored column**. Today it doesn't exist in the DB at
  all — `role_for_account_name()` in `api/app/finance_config.py` derives it
  by matching an account's *name* against the static config at import time.
  With no more shared config file, each user sets their own account's role
  during onboarding, so it has to be a real column.
- `accounts.name` currently has a **global** `UNIQUE` constraint
  (`init.sql`/`supabase/init.sql`). That breaks the moment a second user
  also wants an account named "Primary Account". Migration drops the global
  unique constraint and adds `UNIQUE(user_id, name)` instead.
- After backfilling `user_id` on existing rows (Section 4), both columns
  become `NOT NULL` — every account belongs to exactly one user, and every
  account either has no role or a role unique to that user (enforced by a
  partial unique index, see below).

```sql
CREATE UNIQUE INDEX idx_accounts_user_role
  ON accounts(user_id, role) WHERE role IS NOT NULL;
```

This keeps today's invariant ("only one account may hold a given role") but
scoped per user instead of globally, matching what
`FinanceConfig._check_uniqueness_and_roles` currently validates at
config-load time.

### `categories` (new table)

```sql
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    name VARCHAR(50) NOT NULL,
    icon VARCHAR(10) NOT NULL,
    color VARCHAR(7) NOT NULL,
    spendable BOOLEAN NOT NULL DEFAULT true,
    hidden BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp(),
    UNIQUE (user_id, name)
);
```

Replaces the `categories` array in `finance.config.json` as the runtime
source of truth. The JSON file's category list becomes only a **seed
template** copied into this table for a new user at signup — it stops being
read per-request.

### `transactions`

No new column. A transaction is scoped transitively through
`account_id → accounts.user_id`, so every query needs a join (or a
subquery) rather than a direct filter. `category` stays free-text, but its
*validity* check moves from a global list to "one of this user's
categories" (Section 2).

### Reserved categories (`Transfer` / `Adjustment` / `Salary`)

Unchanged — `api/app/domain.py`'s `RESERVED_CATEGORIES` and
`RESERVED_CATEGORY_STYLES` stay global constants, not per-user rows. They're
written by the backend itself (transfers, reconciliation, salary credits),
never chosen by a user in the Add Expense picker, so they don't belong in
the new per-user `categories` table.

## 2. Backend changes

### Threading `user_id` through every route

`api/app/auth.py`'s `get_current_user()` already decodes the JWT and
returns the full payload, which includes the Supabase user id as `sub` —
today nothing downstream uses it. Every route handler adds
`user: dict = Depends(require_auth)` (most already effectively require
auth; this just captures the payload) and passes `user["sub"]` into the
service call. Every service function gains a `user_id` parameter and every
query gains a filter:

- `services/balances.py`: `lock_accounts`, `sync_balance`, `pending_balance`
  — add `AND user_id = $N` to the `accounts` queries.
- `services/transactions.py`: `list_transactions`,
  `transactions_created_since` — join `accounts` and filter on
  `a.user_id = $N`; `insert_transaction` doesn't need a new column (it
  writes through an `account_id` already owned by the caller — ownership is
  checked when that account was locked/loaded, not re-checked on insert).
- Routes (`accounts.py`, `transactions.py`, `transfers.py`, `salary.py`,
  `reconcile.py`, `payday.py`, `config.py`): pass `user["sub"]` down; no
  route currently does its own SQL, so this is a one-line addition per
  handler, not new logic.

This is mechanical and touches most files under `api/app/routes` and
`api/app/services`, but each change is the same small shape repeated, not a
redesign.

### Category validation moves from declarative to per-request

`api/app/schemas.py`'s `_validate_category` currently checks against a
module-level `spend_category_names` list, imported once at process start
from the static file (`finance_config.py`). That stops being possible once
category lists are per-user and DB-backed: a Pydantic `field_validator` runs
at model-construction time with no request context, so it can't know which
user is asking. The check moves out of the schema and into the route
handler — after decoding the authenticated user, fetch their categories,
then validate `category` against that set before calling into
`services/transactions.py`.

### New endpoints

- `POST /api/accounts` — create one account (`name`, `kind`, `role?`,
  `openingBalance`), scoped to the caller.
- `POST /api/categories`, `PATCH /api/categories/{id}`,
  `DELETE /api/categories/{id}` — full CRUD, scoped to the caller. Delete is
  a hard delete only if no transaction references the category name for
  that user (mirroring "nothing about a category is ever silently
  destructive"); otherwise reject with a clear error — categories aren't
  foreign-keyed from `transactions.category` today (it's free text), so
  this is an application-level check, not a DB constraint.
- `POST /api/onboarding` — the one-shot call the registration screen
  submits: a list of bank accounts (with optional role), a list of credit
  cards (with outstanding balance, stored as `openingBalance = -outstanding`
  to match the existing signed-balance convention where a card's owed
  amount is `-balance`), and the (possibly edited) starter category list.
  Internally, this calls the same insert logic as the individual endpoints
  inside one DB transaction, so onboarding either fully succeeds or fully
  rolls back.

### `scripts/provision.py`

Stops being part of the real user flow — account creation now happens
through onboarding, per-user, via the API. It can remain as a local dev
convenience (seed a throwaway account fast while iterating), but is no
longer wired into any deploy or startup path for real users.

## 3. Frontend changes

### Sign up

`LoginScreen.tsx` gets a Sign Up mode (tab or toggle) calling
`supabase.auth.signUp({ email, password })` — already available in the
installed `@supabase/supabase-js`, currently unused since the screen was
deliberately sign-in-only for the single-user design.

### Onboarding (new)

Shown once, right after a brand-new signup, before the Dashboard is
reachable — the app checks "does this user have zero accounts?" on login
and routes to onboarding instead of the Dashboard if so. Three steps:

1. **Bank accounts** — name + opening balance; optionally flag one as the
   salary-receiving account and one as the transfer-target ("primary")
   account, mirroring today's config-driven roles.
2. **Credit cards** — name + current outstanding balance.
3. **Categories** — pre-filled with the default starter set from
   `finance.config.json`, shown as an editable list (rename, recolor,
   delete, add) before continuing.

Submitting calls the new `POST /api/onboarding` once with everything
collected. On success, route to the Dashboard, which needs no changes — it
already reads accounts/categories as API data, not hardcoded values.

### Category management (new, ongoing)

A settings screen for editing categories after onboarding, using
`POST/PATCH/DELETE /api/categories`. Not required for launch if you want to
ship onboarding first and add this after, but included in scope since you
asked for "option to add, change, or delete categories."

### `api.ts`

New client methods: `addAccount`, `addCategory`, `updateCategory`,
`deleteCategory`, `submitOnboarding`. `AppConfig`'s `categories` stop being
static config data and become regular fetched/mutable data, same shape as
`Account`/`Transaction` already are.

### What does not change

Dashboard rendering, the four existing modals (Add Expense/Salary,
Transfer, Reconcile), `SparkbarChart`, month navigation, and category
totals — all already treat accounts/categories as API data, not hardcoded.
Once the API scopes that data per user, the Dashboard works for any user
with no changes.

## 4. Migration & rollout plan

One-time, ordered steps against the live Supabase DB:

1. `ALTER TABLE accounts ADD COLUMN user_id UUID REFERENCES auth.users(id);`
   (nullable for now).
2. `ALTER TABLE accounts ADD COLUMN role VARCHAR(10) CHECK (role IN ('primary', 'salary'));`
3. Backfill: `UPDATE accounts SET user_id = '<owner's auth.users id>';` —
   every existing row becomes owned by the current single user.
4. Backfill `role` from the current `finance.config.json`'s
   `primary`/`salary` account names (a short one-off script, or by hand
   since there are only 3 accounts today).
5. `ALTER TABLE accounts ALTER COLUMN user_id SET NOT NULL;`
6. Drop the old global unique constraint on `accounts.name`; add
   `UNIQUE(user_id, name)` and the partial `idx_accounts_user_role` index
   from Section 1.
7. Create the `categories` table; seed it with the owner's current
   `finance.config.json` categories, owned by the same `user_id`.
8. Deploy the backend changes (Section 2) and frontend changes (Section 3)
   together — the old code paths (global category list, config-driven
   provisioning) are removed in the same release, not kept as a fallback,
   since there's no reason to support both models at once for one
   deployment.

No downtime requirement given the traffic level (one person's app during
this migration); still, run it as a single transaction where possible so a
failure midway doesn't leave `accounts` half-migrated.

## 5. Testing

- Migration: run against a copy of the production data (or Supabase's
  branching/preview DB if available) before running on the real project;
  confirm row counts and spot-check balances match pre-migration values
  post-backfill.
- Backend: for each route, verify a second test user cannot read or write
  the first user's accounts/transactions/categories (403/404, not silently
  empty results that could mask a missing filter).
- Onboarding: fresh signup → onboarding → Dashboard shows exactly the
  accounts/cards/categories entered, with correct signed balances (credit
  card outstanding entered as positive, stored/displayed correctly negative
  per the existing convention).
- Regression: existing single-user flows (add expense, transfer, salary,
  reconcile) behave identically for the backfilled owner account after
  migration — this is the highest-risk area since it's real data.

## 6. Risks / open questions for implementation time

- **Category delete when in use.** Since `transactions.category` is free
  text with no FK, deleting a category a user has already spent under needs
  an explicit policy (block delete vs. allow and just stop offering it in
  Add Expense). Section 2 proposes blocking; confirm at implementation
  time.
- **Onboarding partial failure UX.** `POST /api/onboarding` is one DB
  transaction server-side, but the frontend still needs to handle "some of
  what I typed failed validation" gracefully across a 3-step form, not just
  as a single opaque error at the end.
- **Role uniqueness UX.** If a user doesn't mark any account as
  salary/primary during onboarding, Add Salary/Transfer need a sensible
  fallback (e.g., account picker instead of a fixed button target) rather
  than assuming a role always exists, since Section 1's constraint allows
  zero holders of a role, only forbids more than one.

## 7. Future path: Postgres RLS (not built now)

Documented in case the trust model or user count changes enough to want
defense-in-depth beyond application-level filtering.

**Why it's deferred now:** the backend talks to Postgres through one shared
Supavisor pooled connection (`api/app/db.py`) used for every user's
requests. RLS policies check `auth.uid()`, which Postgres resolves from a
per-session claim (`request.jwt.claims` / the `authenticated` role) — but
today's pool has no per-request identity attached to the Postgres session
at all; every query already runs as the same DB role regardless of which
end user made the request. Enabling RLS without changing that would either
do nothing (queries still run as a role that bypasses RLS) or break
everything (queries run as `authenticated` with no claims set, so every
policy denies).

**What it would take to adopt RLS later:**

1. Enable RLS on `accounts`, `transactions`, `categories`:
   ```sql
   ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
   CREATE POLICY accounts_owner ON accounts
     USING (user_id = auth.uid());
   -- transactions: policy via EXISTS against accounts owned by auth.uid()
   ```
2. Stop routing every request through one pooled service connection with
   no identity. Options, in increasing effort:
   - **Per-request `SET LOCAL`:** on each pooled connection checkout, run
     `SELECT set_config('request.jwt.claims', '<claims json>', true)`
     (scoped to the transaction) before the actual query, so
     `auth.uid()` resolves correctly for that request only. Lowest
     structural change — keeps the existing asyncpg pool — but adds one
     extra round trip per request and must be done correctly every time or
     RLS silently misapplies.
   - **PostgREST-style per-user connections:** switch the DB role used per
     request based on the caller's JWT (what Supabase's own PostgREST layer
     does), which is a bigger change to `db.py`'s connection model.
3. Once RLS is enforced at the DB layer, the application-level
   `WHERE user_id = ...` filters from Section 2 become redundant defense-in-
   depth rather than the only line of defense — they should stay, not be
   removed, since RLS failing open due to a misconfigured policy is a real
   failure mode and app-level filtering is cheap insurance against it.

**Trigger for revisiting this:** user count growing past what's
comfortable to reason about by hand, or wanting to expose direct
Supabase client access (e.g., PostgREST/`supabase-js` querying tables
directly from the app instead of through the FastAPI backend) — the latter
in particular is not safe *at all* without RLS, since it would remove the
one place ownership is currently checked.
