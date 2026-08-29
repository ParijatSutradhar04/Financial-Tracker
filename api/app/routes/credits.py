"""POST /api/credits — a manual credit to any account (refund, cashback,
gift, etc.), picked from the same category list as Add Expense. Distinct from
Salary, which stays its own fixed-category, fixed-account flow tied to payday."""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from ..config import settings
from ..db import transaction as db_transaction
from ..errors import bad_request
from ..services.balances import lock_accounts, sync_balance
from ..services.categories import category_names
from ..services.transactions import insert_transaction
from ..schemas import AccountOut, CreateCreditIn, TransactionAccountOut, TransactionOut

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED, response_model=TransactionAccountOut)
async def add_credit(body: CreateCreditIn) -> JSONResponse:
    async with db_transaction() as conn:
        names = await category_names(conn)
        if body.category not in names:
            raise bad_request(f"Category must be one of: {', '.join(sorted(names))}")

        await lock_accounts(conn, [body.account_id])
        tx = await insert_transaction(
            conn,
            settings.timezone,
            body.account_id,
            body.amount,
            "credit",
            body.category,
            body.description,
            body.date,
        )
        account = await sync_balance(conn, body.account_id)

    result = TransactionAccountOut(transaction=TransactionOut(**tx), account=AccountOut(**account))
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=result.model_dump(by_alias=True))
