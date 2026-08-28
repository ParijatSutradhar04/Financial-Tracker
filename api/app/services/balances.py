"""Account balance reads/writes. Mirrors server/src/services/balances.ts."""

from __future__ import annotations

import asyncpg

from ..errors import not_found
from ..finance_config import role_for_account_name
from .dates import iso_z

# The columns every read of an account needs.
ACCOUNT_COLUMNS = "id, name, kind, currency, last_reconciled_balance, reconciled_at"


def to_account(row: asyncpg.Record) -> dict:
    balance = float(row["last_reconciled_balance"])
    name = row["name"]
    kind = row["kind"]
    return {
        "id": str(row["id"]),
        "name": name,
        "kind": kind,
        # Which fixed button acts on this account, from the config.
        "role": role_for_account_name(name),
        "currency": row["currency"],
        # Signed ledger balance. Negative on a card means that much is owed.
        "balance": balance,
        # A card is the same ledger read the other way round: charges are
        # debits, so the balance falls below zero and what is owed is its
        # negation. What is owed on a card, so the dashboard need not know the
        # sign convention.
        "outstanding": -balance if kind == "credit_card" else None,
        "reconciled_at": iso_z(row["reconciled_at"]),
    }


async def lock_accounts(conn: asyncpg.connection.Connection, ids: list[str]) -> dict[str, asyncpg.Record]:
    """Takes an exclusive lock on each account before any transaction is inserted.

    The reconciliation trigger derives the new balance from everything created
    since reconciled_at, so two concurrent writers must not interleave their
    insert and their sync. Ordering by id keeps a transfer, which locks two
    rows, from deadlocking against a transfer running the other way.

    Unlike node-pg, asyncpg decodes `timestamptz` natively into a
    microsecond-precision `datetime` (matching Postgres's own storage
    resolution exactly), so the row's `reconciled_at` can be fed straight back
    into a later query with no precision loss — no text round-trip needed.
    """
    rows = await conn.fetch(
        f"""SELECT {ACCOUNT_COLUMNS}
              FROM accounts
             WHERE id = ANY($1::uuid[])
             ORDER BY id
               FOR UPDATE""",
        ids,
    )

    by_id = {str(row["id"]): row for row in rows}
    for account_id in ids:
        if account_id not in by_id:
            raise not_found(f"Account {account_id} not found")
    return by_id


async def sync_balance(conn: asyncpg.connection.Connection, account_id: str) -> dict:
    """Folds every transaction created since the last sync into the stored balance.

    This is the same expression fn_auto_reconcile_account evaluates against
    the pre-update row, so the trigger sees a zero difference and writes no
    Adjustment row; it just advances reconciled_at past the rows we counted.
    """
    row = await conn.fetchrow(
        f"""UPDATE accounts a
               SET last_reconciled_balance = a.last_reconciled_balance + COALESCE((
                     SELECT SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END)
                       FROM transactions t
                      WHERE t.account_id = a.id
                        AND t.created_at > a.reconciled_at
                   ), 0)
             WHERE a.id = $1::uuid
         RETURNING {ACCOUNT_COLUMNS}""",
        account_id,
    )
    if row is None:
        raise not_found(f"Account {account_id} not found")
    return to_account(row)


async def pending_balance(conn: asyncpg.connection.Connection, account_id: str) -> float:
    """Balance the account would have once pending transactions are folded in.

    Used to check a transfer against funds that are locked but not yet
    synced.
    """
    row = await conn.fetchrow(
        """SELECT a.last_reconciled_balance + COALESCE((
                     SELECT SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END)
                       FROM transactions t
                      WHERE t.account_id = a.id
                        AND t.created_at > a.reconciled_at
                   ), 0) AS balance
              FROM accounts a
             WHERE a.id = $1::uuid""",
        account_id,
    )
    if row is None:
        raise not_found(f"Account {account_id} not found")
    return float(row["balance"])
