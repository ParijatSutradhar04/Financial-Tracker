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

-- Supabase exposes the public schema through PostgREST to anyone holding the
-- (public) anon key. The API connects as postgres, which bypasses RLS,
-- so enabling it with no policies shuts PostgREST out without affecting the
-- app. See migrations/005_enable_rls.sql for the older tables.
ALTER TABLE splitwise_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_memory ENABLE ROW LEVEL SECURITY;

COMMIT;
