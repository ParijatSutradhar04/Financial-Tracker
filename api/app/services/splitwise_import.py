"""DB side of the Splitwise import: which rows are already in, the category
memory, and a bulk insert of the rest.

Inserts every row in one statement rather than calling insert_transaction per
row: the API runs far from the database (see KNOWN_ISSUES.md), so hundreds of
sequential round trips would blow past the function time limit. The
timestamp rule matches insert_transaction exactly.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import asyncpg

from ..errors import bad_request
from .balances import lock_accounts, sync_balance
from .categories import category_names
from .dates import parse_iso_date, today_iso
from .splitwise import memory_key


def transaction_timestamp(tz_name: str, date_: str) -> datetime | None:
    """None means "use the insert clock time", for a row dated today; a
    back-dated row lands at local midnight on its own day."""
    if date_ == today_iso(tz_name):
        return None
    year, month, day = parse_iso_date(date_)
    return datetime(year, month, day, tzinfo=ZoneInfo(tz_name))


async def already_imported(conn: asyncpg.connection.Connection, fingerprints: list[str]) -> set[str]:
    if not fingerprints:
        return set()
    rows = await conn.fetch(
        "SELECT fingerprint FROM splitwise_imports WHERE fingerprint = ANY($1::text[])", fingerprints
    )
    return {row["fingerprint"] for row in rows}


async def recall_categories(conn: asyncpg.connection.Connection, keys: list[str]) -> dict[str, str]:
    """Remembered category per memory key. The caller checks the category
    still exists, since the table stores names, not foreign keys."""
    if not keys:
        return {}
    rows = await conn.fetch(
        "SELECT description_key, category FROM category_memory WHERE description_key = ANY($1::text[])", keys
    )
    return {row["description_key"]: row["category"] for row in rows}


async def import_rows(conn: asyncpg.connection.Connection, tz_name: str, account_id: str, rows: list) -> dict:
    """Must run inside db.transaction(). `rows` are SplitwiseImportRowIn."""
    names = await category_names(conn)
    unknown = sorted({r.category for r in rows if r.category not in names})
    if unknown:
        raise bad_request(f"Unknown category: {', '.join(unknown)}. Re-run the preview and pick again.")

    # The account lock also serializes two imports of the same file.
    await lock_accounts(conn, [account_id])

    existing = await already_imported(conn, [r.fingerprint for r in rows])
    fresh = [r for r in rows if r.fingerprint not in existing]

    if fresh:
        ids = [uuid.uuid4() for _ in fresh]
        await conn.execute(
            """INSERT INTO transactions (id, account_id, amount, type, category, description, transaction_date)
               SELECT r.id, $1::uuid, r.amount, 'debit', r.category, r.description,
                      COALESCE(r.ts, clock_timestamp())
                 FROM unnest($2::uuid[], $3::numeric[], $4::text[], $5::text[], $6::timestamptz[])
                      AS r(id, amount, category, description, ts)""",
            account_id,
            ids,
            [Decimal(str(r.amount)) for r in fresh],
            [r.category for r in fresh],
            [r.description for r in fresh],
            [transaction_timestamp(tz_name, r.date) for r in fresh],
        )
        await conn.execute(
            """INSERT INTO splitwise_imports (fingerprint, transaction_id)
               SELECT * FROM unnest($1::text[], $2::uuid[])""",
            [r.fingerprint for r in fresh],
            ids,
        )

        # Importing is the user's confirmation, so remember each row's final
        # category, whether it was Laya's or the user's. Last row wins per key.
        remembered = {key: r.category for r in fresh if (key := memory_key(r.description))}
        if remembered:
            await conn.execute(
                """INSERT INTO category_memory (description_key, category)
                   SELECT * FROM unnest($1::text[], $2::text[])
                   ON CONFLICT (description_key)
                   DO UPDATE SET category = EXCLUDED.category, updated_at = clock_timestamp()""",
                list(remembered),
                list(remembered.values()),
            )

    account = await sync_balance(conn, account_id)
    return {"imported": len(fresh), "skipped_duplicates": len(rows) - len(fresh), "account": account}
