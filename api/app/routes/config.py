"""GET /api/config — spendable categories plus the reserved ones the ledger
writes itself, so the frontend can render both with the right styling and
know which ones the user is allowed to pick. Mirrors server/src/routes/config.ts.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..db import acquire
from ..domain import RESERVED_CATEGORY_STYLES
from ..services.categories import list_categories
from ..schemas import CategoryOut, ConfigOut

router = APIRouter()


@router.get("", response_model=ConfigOut)
async def get_config() -> ConfigOut:
    async with acquire() as conn:
        db_categories = await list_categories(conn)

    categories = [CategoryOut(**c) for c in db_categories] + [
        CategoryOut(
            name=style["name"],
            icon=style["icon"],
            color=style["color"],
            spendable=False,
            hidden=style["hidden"],
        )
        for style in RESERVED_CATEGORY_STYLES
    ]
    return ConfigOut(categories=categories)
