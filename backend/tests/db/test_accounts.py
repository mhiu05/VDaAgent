"""Boot step 5: make sure the admin exists (doc 12 "First admin")."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from backend import accounts
from backend.auth import passwords
from backend.db import tables as t


async def _admins(conn):
    q = select(t.users).where(t.users.c.role == "admin")
    return (await conn.execute(q)).all()


async def test_creates_the_admin_once(conn):
    created = await accounts.ensure_admin(conn, "Admin", "admin-password-1")
    assert created is True
    [admin] = await _admins(conn)
    assert admin.username == "admin"  # stored lower-case
    assert admin.domain_id is None
    assert admin.status == "active"
    assert passwords.verify_password(admin.password_hash, "admin-password-1")

    assert await accounts.ensure_admin(conn, "admin", "a-new-password") is False
    [again] = await _admins(conn)
    assert again.password_hash == admin.password_hash  # an existing admin is left alone


async def test_existing_admin_with_another_name_counts(conn, rows):
    await rows.user(role="admin", username="root")
    assert await accounts.ensure_admin(conn, "admin", "pw") is False
    assert (await conn.execute(select(func.count()).select_from(t.users))).scalar() == 1


async def test_username_taken_by_a_user_fails_the_boot(conn, rows):
    await rows.user(username="admin")
    with pytest.raises(RuntimeError, match="ADMIN_USERNAME"):
        await accounts.ensure_admin(conn, "admin", "pw")


async def test_invalid_admin_username_fails_by_key_name(conn):
    with pytest.raises(RuntimeError, match="ADMIN_USERNAME") as info:
        await accounts.ensure_admin(conn, "a b", "the-password")
    assert "the-password" not in str(info.value)
