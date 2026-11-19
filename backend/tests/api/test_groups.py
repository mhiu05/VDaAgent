"""Group lifecycle, membership, and human-only API access."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from backend.db import tables as t
from backend.harness.bus import EventBus

URL = "/api/groups"


@pytest.fixture
def app(make_app):
    app = make_app()
    app.state.harness = SimpleNamespace(bus=EventBus(), jobs=SimpleNamespace(kick=lambda: None))
    return app


async def _create(accounts, username="alice", name="Sales Team"):
    async with await accounts.login(username) as c:
        r = await c.post(URL, json={"name": name})
    assert r.status_code == 202, r.text
    return r.json()["group"]


async def _count(conn, table):
    return await conn.scalar(select(func.count()).select_from(table))


async def test_create_is_one_owner_group_room_and_human_membership(app, accounts, conn):
    alice = await accounts.user("alice")
    events = app.state.harness.bus.subscribe(alice)
    group = await _create(accounts, name=" Sales Team ")
    gid = uuid.UUID(group["id"])
    owner = (await conn.execute(select(t.users).where(t.users.c.username.like("svc.%")))).one()
    row = (await conn.execute(select(t.groups).where(t.groups.c.id == gid))).one()
    room = (
        await conn.execute(select(t.threads).where(t.threads.c.id == group["room_thread_id"]))
    ).one()
    gm = (await conn.execute(select(t.group_members))).one()
    tm = (await conn.execute(select(t.thread_members))).one()
    assert (await _count(conn, t.groups), await _count(conn, t.threads)) == (1, 1)
    assert (owner.account_type, owner.role, owner.domain_id, owner.status) == (
        "service",
        "user",
        "fabrikam",
        "provisioning",
    )
    assert owner.password_hash == "!service-account-no-login"
    assert owner.display_name == "Sales Team"
    assert (row.technical_owner_id, row.created_by_user_id, row.name) == (
        owner.id,
        alice,
        "Sales Team",
    )
    assert (room.kind, room.user_id, room.name) == ("group", owner.id, "Sales Team")
    assert (gm.group_id, gm.user_id) == (gid, alice)
    assert (tm.thread_id, tm.member_type, tm.member_id) == (room.id, "user", alice)
    assert await _count(conn, t.agents) == 0
    job = (await conn.execute(select(t.jobs))).one()
    assert (job.user_id, job.kind, job.status, job.request) == (
        owner.id,
        "user_provision",
        "queued",
        {"domain_id": "fabrikam"},
    )
    assert group["ai_available"] is False
    assert group["members"] == [{"id": str(alice), "username": "alice", "display_name": ""}]
    assert events.get_nowait() == {"type": "groups.changed", "data": {"group_id": str(gid)}}


async def test_list_detail_and_nonmember_authorization(accounts):
    await accounts.user("alice")
    await accounts.user("bobby")
    group = await _create(accounts)
    gid = group["id"]
    async with await accounts.login("alice") as c:
        assert (await c.get(URL)).json() == [group]
        assert (await c.get(f"{URL}/{gid}")).json() == group
    async with await accounts.login("bobby") as c:
        assert (await c.get(URL)).json() == []
        missing = await c.get(f"{URL}/{gid}")
        assert (missing.status_code, missing.json()["error"]) == (404, "not_found")
        assert (await c.get(f"{URL}/{uuid.uuid4()}")).json() == missing.json()
        assert (
            await c.post(f"{URL}/{gid}/members", json={"user_id": str(uuid.uuid4())})
        ).status_code == 404
        assert (await c.delete(f"{URL}/{gid}/members/{uuid.uuid4()}")).status_code == 404


async def test_add_existing_human_updates_only_two_membership_tables(app, accounts, conn):
    alice = await accounts.user("alice")
    bob = await accounts.user("bobby", domain="other")
    group = await _create(accounts)
    gid, room_id = group["id"], group["room_thread_id"]
    alice_events = app.state.harness.bus.subscribe(alice)
    bob_events = app.state.harness.bus.subscribe(bob)
    users_before = await _count(conn, t.users)
    bob_before = (await conn.execute(select(t.users).where(t.users.c.id == bob))).one()
    async with await accounts.login("alice") as c:
        r = await c.post(f"{URL}/{gid}/members", json={"user_id": str(bob)})
        assert r.status_code == 201
        assert {m["id"] for m in r.json()["members"]} == {str(alice), str(bob)}
        again = await c.post(f"{URL}/{gid}/members", json={"user_id": str(bob)})
        assert (again.status_code, again.json()["error"]) == (409, "already_member")
    assert (await _count(conn, t.group_members), await _count(conn, t.thread_members)) == (2, 2)
    assert await _count(conn, t.agents) == 0
    assert await _count(conn, t.users) == users_before
    assert (await conn.execute(select(t.users).where(t.users.c.id == bob))).one() == bob_before
    assert {
        (r.member_type, r.member_id)
        for r in (
            await conn.execute(
                select(t.thread_members).where(t.thread_members.c.thread_id == room_id)
            )
        )
    } == {("user", alice), ("user", bob)}
    changed = {"type": "groups.changed", "data": {"group_id": gid}}
    assert alice_events.get_nowait() == changed
    assert bob_events.get_nowait() == changed
    assert alice_events.empty() and bob_events.empty()
    async with await accounts.login("bobby") as c:
        assert (await c.get(f"{URL}/{gid}")).status_code == 200


async def test_add_rejects_service_admin_and_nonactive(accounts, conn):
    await accounts.user("alice")
    admin = await accounts.admin()
    disabled = await accounts.user("carol", status="disabled")
    failed = await accounts.user("david", status="failed")
    pending = await accounts.user("emily", status="provisioning")
    group = await _create(accounts)
    owner = await conn.scalar(
        select(t.groups.c.technical_owner_id).where(t.groups.c.id == group["id"])
    )
    async with await accounts.login("alice") as c:
        for target in (owner, admin, disabled, failed, pending, uuid.uuid4()):
            r = await c.post(f"{URL}/{group['id']}/members", json={"user_id": str(target)})
            assert (r.status_code, r.json()["error"]) == (404, "user_not_found")
    assert (await _count(conn, t.group_members), await _count(conn, t.thread_members)) == (1, 1)


async def test_remove_member_and_last_member_guard(app, accounts, conn):
    alice = await accounts.user("alice")
    bob = await accounts.user("bobby")
    group = await _create(accounts)
    gid = group["id"]
    async with await accounts.login("alice") as c:
        assert (await c.post(f"{URL}/{gid}/members", json={"user_id": str(bob)})).status_code == 201
    alice_events = app.state.harness.bus.subscribe(alice)
    bob_events = app.state.harness.bus.subscribe(bob)
    async with await accounts.login("bobby") as c:
        r = await c.delete(f"{URL}/{gid}/members/{alice}")
        assert r.status_code == 204  # any current member may remove another
        assert (await c.get(f"{URL}/{gid}")).status_code == 200
        last = await c.delete(f"{URL}/{gid}/members/{bob}")
        assert (last.status_code, last.json()["error"]) == (409, "last_member")
        missing = await c.delete(f"{URL}/{gid}/members/{alice}")
        assert (missing.status_code, missing.json()["error"]) == (404, "not_found")
    assert (await _count(conn, t.group_members), await _count(conn, t.thread_members)) == (1, 1)
    assert await _count(conn, t.groups) == 1
    assert await _count(conn, t.users) == 3
    assert await conn.scalar(select(t.group_members.c.user_id)) == bob
    assert await conn.scalar(select(t.thread_members.c.member_id)) == bob
    changed = {"type": "groups.changed", "data": {"group_id": gid}}
    assert alice_events.get_nowait() == changed
    assert bob_events.get_nowait() == changed
    assert alice_events.empty() and bob_events.empty()
    async with await accounts.login("alice") as c:
        assert (await c.get(f"{URL}/{gid}")).status_code == 404


async def test_member_candidates_are_limited_active_humans(accounts, conn):
    await accounts.user("alice")
    await accounts.user("bobby", display_name="Bobby Brown")
    await accounts.user("carol", status="disabled", display_name="Bob")
    await accounts.user("david", status="failed", display_name="Bob")
    await accounts.admin("admin")
    await accounts.user("svc.0123456789abcdef", account_type="service")
    async with await accounts.login("alice") as c:
        rows = (await c.get(f"{URL}/member-candidates?q=bob")).json()
        assert [(r["username"], set(r)) for r in rows] == [
            ("bobby", {"id", "username", "display_name"})
        ]
        assert len((await c.get(f"{URL}/member-candidates?q=")).json()) <= 20
    assert await _count(conn, t.users) == 6


async def test_group_routes_require_a_human_user(accounts, client):
    await accounts.admin("admin")
    for method, path, body in (
        ("get", URL, None),
        ("post", URL, {"name": "Test"}),
        ("get", f"{URL}/member-candidates", None),
    ):
        r = (
            await getattr(client, method)(path, json=body)
            if body
            else await getattr(client, method)(path)
        )
        assert (r.status_code, r.json()["error"]) == (401, "unauthenticated")
    async with await accounts.login("admin") as c:
        for path in (URL, f"{URL}/member-candidates", f"{URL}/{uuid.uuid4()}"):
            r = await c.get(path)
            assert (r.status_code, r.json()["error"]) == (403, "forbidden")
        assert (await c.post(URL, json={"name": "Test"})).status_code == 403


async def test_name_validation(accounts):
    await accounts.user("alice")
    async with await accounts.login("alice") as c:
        for name in ("", "   ", "x" * 101):
            r = await c.post(URL, json={"name": name})
            assert (r.status_code, r.json()["error"]) == (400, "invalid_request")
