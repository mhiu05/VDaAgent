"""Async engine and connections over `DATABASE_URL` (doc 10: SQLAlchemy Core + asyncpg)."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine


def async_url(url: str) -> str:
    """`url` with the asyncpg driver (`postgresql://` and `postgres://` are accepted too)."""
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    u = make_url(url.replace("postgres://", "postgresql://", 1))
    if u.drivername in ("postgresql", "postgresql+asyncpg"):
        u = u.set(drivername="postgresql+asyncpg")
    else:
        raise RuntimeError(f"DATABASE_URL must be a PostgreSQL URL, not {u.drivername!r}")
    return u.render_as_string(hide_password=False)


def create_engine(url: str, **kwargs: Any) -> AsyncEngine:
    """An async engine; nothing connects until first use."""
    kwargs.setdefault("pool_pre_ping", True)
    return create_async_engine(async_url(url), **kwargs)


_HOOKS = "contoso_after_commit"


@asynccontextmanager
async def transaction(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    """A connection in a transaction: committed on success, rolled back on error.

    Callbacks registered with `on_commit` run after the commit, never on rollback.
    """
    hooks: list[Callable[[], Any]] = []
    async with engine.begin() as conn:
        conn.info[_HOOKS] = hooks
        try:
            yield conn
        finally:
            conn.info.pop(_HOOKS, None)
    run_hooks(hooks)


@asynccontextmanager
async def hook_scope(conn: AsyncConnection) -> AsyncIterator[list[Callable[[], Any]]]:
    """A fresh `on_commit` list on `conn` for an inner scope (a savepoint, a request)."""
    previous = conn.info.get(_HOOKS)
    hooks: list[Callable[[], Any]] = []
    conn.info[_HOOKS] = hooks
    try:
        yield hooks
    finally:
        if previous is None:
            conn.info.pop(_HOOKS, None)
        else:
            conn.info[_HOOKS] = previous


def on_commit(conn: AsyncConnection, callback: Callable[[], Any]) -> None:
    """Run `callback` once the current transaction commits (at once if there is no scope)."""
    hooks = conn.info.get(_HOOKS)
    if hooks is None:
        callback()
    else:
        hooks.append(callback)


def run_hooks(hooks: list[Callable[[], Any]]) -> None:
    for callback in hooks:
        try:
            callback()
        except Exception:  # a wake or a publish must never break the caller
            logging.getLogger("contoso").exception("after-commit callback failed")
