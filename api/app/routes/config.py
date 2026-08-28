"""GET /api/config — spendable categories plus the reserved ones the ledger
writes itself, so the frontend can render both with the right styling and
know which ones the user is allowed to pick. Mirrors server/src/routes/config.ts.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..domain import RESERVED_CATEGORY_STYLES
from ..finance_config import finance_config
from ..schemas import CategoryOut, ConfigOut

router = APIRouter()


@router.get("", response_model=ConfigOut)
async def get_config() -> ConfigOut:
    categories = [
        CategoryOut(name=c.name, icon=c.icon, color=c.color, spendable=True, hidden=False)
        for c in finance_config.categories
    ] + [
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
