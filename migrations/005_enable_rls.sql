-- 005_enable_rls.sql
--
-- Brings an already-initialised database in line with the updated init.sql
-- (section 8). Apply locally with:
--
--   docker exec -i finance-db psql -U postgres -d financedb \
--     < migrations/005_enable_rls.sql
--
-- and on Supabase by pasting it into the SQL editor. Safe to run more than
-- once. (Applied to the live Supabase project by hand on 2026-11-01.)
--
-- Supabase exposes the public schema through PostgREST to anyone holding the
-- (public) anon key, and flags every table without row level security. The
-- API connects as postgres, which bypasses RLS, so enabling it with no
-- policies shuts PostgREST out without affecting the app.

BEGIN;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

COMMIT;
