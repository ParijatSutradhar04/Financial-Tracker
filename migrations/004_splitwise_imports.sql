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
