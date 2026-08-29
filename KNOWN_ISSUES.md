# Known issues (tracked for next release)

Running log of issues found after the Vercel/Supabase/Expo migration, with root
cause (once found) and a brief fix plan. Not fixed yet unless marked so.

---

## Roadmap: multi-user support

Full design doc:
[`docs/superpowers/specs/2026-08-29-multi-user-design.md`](docs/superpowers/specs/2026-08-29-multi-user-design.md).

Adds per-user accounts/categories (schema: `accounts.user_id`,
`accounts.role`, new `categories` table), a registration/onboarding flow
(enter initial bank accounts + opening balances, credit cards + outstanding
balances, and edit a starter category list), and category CRUD. Isolation
is enforced in application code (`WHERE user_id = ...`), not Postgres RLS,
since the target is under 10 known users — the design doc's Section 7
covers the RLS migration path if that changes later. Not yet planned into
implementation tasks.

---

## 1. Add Expense (and other write actions) take a few seconds to save

**Symptom:** tapping Save on Add Expense shows the "Saving…" spinner for a
few seconds before the modal closes. Likely affects Add Salary, Transfer,
and Reconcile equally, since they share the same shape of request.

**Status:** analyzed, not fixed.

**Root cause (primary suspect): Vercel ↔ Supabase region mismatch.**
- The Vercel deployment has no `regions`/`functions` region override in
  `vercel.json`, so the API function runs in Vercel's default region —
  confirmed from a deploy log: `Building in Washington, D.C., USA (East) –
  iad1`.
- `DATABASE_URL` (`api/.env` / Vercel env) points at
  `aws-0-ap-southeast-1.pooler.supabase.com` — Singapore.
- Every write request makes **3-4 sequential DB round trips inside one
  transaction** (see `api/app/routes/transactions.py:add_expense`):
  1. `lock_accounts` (`SELECT ... FOR UPDATE`)
  2. `insert_transaction` → `INSERT ...` then a follow-up `SELECT` to
     return the row (`api/app/services/transactions.py:insert_transaction`)
  3. `sync_balance` (`UPDATE ... RETURNING`)
- US-East↔Singapore round trip is roughly 400-500ms; 4 sequential round
  trips in one request alone accounts for ~1.5-2s.
- The frontend then calls `refresh()` right after
  (`app/src/screens/Dashboard.tsx:54`), which fires 4 more requests
  (`config`, `accounts`, `transactions`, `payday`) in parallel — each also
  pays the same cross-region latency once — adding roughly another
  0.5-1s, all still under the same disabled "Saving…" button
  (`app/src/components/modals/AddExpenseModal.tsx:45-54`).

**Contributing factor: cold starts.** A Python Vercel function importing
`fastapi`, `asyncpg`, `pyjwt[crypto]`, `pydantic`, plus building the
asyncpg pool (`api/app/db.py:get_pool`, lazy on first call after a cold
start) and fetching the Supabase JWKS on the first auth check
(`api/app/auth.py:_get_jwk_client`), all add latency only on a cold
invocation. For a single-user app with sparse traffic, most requests will
be cold. This likely explains why the delay is inconsistent ("a few
seconds" sometimes, presumably faster other times).

**Not the cause:** no N+1 queries, no missing indexes suspected (schema
unchanged from the original Postgres init.sql), no obviously redundant
work inside a single request — the request shape is minimal and correct,
it's just chatty over a long physical distance.

**Fix plan (next release):**
1. Colocate compute and DB: either pin the Vercel API function's region to
   `sin1` (Singapore) via `vercel.json` `functions`/`regions`, or move to a
   Supabase project region close to Vercel's default (`iad1`, e.g.
   `us-east-1`). Colocating is the highest-leverage fix — turns 4 sequential
   ~450ms round trips into 4 sequential ~a few ms round trips.
2. Reduce round trips per write: fold `insert_transaction`'s `INSERT` +
   follow-up `SELECT` into a single `INSERT ... RETURNING` joined to
   `accounts` (or just return the inserted columns we already have instead
   of re-querying).
3. Make `Dashboard.refresh()` cheaper after a write: the write's own
   response already returns the updated `account` (and `transaction`) —
   patch local state with that instead of re-fetching `config` + all
   `accounts` + all `transactions` + `payday` every time. Reserve the full
   `refresh()` for mount and app-foreground.
4. Optionally: keep the asyncpg pool warm via a low-frequency scheduled
   ping (Vercel Cron hitting `/api/health`), to reduce how often a request
   pays the cold-start cost. Lower priority than #1-3 since it doesn't fix
   the worst case, just makes it less frequent.

**Verification plan once fixed:** time `POST /api/transactions` alone
(server-side timestamp logging or `curl -w '%{time_total}'`) before and
after the region change; confirm it drops from ~1.5-2s to well under
200ms.
