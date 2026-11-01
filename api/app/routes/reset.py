"""POST /api/reset: deletes every account and transaction, so the ledger can
be entered afresh from the app.

Transactions are immutable: trg_immutable_transactions blocks UPDATE and
DELETE row by row. This route TRUNCATEs instead, which fires no row
triggers. That makes it the one deliberate way round immutability, so it
wants a typed confirmation word on top of the login every route needs.

Categories and the Splitwise category memory are kept. They describe how
spending is sorted, not what was spent, and without categories the
dashboard has nothing to file a new expense under.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..db import transaction as db_transaction
from ..errors import bad_request
from ..schemas import ResetIn, ResetOut

router = APIRouter()

CONFIRM_WORD = "RESET"

# Every table holding ledger rows. They're listed rather than truncated with
# CASCADE: a table added later that references these then makes the reset
# fail loudly, instead of being emptied without anyone choosing that.
LEDGER_TABLES = "splitwise_imports, transactions, accounts"


@router.post("", response_model=ResetOut)
async def reset(body: ResetIn) -> ResetOut:
    if body.confirm != CONFIRM_WORD:
        raise bad_request(f"Type {CONFIRM_WORD} to confirm")

    async with db_transaction() as conn:
        # Locking first means the counts are exactly what gets deleted.
        await conn.execute(f"LOCK TABLE {LEDGER_TABLES} IN ACCESS EXCLUSIVE MODE")
        accounts = await conn.fetchval("SELECT count(*) FROM accounts")
        transactions = await conn.fetchval("SELECT count(*) FROM transactions")
        await conn.execute(f"TRUNCATE {LEDGER_TABLES}")

    return ResetOut(accounts=accounts, transactions=transactions)
