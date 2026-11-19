"""Request dependencies: the DB connection, the current user, roles, ownership, domain status.

- `current_user`: any authenticated human account (401 `unauthenticated` otherwise; a
  `service` account is never a request principal).
- `require_user`: a human with role `user` (the chat and team routes; an admin has no team → 403).
- `require_admin`: role `admin` (every `/api/admin/*` route → 403 `forbidden` for users).
- `require_domain_available`: a `user` whose domain is available; otherwise 503
  `domain_unavailable`. For the routes that post to a user's threads (S7).
- `get_owned`: a user-scoped row, or 404 `not_found` when it belongs to someone else.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy import Table, select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.api.errors import ApiError
from backend.auth import sessions
from backend.auth.principal import CurrentUser
from backend.db.session import on_commit, transaction

__all__ = [
    "Admin",
    "AnyUser",
    "AvailableUser",
    "Conn",
    "CurrentUser",
    "UserRole",
    "current_user",
    "get_conn",
    "get_owned",
    "require_admin",
    "require_domain_available",
    "require_user",
]


async def get_conn(request: Request) -> AsyncIterator[AsyncConnection]:
    """One transaction per request: committed when the handler returns, rolled back on error.

    `on_commit` callbacks (wakes, bus events) run after the commit.
    """
    async with transaction(request.app.state.engine) as conn:
        yield conn


# `scope="function"` commits before the response is sent, so a client never sees a response
# whose writes aren't visible yet. Routes take `conn: Conn`.
Conn = Annotated[AsyncConnection, Depends(get_conn, scope="function")]


async def current_user(request: Request, conn: Conn) -> CurrentUser:
    cookie = request.cookies.get(sessions.COOKIE_NAME)
    resolved = await sessions.resolve_session(conn, cookie) if cookie else None
    # The human-session boundary: every request principal is a human account. A service
    # account (a group's technical owner) stores role='user' but never passes here. Agent
    # execs authenticate through `api/internal.exec_caller`, not this dependency.
    if resolved is None or not resolved.user.is_human:
        raise ApiError(401, "unauthenticated")
    if resolved.slid:
        request.state.refresh_session = cookie  # re-sent by the client-check middleware
    return resolved.user


AnyUser = Annotated[CurrentUser, Depends(current_user)]


async def require_user(user: AnyUser) -> CurrentUser:
    if user.role != "user" or not user.is_human:
        raise ApiError(403, "forbidden")
    return user


async def require_admin(user: AnyUser) -> CurrentUser:
    if not user.is_admin:
        raise ApiError(403, "forbidden")
    return user


def check_domain_available(user: CurrentUser) -> None:
    if user.domain_status != "available":
        raise ApiError(503, "domain_unavailable")


UserRole = Annotated[CurrentUser, Depends(require_user)]
Admin = Annotated[CurrentUser, Depends(require_admin)]


async def require_domain_available(user: UserRole) -> CurrentUser:
    check_domain_available(user)
    return user


AvailableUser = Annotated[CurrentUser, Depends(require_domain_available)]


async def get_owned(
    conn: AsyncConnection,
    table: Table,
    row_id: Any,
    user: CurrentUser,
    *,
    allow_admin: bool = False,
) -> Any:
    """The row of `table` with this id owned by `user` (`user_id` column), else 404.

    A row of another user and a missing row give the same response, so existence is never
    confirmed. `allow_admin` lets an admin read any user's row (folder viewer, catalogs).
    """
    if isinstance(row_id, str):
        try:
            row_id = uuid.UUID(row_id)
        except ValueError:
            raise ApiError(404, "not_found") from None
    query = select(table).where(table.c.id == row_id)
    if not (allow_admin and user.is_admin):
        query = query.where(table.c.user_id == user.id)
    row = (await conn.execute(query)).one_or_none()
    if row is None:
        raise ApiError(404, "not_found")
    return row


def after_commit_runtime(request: Request, conn: AsyncConnection, call) -> None:
    """Once `conn` commits, run `call(harness)` (a coroutine) if the harness is running."""
    harness = getattr(request.app.state, "harness", None)
    if harness is None:
        return

    def schedule() -> None:
        import asyncio

        asyncio.get_running_loop().create_task(call(harness))

    on_commit(conn, schedule)
