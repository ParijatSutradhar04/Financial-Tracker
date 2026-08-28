"""Creates accounts/cards from finance.config.json that the database doesn't
have yet. Mirrors server/src/services/provision.ts.

Only ever inserts. An account already carries a balance the ledger agrees
with, so writing opening_balance over it on every run would undo the user's
history; rows are never removed because transactions reference them. Editing
a name in the config therefore reads as adding a new account rather than
renaming an old one.

Because this is an INSERT it does not fire the reconciliation trigger, which
only watches updates, so a new account starts at its opening balance with an
empty ledger and no Adjustment row.

Deliberately not called from the request path (see scripts/provision.py) —
the Express original ran this as a top-level `await` on every cold start,
which is exactly the pattern that breaks on serverless.
"""

from __future__ import annotations

import asyncpg

from ..finance_config import finance_config


async def provision_accounts(conn: asyncpg.connection.Connection) -> dict:
    created: list[str] = []
    existing: list[str] = []

    for account in finance_config.accounts:
        row = await conn.fetchrow(
            """INSERT INTO accounts (name, kind, currency, last_reconciled_balance)
                    VALUES ($1, $2, $3, $4)
               ON CONFLICT (name) DO NOTHING
                 RETURNING name""",
            account.name,
            account.kind,
            account.currency,
            account.opening_balance,
        )
        if row is not None:
            created.append(account.name)
        else:
            existing.append(account.name)

    return {"created": created, "existing": existing}
