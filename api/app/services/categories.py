"""Category reads/writes.

Categories are DB-backed and mutable from the app; finance.config.json's
categories array is now only a seed template, read once by provision_categories
below for a database that has none yet.
"""

from __future__ import annotations

import re

import asyncpg

from ..errors import bad_request, not_found

_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

CATEGORY_COLUMNS = "id, name, icon, color, spendable, hidden"


def to_category(row: asyncpg.Record) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "icon": row["icon"],
        "color": row["color"],
        "spendable": row["spendable"],
        "hidden": row["hidden"],
    }


def _check_color(color: str) -> None:
    if not _COLOR_RE.match(color):
        raise bad_request("Expected a #rrggbb colour")


async def list_categories(conn: asyncpg.connection.Connection) -> list[dict]:
    rows = await conn.fetch(f"SELECT {CATEGORY_COLUMNS} FROM categories ORDER BY created_at, name")
    return [to_category(row) for row in rows]


async def category_names(conn: asyncpg.connection.Connection) -> set[str]:
    """Names a transaction's category is allowed to be, per the Add Expense/Add Credit pickers."""
    rows = await conn.fetch("SELECT name FROM categories")
    return {row["name"] for row in rows}


async def create_category(conn: asyncpg.connection.Connection, name: str, icon: str, color: str) -> dict:
    _check_color(color)
    row = await conn.fetchrow(
        f"""INSERT INTO categories (name, icon, color)
                 VALUES ($1, $2, $3)
              RETURNING {CATEGORY_COLUMNS}""",
        name,
        icon,
        color,
    )
    return to_category(row)


async def update_category(
    conn: asyncpg.connection.Connection, category_id: str, name: str, icon: str, color: str
) -> dict:
    _check_color(color)
    row = await conn.fetchrow(
        f"""UPDATE categories
               SET name = $2, icon = $3, color = $4
             WHERE id = $1::uuid
         RETURNING {CATEGORY_COLUMNS}""",
        category_id,
        name,
        icon,
        color,
    )
    if row is None:
        raise not_found(f"Category {category_id} not found")
    return to_category(row)


async def delete_category(conn: asyncpg.connection.Connection, category_id: str) -> None:
    row = await conn.fetchrow("SELECT name FROM categories WHERE id = $1::uuid", category_id)
    if row is None:
        raise not_found(f"Category {category_id} not found")

    # category is free text on transactions (no FK), so this is an
    # application-level check rather than something the DB would reject.
    in_use = await conn.fetchval("SELECT 1 FROM transactions WHERE category = $1 LIMIT 1", row["name"])
    if in_use:
        raise bad_request("Cannot delete a category that already has transactions recorded under it")

    await conn.execute("DELETE FROM categories WHERE id = $1::uuid", category_id)


async def provision_categories(conn: asyncpg.connection.Connection) -> dict:
    """Seeds the categories table from finance.config.json. Only ever inserts."""
    from ..finance_config import finance_config

    created: list[str] = []
    existing: list[str] = []

    for category in finance_config.categories:
        row = await conn.fetchrow(
            """INSERT INTO categories (name, icon, color)
                    VALUES ($1, $2, $3)
               ON CONFLICT (name) DO NOTHING
                 RETURNING name""",
            category.name,
            category.icon,
            category.color,
        )
        if row is not None:
            created.append(category.name)
        else:
            existing.append(category.name)

    return {"created": created, "existing": existing}
