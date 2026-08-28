#!/usr/bin/env python3
"""Applies supabase/init.sql (schema + the two triggers) to the database.

Equivalent to what scripts/dev.sh gets for free from Postgres's
docker-entrypoint-initdb.d on a fresh volume: this is the one-time step a
database that doesn't get that for free — i.e. Supabase — needs instead. Run
it once, against the *direct* connection (port 5432), not the transaction
pooler (6543): PgBouncer's transaction-pooling mode doesn't support the kind
of session state a multi-statement DDL script implicitly relies on.

    DATABASE_URL="postgres://...supabase direct.../postgres" python scripts/migrate.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

API_ROOT = Path(__file__).resolve().parent.parent
SQL_PATH = API_ROOT.parent / "supabase" / "init.sql"


async def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        raise SystemExit(1)

    sql = SQL_PATH.read_text(encoding="utf8")

    conn = await asyncpg.connect(dsn=database_url)
    try:
        # Called with no arguments, execute() uses the simple query protocol
        # rather than the extended one, which is what lets a single call run
        # a whole semicolon-separated script instead of just one statement.
        await conn.execute(sql)
    finally:
        await conn.close()

    print(f"Applied {SQL_PATH.relative_to(API_ROOT.parent)}.")


if __name__ == "__main__":
    asyncio.run(main())
