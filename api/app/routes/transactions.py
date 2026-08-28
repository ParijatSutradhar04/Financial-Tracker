"""GET/POST /api/transactions. Mirrors server/src/routes/transactions.ts."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, status
from fastapi.responses import JSONResponse

from ..config import settings
from ..db import transaction as db_transaction
from ..services.balances import lock_accounts, sync_balance
from ..services.transactions import insert_transaction, list_transactions
from ..schemas import AccountOut, CreateTransactionIn, TransactionAccountOut, TransactionOut

router = APIRouter()


@router.get("", response_model=list[TransactionOut])
async def get_transactions(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None, alias="to"),
) -> list[TransactionOut]:
    async with db_transaction() as conn:
        rows = await list_transactions(conn, from_, to)
    return [TransactionOut(**row) for row in rows]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=TransactionAccountOut)
async def add_expense(body: CreateTransactionIn) -> JSONResponse:
    async with db_transaction() as conn:
        await lock_accounts(conn, [body.account_id])
        tx = await insert_transaction(
            conn,
            settings.timezone,
            body.account_id,
            body.amount,
            "debit",
            body.category,
            body.description,
            body.date,
        )
        account = await sync_balance(conn, body.account_id)

    result = TransactionAccountOut(transaction=TransactionOut(**tx), account=AccountOut(**account))
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=result.model_dump(by_alias=True))
