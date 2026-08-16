-- 002_account_kind.sql
--
-- Brings an already-initialised database in line with the updated init.sql.
-- Apply with:
--
--   docker exec -i finance-db psql -U postgres -d financedb \
--     < migrations/002_account_kind.sql
--
-- Adds credit cards to the accounts table. A card is the same kind of ledger as
-- a bank account, just read from the other direction: charges are debits, so
-- last_reconciled_balance goes negative and the amount owed is its negation.
-- Reusing the table means the reconciliation trigger, the immutability trigger,
-- and the balance sync all apply to cards unchanged.
--
-- The unique constraint on name is what lets the config file match existing
-- rows, so adding an entry there creates it once rather than on every startup.

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'bank';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accounts_kind_check'
    ) THEN
        ALTER TABLE accounts
            ADD CONSTRAINT accounts_kind_check CHECK (kind IN ('bank', 'credit_card'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accounts_name_key'
    ) THEN
        ALTER TABLE accounts ADD CONSTRAINT accounts_name_key UNIQUE (name);
    END IF;
END
$$;

COMMIT;
