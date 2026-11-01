"""Supabase serves the public schema over PostgREST to anyone holding the
(public) anon key. Row level security with no policies is what keeps that
closed; the API connects as postgres, which bypasses it.
Needs TEST_DATABASE_URL, loaded from supabase/init.sql."""

import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

from app import db  # noqa: E402


@pytest.fixture
async def conn():
    async with db.acquire() as c:
        yield c
    await db.close_pool()


async def test_every_public_table_has_row_level_security(conn):
    open_tables = await conn.fetch(
        """SELECT c.relname
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
            ORDER BY 1"""
    )
    assert [r["relname"] for r in open_tables] == []
