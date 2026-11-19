"""Cookie sessions (doc 12 "Login"): `contoso_session=<b64url 32 random bytes>`.

Only the SHA-256 of the token is stored (`auth_sessions.token_hash`). The TTL is 7 days and
slides: `last_seen_at` and `expires_at` move forward at most once per minute.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.auth.principal import CurrentUser, user_query
from backend.db import tables as t

COOKIE_NAME = "contoso_session"
TTL = timedelta(days=7)
SLIDE_EVERY = timedelta(minutes=1)
TOKEN_BYTES = 32


def new_token() -> tuple[str, bytes]:
    """(cookie value, SHA-256 digest to store)."""
    raw = secrets.token_bytes(TOKEN_BYTES)
    cookie = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    return cookie, hashlib.sha256(raw).digest()


def decode_token(cookie: str) -> bytes | None:
    if not cookie or len(cookie) != 43:
        return None
    try:
        raw = base64.urlsafe_b64decode(cookie + "=")
    except (binascii.Error, ValueError):
        return None
    if len(raw) != TOKEN_BYTES or base64.urlsafe_b64encode(raw).rstrip(b"=").decode() != cookie:
        return None
    return raw


def hash_token(cookie: str) -> bytes | None:
    raw = decode_token(cookie)
    return hashlib.sha256(raw).digest() if raw is not None else None


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


@dataclass(frozen=True)
class Resolved:
    user: CurrentUser
    expires_at: datetime
    slid: bool  # the expiry moved: the cookie should be sent again


async def create_session(
    conn: AsyncConnection, user_id: uuid.UUID, now: datetime | None = None
) -> str:
    account_type = await conn.scalar(select(t.users.c.account_type).where(t.users.c.id == user_id))
    if account_type != "human":
        raise ValueError("only human accounts can hold sessions")
    now = _now(now)
    cookie, digest = new_token()
    await conn.execute(
        t.auth_sessions.insert().values(
            token_hash=digest,
            user_id=user_id,
            created_at=now,
            last_seen_at=now,
            expires_at=now + TTL,
        )
    )
    return cookie


async def resolve_session(
    conn: AsyncConnection, cookie: str | None, now: datetime | None = None
) -> Resolved | None:
    """The session's user, or None (unknown, expired, the user is disabled or not human)."""
    digest = hash_token(cookie or "")
    if digest is None:
        return None
    now = _now(now)
    s = t.auth_sessions
    row = (
        await conn.execute(
            select(s.c.last_seen_at, s.c.expires_at, s.c.user_id).where(s.c.token_hash == digest)
        )
    ).one_or_none()
    if row is None:
        return None
    if row.expires_at <= now:
        await conn.execute(delete(s).where(s.c.token_hash == digest))
        return None
    user_row = (await conn.execute(user_query().where(t.users.c.id == row.user_id))).one_or_none()
    if user_row is None or user_row.status == "disabled" or user_row.account_type != "human":
        return None
    expires_at, slid = row.expires_at, False
    if now - row.last_seen_at >= SLIDE_EVERY:
        expires_at, slid = now + TTL, True
        await conn.execute(
            update(s)
            .where(s.c.token_hash == digest)
            .values(last_seen_at=now, expires_at=expires_at)
        )
    return Resolved(CurrentUser.from_row(user_row), expires_at, slid)


async def delete_session(conn: AsyncConnection, cookie: str | None) -> None:
    digest = hash_token(cookie or "")
    if digest is not None:
        await conn.execute(delete(t.auth_sessions).where(t.auth_sessions.c.token_hash == digest))


async def delete_user_sessions(conn: AsyncConnection, user_id: uuid.UUID) -> int:
    result = await conn.execute(delete(t.auth_sessions).where(t.auth_sessions.c.user_id == user_id))
    return result.rowcount
