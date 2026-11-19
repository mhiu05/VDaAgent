"""Test-only database helpers (doc 17): fresh databases and constraint assertions."""

from __future__ import annotations

import asyncpg
import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError


def with_database(url: str, name: str) -> str:
    """`url` pointing at the database `name` (same server and credentials)."""
    return make_url(url).set(database=name).render_as_string(hide_password=False)


async def recreate_database(url: str) -> None:
    """Drop and create the database `url` names. Refuses anything not ending in `_test*`."""
    u = make_url(url)
    name = u.database or ""
    if "_test" not in name:
        raise RuntimeError(f"refusing to recreate a non-test database: {name!r}")
    conn = await asyncpg.connect(
        host=u.host, port=u.port or 5432, user=u.username, password=u.password, database="postgres"
    )
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{name}"')
    finally:
        await conn.close()


def violated_constraint(exc: DBAPIError) -> str | None:
    """Name of the constraint (or index) an IntegrityError reports, from asyncpg."""
    cause = getattr(exc.orig, "__cause__", None)
    return getattr(cause, "constraint_name", None)


async def assert_violates(conn, stmt, constraint: str) -> None:
    """Executing `stmt` in a savepoint fails on `constraint`; the outer transaction stays usable."""
    with pytest.raises(DBAPIError) as info:
        async with conn.begin_nested():
            await conn.execute(stmt)
    assert violated_constraint(info.value) == constraint, str(info.value.orig)


async def assert_rejected(conn, stmt, message: str) -> None:
    """Executing `stmt` in a savepoint fails with an error containing `message` (triggers)."""
    with pytest.raises(DBAPIError) as info:
        async with conn.begin_nested():
            await conn.execute(stmt)
    assert message in str(info.value.orig)
