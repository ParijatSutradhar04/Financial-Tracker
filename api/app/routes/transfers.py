"""POST /api/transfers. Mirrors server/src/routes/transfers.ts."""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from ..config import settings
from ..db import transaction as db_transaction
from ..domain import TRANSFER_CATEGORY
from ..errors import bad_request
from ..services.balances import lock_accounts, pending_balance, sync_balance
from ..services.dates import today_iso
from ..services.transactions import insert_transaction
from ..schemas import AccountOut, CreateTransferIn, TransactionOut, TransfersOut

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED, response_model=TransfersOut)
async def transfer(body: CreateTransferIn) -> JSONResponse:
    async with db_transaction() as conn:
        accounts = await lock_accounts(conn, [body.from_account_id, body.to_account_id])
        from_account = accounts[body.from_account_id]
        to_account = accounts[body.to_account_id]

        available = await pending_balance(conn, body.from_account_id)
        if available < body.amount:
            raise bad_request(f"Insufficient funds in {from_account['name']}")

        today = today_iso(settings.timezone)
        debit = await insert_transaction(
            conn,
            settings.timezone,
            body.from_account_id,
            body.amount,
            "debit",
            TRANSFER_CATEGORY,
            body.description or f"Transfer to {to_account['name']}",
            today,
        )
        credit = await insert_transaction(
            conn,
            settings.timezone,
            body.to_account_id,
            body.amount,
            "credit",
            TRANSFER_CATEGORY,
            body.description or f"Transfer from {from_account['name']}",
            today,
        )

        from_synced = await sync_balance(conn, body.from_account_id)
        to_synced = await sync_balance(conn, body.to_account_id)

    result = TransfersOut(
        transactions=[TransactionOut(**debit), TransactionOut(**credit)],
        accounts=[AccountOut(**from_synced), AccountOut(**to_synced)],
    )
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=result.model_dump(by_alias=True))
