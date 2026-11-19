"""Cookie sessions in `auth_sessions` (doc 12 "Login"): hashed tokens, sliding 7-day expiry."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from backend.auth import sessions
from backend.db import tables as t

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


async def _row(conn, cookie):
    digest = hashlib.sha256(sessions.decode_token(cookie)).digest()
    q = select(t.auth_sessions).where(t.auth_sessions.c.token_hash == digest)
    return (await conn.execute(q)).one_or_none()


async def test_create_stores_only_the_sha256_of_the_token(conn, rows):
    user = await rows.user()
    cookie = await sessions.create_session(conn, user, now=T0)
    stored = (await conn.execute(select(t.auth_sessions))).all()
    assert len(stored) == 1
    row = stored[0]
    assert row.token_hash == sessions.hash_token(cookie)
    assert row.token_hash != sessions.decode_token(cookie)
    assert row.user_id == user
    assert row.expires_at == T0 + timedelta(days=7)
    assert row.last_seen_at == T0


async def test_resolve_returns_the_user_and_domain(conn, rows):
    await rows.domain("fabrikam", name="Fabrikam Sales Ops")
    user = await rows.user(domain_id="fabrikam", display_name="Alice")
    cookie = await sessions.create_session(conn, user, now=T0)
    got = await sessions.resolve_session(conn, cookie, now=T0 + timedelta(seconds=5))
    assert got is not None
    assert got.user.id == user
    assert got.user.role == "user"
    assert got.user.display_name == "Alice"
    assert got.user.domain == {
        "id": "fabrikam",
        "name": "Fabrikam Sales Ops",
        "status": "available",
    }
    assert got.slid is False


async def test_sliding_expiry_updates_at_most_once_per_minute(conn, rows):
    user = await rows.user()
    cookie = await sessions.create_session(conn, user, now=T0)

    got = await sessions.resolve_session(conn, cookie, now=T0 + timedelta(seconds=59))
    assert got.slid is False
    row = await _row(conn, cookie)
    assert row.last_seen_at == T0
    assert row.expires_at == T0 + timedelta(days=7)

    later = T0 + timedelta(minutes=3)
    got = await sessions.resolve_session(conn, cookie, now=later)
    assert got.slid is True
    assert got.expires_at == later + timedelta(days=7)
    row = await _row(conn, cookie)
    assert row.last_seen_at == later
    assert row.expires_at == later + timedelta(days=7)

    got = await sessions.resolve_session(conn, cookie, now=later + timedelta(seconds=30))
    assert got.slid is False


async def test_session_kept_alive_by_use_outlives_the_first_ttl(conn, rows):
    user = await rows.user()
    cookie = await sessions.create_session(conn, user, now=T0)
    for day in range(1, 15):
        assert await sessions.resolve_session(conn, cookie, now=T0 + timedelta(days=day))


async def test_expired_session_is_rejected_and_deleted(conn, rows):
    user = await rows.user()
    cookie = await sessions.create_session(conn, user, now=T0)
    assert await sessions.resolve_session(conn, cookie, now=T0 + timedelta(days=7)) is None
    assert await _row(conn, cookie) is None


async def test_unknown_and_malformed_tokens_resolve_to_none(conn, rows):
    await sessions.create_session(conn, await rows.user(), now=T0)
    other, _ = sessions.new_token()
    assert await sessions.resolve_session(conn, other, now=T0) is None
    assert await sessions.resolve_session(conn, "garbage", now=T0) is None
    assert await sessions.resolve_session(conn, "", now=T0) is None


async def test_disabled_user_session_does_not_resolve(conn, rows):
    user = await rows.user()
    cookie = await sessions.create_session(conn, user, now=T0)
    await conn.execute(update(t.users).where(t.users.c.id == user).values(status="disabled"))
    assert await sessions.resolve_session(conn, cookie, now=T0) is None


async def test_delete_session_and_all_of_a_users_sessions(conn, rows):
    alice, bob = await rows.user(), await rows.user()
    a1 = await sessions.create_session(conn, alice, now=T0)
    a2 = await sessions.create_session(conn, alice, now=T0)
    b1 = await sessions.create_session(conn, bob, now=T0)

    await sessions.delete_session(conn, a1)
    assert await _row(conn, a1) is None
    assert await _row(conn, a2) is not None

    assert await sessions.delete_user_sessions(conn, alice) == 1
    assert await _row(conn, a2) is None
    assert await _row(conn, b1) is not None
    await sessions.delete_session(conn, "garbage")  # no error


# --- service accounts (a group's technical owner) never hold a session (PLAN_GROUPCHAT §8) ---


async def test_human_accounts_get_sessions(conn, rows):
    user, admin = await rows.user(), await rows.user(role="admin")
    for account in (user, admin):
        got = await sessions.resolve_session(
            conn, await sessions.create_session(conn, account, now=T0), now=T0
        )
        assert got is not None and got.user.is_human and got.user.account_type == "human"


async def test_create_session_refuses_a_service_account(conn, rows):
    service = await rows.user(username="svc.0123456789abcdef", account_type="service")
    with pytest.raises(ValueError):
        await sessions.create_session(conn, service, now=T0)
    assert (await conn.execute(select(t.auth_sessions))).all() == []


async def test_a_forged_session_of_a_service_account_does_not_resolve(conn, rows):
    service = await rows.user(username="svc.0123456789abcdef", account_type="service")
    cookie, digest = sessions.new_token()
    await conn.execute(
        t.auth_sessions.insert().values(
            token_hash=digest,
            user_id=service,
            created_at=T0,
            last_seen_at=T0,
            expires_at=T0 + timedelta(days=7),
        )
    )
    assert await sessions.resolve_session(conn, cookie, now=T0) is None


async def test_a_session_stops_resolving_once_the_account_is_not_human(conn, rows):
    user = await rows.user()
    cookie = await sessions.create_session(conn, user, now=T0)
    await conn.execute(update(t.users).where(t.users.c.id == user).values(account_type="service"))
    assert await sessions.resolve_session(conn, cookie, now=T0) is None
