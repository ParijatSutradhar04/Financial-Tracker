"""POST /api/salary. Mirrors server/src/routes/salary.ts."""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from ..config import settings
from ..db import transaction as db_transaction
from ..domain import SALARY_CATEGORY
from ..services.balances import lock_accounts, sync_balance
from ..services.payday import next_payday
from ..services.transactions import insert_transaction
from ..schemas import AccountOut, CreateSalaryIn, PaydayOut, SalaryOut, TransactionOut

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED, response_model=SalaryOut)
async def add_salary(body: CreateSalaryIn) -> JSONResponse:
    async with db_transaction() as conn:
        await lock_accounts(conn, [body.account_id])
        tx = await insert_transaction(
            conn,
            settings.timezone,
            body.account_id,
            body.amount,
            "credit",
            SALARY_CATEGORY,
            body.description or "Salary credited",
            body.date,
        )
        account = await sync_balance(conn, body.account_id)
        payday = await next_payday(conn, tz_name=settings.timezone)

    result = SalaryOut(
        transaction=TransactionOut(**tx),
        account=AccountOut(**account),
        payday=PaydayOut(**payday),
    )
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=result.model_dump(by_alias=True))
