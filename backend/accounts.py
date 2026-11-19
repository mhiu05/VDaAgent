"""User accounts: the first admin (boot step 5) and admin user management (doc 12).

Creating a user inserts `users(status='provisioning')` and queues one `user_provision` job.
The job's work (lead + starters, then `status='active'`) is the job worker's, in S9.
"""

from __future__ import annotations

import logging
import re
import uuid

from sqlalchemy import delete, exists, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.agents import jobs
from backend.api.errors import ApiError
from backend.auth import passwords, sessions
from backend.auth.principal import CurrentUser, user_query
from backend.db import tables as t
from backend.notifications import notify

log = logging.getLogger("uvicorn.error")

USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")
# Usernames of technical (service) accounts, which own a group's agents (PLAN_GROUPCHAT §5).
SERVICE_PREFIX = "svc."


class UsernameTaken(Exception):
    pass


def is_reserved_username(username: str) -> bool:
    return username.startswith(SERVICE_PREFIX)


def normalize_username(username: str) -> str:
    """Usernames are stored lower-case (doc 10); creation and login lower-case first."""
    return username.strip().lower()


async def ensure_admin(conn: AsyncConnection, username: str, password: str) -> bool:
    """Create the admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD` if no admin exists.

    Returns True when one was created. Errors name the key, never the value of the password.
    """
    if await conn.scalar(select(exists().where(t.users.c.role == "admin"))):
        return False
    name = normalize_username(username)
    if not USERNAME_RE.fullmatch(name):
        raise RuntimeError("ADMIN_USERNAME must match ^[a-z0-9._-]{3,32}$ (lower-cased)")
    if await conn.scalar(select(exists().where(t.users.c.username == name))):
        raise RuntimeError("ADMIN_USERNAME is already taken by a user account")
    await conn.execute(
        t.users.insert().values(
            username=name,
            password_hash=passwords.hash_password(password),
            role="admin",
            status="active",
        )
    )
    log.info("admin created: %s", name)
    return True


async def get_user(conn: AsyncConnection, user_id: uuid.UUID) -> CurrentUser | None:
    """A human `user`-role account (admins and service accounts aren't managed through the
    admin user routes)."""
    u = t.users
    row = (
        await conn.execute(
            user_query().where(u.c.id == user_id, u.c.role == "user", u.c.account_type == "human")
        )
    ).one_or_none()
    return CurrentUser.from_row(row) if row else None


async def list_users(conn: AsyncConnection) -> list[CurrentUser]:
    u = t.users
    q = user_query().where(u.c.role == "user", u.c.account_type == "human").order_by(u.c.username)
    return [CurrentUser.from_row(r) for r in (await conn.execute(q)).all()]


async def create_user(
    conn: AsyncConnection, username: str, password: str, domain_id: str, display_name: str = ""
) -> tuple[uuid.UUID, uuid.UUID]:
    """Insert a provisioning user, its provisioning job and its welcome notification.

    Returns (user_id, job_id). Raises `UsernameTaken`, or `ValueError` for a reserved name.
    """
    if is_reserved_username(username):
        raise ValueError("reserved username")
    if await conn.scalar(select(exists().where(t.users.c.username == username))):
        raise UsernameTaken(username)
    user_id = await conn.scalar(
        t.users.insert()
        .values(
            username=username,
            display_name=display_name,
            password_hash=passwords.hash_password(password),
            role="user",
            domain_id=domain_id,
            status="provisioning",
        )
        .returning(t.users.c.id)
    )
    job_id = await conn.scalar(
        t.jobs.insert()
        .values(
            user_id=user_id,
            kind="user_provision",
            request={"domain_id": domain_id},
            status="queued",
        )
        .returning(t.jobs.c.id)
    )
    await notify(conn, user_id, "account_created")
    return user_id, job_id


async def requeue_provisioning(
    h: object, conn: AsyncConnection, account_id: uuid.UUID, domain_id: str
) -> uuid.UUID:
    """Retry a failed existing user_provision job for a human or technical owner."""
    user = (
        await conn.execute(
            select(t.users.c.status).where(t.users.c.id == account_id).with_for_update()
        )
    ).one()
    running = await conn.scalar(
        select(
            exists().where(
                t.jobs.c.user_id == account_id,
                t.jobs.c.kind == "user_provision",
                t.jobs.c.status.in_(("queued", "running")),
            )
        )
    )
    if running:
        raise ApiError(409, "job_running")
    if user.status != "failed":
        raise ApiError(409, "invalid_state", "Chỉ thử lại được người dùng tạo lỗi.")
    await conn.execute(
        update(t.users)
        .where(t.users.c.id == account_id)
        .values(status="provisioning", status_detail=None)
    )
    return await jobs.enqueue(
        h,
        conn,
        user_id=account_id,
        kind="user_provision",
        request={"domain_id": domain_id},
    )


PROVISIONING_UNFINISHED = "provisioning did not finish; use retry"


async def set_disabled(conn: AsyncConnection, user: CurrentUser, disabled: bool) -> None:
    """Disable: `status='disabled'`, delete every session, notify. Enable: `status='active'`.

    No-ops when the user is already in that state. Stopping and starting runners is the
    supervisor's (S5b).
    """
    if disabled and user.status != "disabled":
        await _set_status(conn, user.id, "disabled")
        await sessions.delete_user_sessions(conn, user.id)
        # a linked Telegram chat is another way in: unlink it with the sessions
        await conn.execute(delete(t.telegram_links).where(t.telegram_links.c.user_id == user.id))
        await conn.execute(
            delete(t.telegram_link_codes).where(t.telegram_link_codes.c.user_id == user.id)
        )
        await notify(conn, user.id, "account_disabled")
    elif not disabled and user.status == "disabled":
        has_lead = await conn.scalar(
            select(exists().where(t.agents.c.user_id == user.id, t.agents.c.is_lead.is_(True)))
        )
        if has_lead:
            await _set_status(conn, user.id, "active")
        else:  # disabled before provisioning finished: the admin's retry continues it
            await conn.execute(
                update(t.users)
                .where(t.users.c.id == user.id)
                .values(status="failed", status_detail=PROVISIONING_UNFINISHED)
            )


async def reset_password(conn: AsyncConnection, user: CurrentUser, password: str) -> None:
    await conn.execute(
        update(t.users)
        .where(t.users.c.id == user.id)
        .values(password_hash=passwords.hash_password(password))
    )
    await sessions.delete_user_sessions(conn, user.id)
    await notify(conn, user.id, "password_reset")


async def _set_status(conn: AsyncConnection, user_id: uuid.UUID, status: str) -> None:
    await conn.execute(update(t.users).where(t.users.c.id == user_id).values(status=status))
