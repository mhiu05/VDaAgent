"""Roles and ownership (doc 12 "Roles and authorization") and the domain-unavailable check.

The real user-scoped routes come with later sections; these tests mount small routes that use
the same dependencies those routes will use.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import APIRouter

from backend.api.deps import Admin, AnyUser, AvailableUser, Conn, UserRole, get_owned
from backend.db import tables as t


@pytest.fixture
def app(make_app):
    app = make_app()
    router = APIRouter(prefix="/api/_test")

    @router.get("/agents/{agent_id}")
    async def get_agent(agent_id: uuid.UUID, user: UserRole, conn: Conn):
        row = await get_owned(conn, t.agents, agent_id, user)
        return {"id": str(row.id), "slug": row.slug}

    @router.get("/folders/{agent_id}")
    async def folder(agent_id: uuid.UUID, user: AnyUser, conn: Conn):
        row = await get_owned(conn, t.agents, agent_id, user, allow_admin=True)
        return {"id": str(row.id)}

    @router.post("/threads/{thread_id}/messages")
    async def post_message(thread_id: uuid.UUID, user: AvailableUser):
        return {"ok": True}

    @router.get("/admin/ping")
    async def admin_ping(user: Admin):
        return {"ok": True}

    app.include_router(router)
    return app


async def test_another_users_resource_is_404(accounts, rows):
    alice = await accounts.user("alice")
    await accounts.user("bobby")
    agent = await rows.agent(alice, slug="data")
    async with await accounts.login("alice") as c:
        r = await c.get(f"/api/_test/agents/{agent}")
        assert (r.status_code, r.json()["slug"]) == (200, "data")
    async with await accounts.login("bobby") as c:
        r = await c.get(f"/api/_test/agents/{agent}")
        assert r.status_code == 404
        assert r.json()["error"] == "not_found"
        missing = await c.get(f"/api/_test/agents/{uuid.uuid4()}")
        assert missing.json() == r.json()  # same as a resource that doesn't exist


async def test_admin_may_read_any_folder_but_not_user_routes(accounts, rows):
    alice = await accounts.user("alice")
    await accounts.admin()
    agent = await rows.agent(alice)
    async with await accounts.login("admin") as c:
        assert (await c.get(f"/api/_test/folders/{agent}")).status_code == 200
        r = await c.get(f"/api/_test/agents/{agent}")
        assert (r.status_code, r.json()["error"]) == (403, "forbidden")  # admins have no team


async def test_user_on_admin_route_is_403(accounts):
    await accounts.user("alice")
    async with await accounts.login("alice") as c:
        r = await c.get("/api/_test/admin/ping")
        assert r.status_code == 403
        assert r.json()["error"] == "forbidden"
        r = await c.get("/api/admin/users")
        assert r.status_code == 403


async def test_admin_route_without_session_is_401(client):
    r = await client.get("/api/_test/admin/ping")
    assert (r.status_code, r.json()["error"]) == (401, "unauthenticated")


async def test_admin_reaches_admin_route(accounts):
    await accounts.admin()
    async with await accounts.login("admin") as c:
        assert (await c.get("/api/_test/admin/ping")).json() == {"ok": True}


async def test_post_in_unavailable_domain_is_503(accounts):
    await accounts.user("alice")
    await accounts.user("carol", domain="re-marketing", domain_status="unavailable")
    tid = uuid.uuid4()
    async with await accounts.login("alice") as c:
        assert (await c.post(f"/api/_test/threads/{tid}/messages")).status_code == 200
    async with await accounts.login("carol") as c:
        r = await c.post(f"/api/_test/threads/{tid}/messages")
        assert r.status_code == 503
        assert r.json()["error"] == "domain_unavailable"
        assert r.json()["message"] == "Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên."


async def test_unknown_route_uses_the_error_shape(client):
    r = await client.get("/api/does-not-exist")
    assert r.status_code == 404
    assert set(r.json()) == {"error", "message"}
    assert r.json()["error"] == "not_found"
