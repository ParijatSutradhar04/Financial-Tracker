"""GET /api/accounts. Mirrors server/src/routes/accounts.ts."""

from __future__ import annotations

from fastapi import APIRouter

from ..db import acquire
from ..services.balances import ACCOUNT_COLUMNS, to_account
from ..schemas import AccountOut

router = APIRouter()


@router.get("", response_model=list[AccountOut])
async def list_accounts() -> list[AccountOut]:
    async with acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {ACCOUNT_COLUMNS} FROM accounts ORDER BY created_at, name"
        )
    return [AccountOut(**to_account(row)) for row in rows]
