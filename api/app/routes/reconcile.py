"""POST /api/reconcile. Mirrors server/src/routes/reconcile.ts.

Deliberately writes the balance the user reports rather than folding it in:
`fn_auto_reconcile_account` is the thing that reconciles the ledger to that
number, by writing an Adjustment transaction for the gap. This route only
ever issues the UPDATE that fires it, then reads back what it wrote.
"""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from ..db import transaction as db_transaction
from ..services.balances import ACCOUNT_COLUMNS, lock_accounts, to_account
from ..services.transactions import transactions_created_since
from ..schemas import AccountOut, ReconcileIn, ReconcileOut, TransactionOut

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ReconcileOut)
async def reconcile(body: ReconcileIn) -> JSONResponse:
    async with db_transaction() as conn:
        account_ids = [b.account_id for b in body.balances]
        locked = await lock_accounts(conn, account_ids)

        accounts: list[dict] = []
        adjustments: list[dict] = []
        for balance_in in body.balances:
            since = locked[balance_in.account_id]["reconciled_at"]

            row = await conn.fetchrow(
                f"""UPDATE accounts
                       SET last_reconciled_balance = $2
                     WHERE id = $1::uuid
                 RETURNING {ACCOUNT_COLUMNS}""",
                balance_in.account_id,
                balance_in.balance,
            )
            accounts.append(to_account(row))

            adjustments.extend(
                await transactions_created_since(conn, balance_in.account_id, since)
            )

    result = ReconcileOut(
        accounts=[AccountOut(**a) for a in accounts],
        adjustments=[TransactionOut(**a) for a in adjustments],
    )
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=result.model_dump(by_alias=True))
