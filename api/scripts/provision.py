#!/usr/bin/env python3
"""Applies config/finance.config.json to the database and reports what changed.

Mirrors server/src/scripts/sync-config.ts. The Express original also did this
on every API startup; that top-level `await` is exactly the per-cold-start
pattern serverless breaks on, so here it only ever runs from this script —
once at deploy time, or locally after scripts/reset-db.sh (at the repo root)
has recreated the volume.

    python scripts/provision.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.finance_config import finance_config  # noqa: E402
from app.services.categories import provision_categories  # noqa: E402
from app.services.provision import provision_accounts  # noqa: E402


async def main() -> None:
    conn = await asyncpg.connect(dsn=settings.database_url)
    try:
        accounts_result = await provision_accounts(conn)
        categories_result = await provision_categories(conn)
    finally:
        await conn.close()

    by_name = {a.name: a for a in finance_config.accounts}
    for name in accounts_result["created"]:
        account = by_name[name]
        label = "credit card" if account.kind == "credit_card" else "account"
        print(f"  created {label} {name} at {account.opening_balance}")
    for name in accounts_result["existing"]:
        print(f"  {name} already exists, left untouched")

    if categories_result["created"]:
        print(f"  created categories: {', '.join(categories_result['created'])}")
    if categories_result["existing"]:
        print(f"  {len(categories_result['existing'])} categories already exist, left untouched")


if __name__ == "__main__":
    asyncio.run(main())
