-- 006_credit_limit.sql
--
-- Brings an already-initialised database in line with the updated init.sql.
-- Apply locally with:
--
--   docker exec -i finance-db psql -U postgres -d financedb \
--     < migrations/006_credit_limit.sql
--
-- and on Supabase by pasting it into the SQL editor (or psql against the
-- direct connection, port 5432). Safe to run more than once.
--
-- Apply BEFORE deploying the API that ships with it: every read of an
-- account selects credit_limit, so without the column the dashboard fails to
-- load. The column is additive and nullable, so the API deployed before it
-- is unaffected.

BEGIN;

-- What the bank lets a credit card owe, entered when the card is added. Null
-- for bank accounts and for cards added without one; the API only accepts it
-- on a credit card.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2) CHECK (credit_limit > 0);

COMMIT;
