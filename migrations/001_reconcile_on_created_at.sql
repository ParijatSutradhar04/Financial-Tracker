-- 001_reconcile_on_created_at.sql
--
-- Brings an already-initialised database in line with the updated init.sql.
-- The docker-entrypoint-initdb.d hook only runs against an empty volume, so
-- existing deployments need this applied by hand:
--
--   docker exec -i finance-db psql -U postgres -d financedb \
--     < migrations/001_reconcile_on_created_at.sql
--
-- Two changes, both about which transactions the reconciliation trigger folds
-- into last_reconciled_balance:
--
--   1. Sum on created_at rather than transaction_date. created_at is the insert
--      time, so a back-dated expense is still counted exactly once; keying off
--      the user-chosen transaction_date silently dropped it.
--   2. Use clock_timestamp() rather than NOW(). NOW() is transaction-start time,
--      so a request that began earlier but acquired the account row lock later
--      would rewind reconciled_at and cause the previous request's transactions
--      to be counted a second time.

BEGIN;

ALTER TABLE transactions ALTER COLUMN created_at    SET DEFAULT clock_timestamp();
ALTER TABLE accounts     ALTER COLUMN reconciled_at SET DEFAULT clock_timestamp();
ALTER TABLE accounts     ALTER COLUMN created_at    SET DEFAULT clock_timestamp();
ALTER TABLE accounts     ALTER COLUMN updated_at    SET DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION fn_auto_reconcile_account()
RETURNS TRIGGER AS $$
DECLARE
    v_current_balance NUMERIC(12, 2);
    v_diff NUMERIC(12, 2);
BEGIN
    IF NEW.last_reconciled_balance <> OLD.last_reconciled_balance THEN

        SELECT OLD.last_reconciled_balance + COALESCE(SUM(
            CASE
                WHEN type = 'credit' THEN amount
                WHEN type = 'debit' THEN -amount
                ELSE 0
            END
        ), 0)
        INTO v_current_balance
        FROM transactions
        WHERE account_id = OLD.id
          AND created_at > OLD.reconciled_at;

        v_diff := NEW.last_reconciled_balance - v_current_balance;

        IF v_diff <> 0 THEN
            INSERT INTO transactions (
                account_id,
                amount,
                type,
                category,
                description,
                transaction_date
            ) VALUES (
                NEW.id,
                ABS(v_diff),
                CASE WHEN v_diff > 0 THEN 'credit' ELSE 'debit' END,
                'Adjustment',
                'Manual balance override reconciliation',
                NOW()
            );
        END IF;

        NEW.reconciled_at := clock_timestamp();
        NEW.updated_at := clock_timestamp();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
