"""GET/POST /api/accounts. Mirrors server/src/routes/accounts.ts, plus a new
create endpoint — accounts and credit cards used to only ever come from
finance.config.json + scripts/provision.py."""

from __future__ import annotations

from fastapi import APIRouter, status

from ..db import acquire
from ..services.balances import ACCOUNT_COLUMNS, to_account
from ..schemas import AccountOut, CreateAccountIn

router = APIRouter()


@router.get("", response_model=list[AccountOut])
async def list_accounts() -> list[AccountOut]:
    async with acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {ACCOUNT_COLUMNS} FROM accounts ORDER BY created_at, name"
        )
    return [AccountOut(**to_account(row)) for row in rows]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=AccountOut)
async def create_account(body: CreateAccountIn) -> AccountOut:
    async with acquire() as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO accounts (name, kind, last_reconciled_balance)
                     VALUES ($1, $2, $3)
                 RETURNING {ACCOUNT_COLUMNS}""",
            body.name,
            body.kind,
            body.opening_balance,
        )
    return AccountOut(**to_account(row))
