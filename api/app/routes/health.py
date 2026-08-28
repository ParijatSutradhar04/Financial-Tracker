"""Liveness probe. Not behind auth — deploy tooling and uptime checks hit this."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..db import acquire

router = APIRouter()


@router.get("")
async def health() -> JSONResponse:
    try:
        async with acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return JSONResponse(status_code=200, content={"status": "ok"})
