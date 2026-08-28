"""Payday countdown. Mirrors server/src/services/payday.ts."""

from __future__ import annotations

from datetime import datetime, timezone

import asyncpg

from ..domain import PAYDAY_DAY_OF_MONTH, SALARY_CATEGORY
from .dates import days_between, parse_iso_date, today_iso


def payday_on(year: int, month: int) -> str:
    """The 28th of the given month, where month 13 rolls into January of the
    next year (and month 0 rolls back into December of the previous one).

    `month` is 1-indexed but may fall outside 1-12; this normalizes it the
    same way JavaScript's `Date.UTC` does when handed an out-of-range month.
    """
    total_months = year * 12 + (month - 1)
    norm_year, norm_month0 = divmod(total_months, 12)
    return datetime(norm_year, norm_month0 + 1, PAYDAY_DAY_OF_MONTH, 12, tzinfo=timezone.utc).date().isoformat()


async def last_salary_date(conn: asyncpg.connection.Connection) -> str | None:
    row = await conn.fetchrow(
        """SELECT to_char(max(transaction_date), 'YYYY-MM-DD') AS date
             FROM transactions
            WHERE category = $1 AND type = 'credit'""",
        SALARY_CATEGORY,
    )
    return row["date"] if row else None


def resolve_payday(today: str, salary_date: str | None) -> dict:
    """Payday is the 28th. It normally falls in the current month, moving to
    the next one after the 28th has passed, and the countdown reads 0 on the
    day itself.

    Once salary has actually been credited for the upcoming payday, that
    cycle is settled and the countdown jumps to the following month rather
    than sitting at a payday that has already been paid.
    """
    year, month, day = parse_iso_date(today)

    date_ = payday_on(year, month + (1 if day > PAYDAY_DAY_OF_MONTH else 0))

    if salary_date:
        # Anything credited after the previous payday belongs to the cycle
        # now being counted down to, so that cycle is already satisfied.
        c_year, c_month, _ = parse_iso_date(date_)
        if salary_date > payday_on(c_year, c_month - 1):
            date_ = payday_on(c_year, c_month + 1)

    return {"date": date_, "days_until": days_between(today, date_), "last_salary_date": salary_date}


async def next_payday(conn: asyncpg.connection.Connection, today: str | None = None, tz_name: str = "UTC") -> dict:
    resolved_today = today or today_iso(tz_name)
    return resolve_payday(resolved_today, await last_salary_date(conn))
