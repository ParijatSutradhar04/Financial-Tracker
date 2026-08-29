-- 003_categories.sql
--
-- Brings an already-initialised database in line with the updated init.sql.
-- Apply with:
--
--   docker exec -i finance-db psql -U postgres -d financedb \
--     < migrations/003_categories.sql
--
-- Categories move from the static finance.config.json list to a DB table, so
-- they can be added/edited/deleted from the app instead of a config edit +
-- redeploy. Seeding existing rows from the config file is a separate step
-- (api/scripts/provision.py), not part of this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    icon VARCHAR(10) NOT NULL,
    color VARCHAR(7) NOT NULL,
    spendable BOOLEAN NOT NULL DEFAULT true,
    hidden BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp()
);

COMMIT;
