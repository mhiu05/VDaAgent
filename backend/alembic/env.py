"""Alembic environment: async (asyncpg) migrations against `DATABASE_URL`.

Used by `backend.db.migrate` (boot, tests) and by the CLI for new revisions:
    docker compose run --rm backend alembic -c backend/alembic.ini revision --autogenerate -m "..."
Logging is left to the caller (no `fileConfig`), so booting keeps uvicorn's loggers.
"""

from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.pool import NullPool

from backend.db.session import create_engine
from backend.db.tables import metadata

config = context.config


def _url() -> str:
    url = config.attributes.get("database_url")
    if url is None:
        from backend.settings import Settings

        url = Settings().DATABASE_URL.get_secret_value()
    return url


def _run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=metadata,
        compare_type=True,
        compare_server_default=True,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    engine = create_engine(_url(), poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            await conn.run_sync(_run)
            await conn.commit()
    finally:
        await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("offline migrations are not supported; run against a database")
asyncio.run(_run_async())
