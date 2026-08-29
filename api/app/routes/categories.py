"""POST/PATCH/DELETE /api/categories.

New: categories used to be a static list in finance.config.json; they are now
DB-backed and manageable from the app.
"""

from __future__ import annotations

from fastapi import APIRouter, status

from ..db import transaction as db_transaction
from ..domain import RESERVED_CATEGORIES
from ..errors import bad_request
from ..schemas import CategoryIn, CategoryOut
from ..services.categories import create_category, delete_category, update_category

router = APIRouter()


def _reject_reserved(name: str) -> None:
    # Transfer/Adjustment/Salary are written by the backend itself and never
    # offered in the Add Expense/Add Credit pickers, so a user-created
    # category can't reuse one of those names.
    if name in RESERVED_CATEGORIES:
        raise bad_request(f"'{name}' is reserved and can't be used as a category name")


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CategoryOut)
async def add_category(body: CategoryIn) -> CategoryOut:
    _reject_reserved(body.name)
    async with db_transaction() as conn:
        row = await create_category(conn, body.name, body.icon, body.color)
    return CategoryOut(**row)


@router.patch("/{category_id}", response_model=CategoryOut)
async def edit_category(category_id: str, body: CategoryIn) -> CategoryOut:
    _reject_reserved(body.name)
    async with db_transaction() as conn:
        row = await update_category(conn, category_id, body.name, body.icon, body.color)
    return CategoryOut(**row)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_category(category_id: str) -> None:
    async with db_transaction() as conn:
        await delete_category(conn, category_id)
