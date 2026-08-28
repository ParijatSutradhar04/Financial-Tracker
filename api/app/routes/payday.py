"""GET /api/payday. Mirrors server/src/routes/payday.ts."""

from __future__ import annotations

from fastapi import APIRouter

from ..config import settings
from ..db import acquire
from ..services.payday import next_payday
from ..schemas import PaydayOut

router = APIRouter()


@router.get("", response_model=PaydayOut)
async def get_payday() -> PaydayOut:
    async with acquire() as conn:
        payday = await next_payday(conn, tz_name=settings.timezone)
    return PaydayOut(**payday)
