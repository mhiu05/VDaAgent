"""API tests: the app without its lifespan, on the rolled-back test connection.

Requests go through `httpx.ASGITransport`, so they run on the test's event loop and share
the `conn` fixture (each request in its own savepoint, like a real request transaction).
"""

from __future__ import annotations

import httpx
import pytest
from argon2 import PasswordHasher
from sqlalchemy import update

from backend.api.deps import get_conn
from backend.auth import passwords
from backend.db import tables as t
from backend.main import create_app
from backend.settings import Settings
from backend.tests.db.conftest import rows  # noqa: F401  (shared row-factory fixture)

PASSWORD = "mật-khẩu-đúng-1"
# Exercise real Argon2 verification without paying production memory/CPU cost hundreds of
# times in API routing tests. Production parameters are covered by unit/test_passwords.py.
_TEST_HASHER = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1)
_HASH = _TEST_HASHER.hash(PASSWORD)


async def _noop(*args, **kwargs):
    return None


@pytest.fixture
def make_app(platform_env, conn, monkeypatch):
    monkeypatch.setattr(passwords, "_hasher", _TEST_HASHER)
    monkeypatch.setattr(passwords, "DUMMY_HASH", _TEST_HASHER.hash("unknown-test-account"))

    def _make(**overrides):
        settings = Settings(**overrides)
        app = create_app(settings, checks={}, migrate=_noop, boot=_noop)

        async def test_conn():
            async with conn.begin_nested():
                yield conn

        app.dependency_overrides[get_conn] = test_conn
        return app

    return _make


@pytest.fixture
def app(make_app):
    return make_app()


def client_for(app, *, csrf: bool = True) -> httpx.AsyncClient:
    headers = {"X-Contoso-Client": "web"} if csrf else {}
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    )


@pytest.fixture
async def client(app):
    async with client_for(app) as c:
        yield c


class _Reentrant(httpx.AsyncClient):
    """An AsyncClient that may be used first and entered with `async with` afterwards."""

    async def __aenter__(self):
        return self


class Accounts:
    """Users with a known password, and logged-in clients for them."""

    def __init__(self, app, conn, rows):  # noqa: F811
        self.app, self.conn, self.rows = app, conn, rows

    async def user(self, username="alice", domain="fabrikam", domain_status="available", **kw):
        exists = await self.conn.scalar(
            t.domains.select().with_only_columns(t.domains.c.id).where(t.domains.c.id == domain)
        )
        if not exists:
            await self.rows.domain(domain, name=f"Domain {domain}", status=domain_status)
        return await self.rows.user(username=username, domain_id=domain, password_hash=_HASH, **kw)

    async def admin(self, username="admin"):
        return await self.rows.user(username=username, role="admin", password_hash=_HASH)

    async def login(self, username) -> httpx.AsyncClient:
        """A logged-in client, usable as `async with await accounts.login(...)`."""
        # File-based test domains must go through the same import as `make up` before
        # exercising the DB-backed catalogs and provisioning paths.
        from pathlib import Path

        from backend.domains.import_from_files import _import_one

        root = Path(self.app.state.settings.DOMAINS_DIR)
        if root.is_dir():
            for directory in sorted(p for p in root.iterdir() if p.is_dir()):
                exists = await self.conn.scalar(
                    t.domains.select()
                    .with_only_columns(t.domains.c.id)
                    .where(t.domains.c.id == directory.name)
                )
                if exists:
                    await _import_one(self.conn, self.app.state.settings, directory)
        c = _Reentrant(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        c.headers["X-Contoso-Client"] = "web"
        r = await c.post("/api/auth/login", json={"username": username, "password": PASSWORD})
        assert r.status_code == 200, r.text
        return c

    async def set_status(self, user_id, status):
        await self.conn.execute(
            update(t.users).where(t.users.c.id == user_id).values(status=status)
        )


@pytest.fixture
def accounts(app, conn, rows):  # noqa: F811
    return Accounts(app, conn, rows)
