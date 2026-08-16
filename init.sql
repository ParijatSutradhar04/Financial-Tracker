-- init.sql

-- 1. Accounts Table
-- Rows are created from server/config/finance.config.json, matched on name, so
-- adding an account or a card is a config edit rather than a schema change.
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    kind VARCHAR(20) NOT NULL DEFAULT 'bank' CHECK (kind IN ('bank', 'credit_card')),
    currency VARCHAR(3) DEFAULT 'INR',
    last_reconciled_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    reconciled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp()
);

-- 2. Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    type VARCHAR(10) NOT NULL CHECK (type IN ('debit', 'credit')),
    category VARCHAR(50) NOT NULL,
    description TEXT,
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_trans_delta ON transactions(account_id, transaction_date);

-- 3. Auto-Adjustment Trigger Function
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

DROP TRIGGER IF EXISTS trg_account_reconciliation ON accounts;
CREATE TRIGGER trg_account_reconciliation
BEFORE UPDATE OF last_reconciled_balance ON accounts
FOR EACH ROW
EXECUTE FUNCTION fn_auto_reconcile_account();

-- 4. Immutability Enforcement Function
CREATE OR REPLACE FUNCTION fn_prevent_transaction_modifications()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Transaction records are immutable. Only INSERT operations are permitted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_transactions ON transactions;
CREATE TRIGGER trg_immutable_transactions
BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_transaction_modifications();

-- 5. Accounts
-- Nothing is seeded here. The backend creates any account or credit card listed
-- in server/config/finance.config.json that does not exist yet, on startup and
-- via `pnpm sync-config`, using the opening balance given there.