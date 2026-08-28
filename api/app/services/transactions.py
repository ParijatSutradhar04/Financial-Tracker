"""Ledger reads/writes. Mirrors server/src/services/transactions.ts."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import asyncpg

from ..domain import RESERVED_CATEGORIES
from .dates import iso_z, parse_iso_date, today_iso

_RESERVED = set(RESERVED_CATEGORIES)

SELECT_TRANSACTION = """
  SELECT t.id,
         t.account_id,
         a.name AS account_name,
         t.amount,
         t.type,
         t.category,
         t.description,
         to_char(t.transaction_date, 'YYYY-MM-DD') AS date,
         t.created_at
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id"""


def to_transaction(row: asyncpg.Record) -> dict:
    return {
        "id": str(row["id"]),
        "account_id": str(row["account_id"]),
        "account_name": row["account_name"],
        "amount": float(row["amount"]),
        "type": row["type"],
        "category": row["category"],
        "description": row["description"] or "",
        "date": row["date"],
        # Transfers move money between the user's own accounts and
        # adjustments correct a stale balance, so neither is spending even
        # though both are debits on one side.
        "is_spend": row["type"] == "debit" and row["category"] not in _RESERVED,
        "created_at": iso_z(row["created_at"]),
    }


async def list_transactions(
    conn: asyncpg.connection.Connection,
    from_: str | None = None,
    to: str | None = None,
) -> list[dict]:
    # Unlike node-pg, asyncpg requires an actual `date` object for a `::date`
    # parameter rather than tolerating a "YYYY-MM-DD" text literal.
    from_date = date(*parse_iso_date(from_)) if from_ else None
    to_date = date(*parse_iso_date(to)) if to else None
    rows = await conn.fetch(
        f"""{SELECT_TRANSACTION}
      WHERE ($1::date IS NULL OR t.transaction_date >= $1::date)
        AND ($2::date IS NULL OR t.transaction_date < $2::date + INTERVAL '1 day')
      ORDER BY t.transaction_date DESC, t.created_at DESC""",
        from_date,
        to_date,
    )
    return [to_transaction(row) for row in rows]


async def insert_transaction(
    conn: asyncpg.connection.Connection,
    tz_name: str,
    account_id: str,
    amount: float,
    type_: str,
    category: str,
    description: str,
    date_: str | None = None,
) -> dict:
    # An entry dated today gets the current clock time so same-day entries
    # stay in insertion order; a back-dated one lands at midnight on its own
    # day, in the app's timezone. Unlike node-pg, asyncpg requires an actual
    # datetime for a timestamptz parameter rather than a text literal for
    # Postgres to parse, so this is built as a timezone-aware datetime rather
    # than the "YYYY-MM-DD 00:00:00" string the original passed straight
    # through — same instant, since that string was always interpreted
    # against the session's `-c timezone=<tz_name>` setting anyway.
    backdated: datetime | None = None
    if date_ and date_ != today_iso(tz_name):
        year, month, day = parse_iso_date(date_)
        backdated = datetime(year, month, day, tzinfo=ZoneInfo(tz_name))

    row_id = await conn.fetchval(
        """INSERT INTO transactions (account_id, amount, type, category, description, transaction_date)
           VALUES ($1::uuid, $2, $3, $4, $5, COALESCE($6::timestamptz, clock_timestamp()))
           RETURNING id""",
        account_id,
        amount,
        type_,
        category,
        description,
        backdated,
    )

    row = await conn.fetchrow(f"{SELECT_TRANSACTION} WHERE t.id = $1::uuid", row_id)
    return to_transaction(row)


async def transactions_created_since(
    conn: asyncpg.connection.Connection,
    account_id: str,
    since: datetime,
) -> list[dict]:
    """Transactions created for an account since the given instant, newest first.

    `since` should come straight from a `timestamptz` column read back by
    asyncpg (e.g. `lock_accounts`' `reconciled_at`) so it carries the same
    microsecond resolution Postgres stores internally.
    """
    rows = await conn.fetch(
        f"""{SELECT_TRANSACTION}
      WHERE t.account_id = $1::uuid AND t.created_at > $2::timestamptz
      ORDER BY t.created_at DESC""",
        account_id,
        since,
    )
    return [to_transaction(row) for row in rows]
