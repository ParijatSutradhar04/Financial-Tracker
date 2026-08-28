"""asyncpg pool + transaction helper. Mirrors server/src/db.ts.

Uses a lazily-created global pool (module-level singletons survive warm
serverless invocations, same as the Node pg.Pool did per-process) sized small
because Supabase's connection pooler already multiplexes connections.
`statement_cache_size=0` is required behind PgBouncer in transaction-pooling
mode, which does not support server-side prepared statements surviving across
"transactions" the way a direct connection would.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=0,
            max_size=int(os.environ.get("DB_POOL_MAX", "3")),
            statement_cache_size=0,
            server_settings={"timezone": settings.timezone},
        )
    return _pool


@asynccontextmanager
async def acquire() -> AsyncIterator[asyncpg.pool.PoolConnectionProxy]:
    """A pooled connection for a single read, released back on exit."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


@asynccontextmanager
async def transaction() -> AsyncIterator[asyncpg.pool.PoolConnectionProxy]:
    """Runs the block inside a single database transaction.

    Every balance-changing route uses this so that the row locks it takes are
    held until the balance has been re-synced, matching withTransaction() in
    the original.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            yield conn


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
