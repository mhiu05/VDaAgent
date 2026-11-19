"""Phase 4: current room membership and explicit AI targeting."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, update

from backend import groups
from backend.db import tables as t
from backend.tests.api.test_threads_api import app  # noqa: F401 (fixture)


@pytest.fixture
def group_app(app):  # noqa: F811
    app.state.harness.jobs = SimpleNamespace(kick=lambda: None)
    return app


async def _setup(group_app, accounts, rows, conn):
    alice = await accounts.user("alice")
    bob = await accounts.user("bobby")
    async with await accounts.login("alice") as c:
        response = await c.post("/api/groups", json={"name": "Sales Team"})
    assert response.status_code == 202
    group = response.json()["group"]
    owner = await conn.scalar(
        select(t.groups.c.technical_owner_id).where(t.groups.c.id == group["id"])
    )
    return alice, bob, group, owner


async def _ready(conn, rows, owner):
    lead = await rows.agent(owner, slug="lead", is_lead=True, origin="lead")
    worker = await rows.agent(owner, slug="data", origin="starter")
    await groups.attach_lead_to_room(conn, owner)
    await conn.execute(update(t.users).where(t.users.c.id == owner).values(status="active"))
    return lead, worker


async def _deliveries(conn):
    return (await conn.execute(select(t.deliveries))).all()


async def test_human_room_messages_make_no_agent_deliveries(group_app, accounts, rows, conn):
    _, bob, group, owner = await _setup(group_app, accounts, rows, conn)
    lead, worker = await _ready(conn, rows, owner)
    async with await accounts.login("alice") as c:
        assert (
            await c.post(f"/api/groups/{group['id']}/members", json={"user_id": str(bob)})
        ).status_code == 201
        r = await c.post(
            f"/api/threads/{group['room_thread_id']}/messages", data={"text": "Chào Bob"}
        )
        assert r.status_code == 201 and r.json()["target"] is None
        assert (await c.get("/api/threads")).json()[0]["group"]["id"] == group["id"]
    async with await accounts.login("bobby") as c:
        r = await c.post(
            f"/api/threads/{group['room_thread_id']}/messages",
            data={"text": "Chào Alice", "target": "group"},
        )
        assert r.status_code == 201
        history = (await c.get(f"/api/threads/{group['room_thread_id']}/messages")).json()
        assert [m["text"] for m in history] == ["Chào Bob", "Chào Alice"]
    assert await _deliveries(conn) == []
    assert group_app.state.harness.jev.scheduled == []
    assert group_app.state.harness.woken == []
    assert {lead, worker}.isdisjoint({d.agent_id for d in await _deliveries(conn)})


async def test_room_message_uses_group_channel_and_internal_uses_owner_only(
    group_app, accounts, rows, conn
):
    from backend.messaging.messages import post_message

    _, _, group, owner = await _setup(group_app, accounts, rows, conn)
    lead, worker = await _ready(conn, rows, owner)
    owner_events = group_app.state.harness.bus.subscribe(owner)
    member_events = group_app.state.harness.bus.subscribe("alice")
    group_events = group_app.state.harness.bus.subscribe("unused")
    group_app.state.harness.bus.unsubscribe("unused", group_events)
    group_app.state.harness.bus.subscribe_group(owner, group_events)
    async with await accounts.login("alice") as c:
        assert (
            await c.post(f"/api/threads/{group['room_thread_id']}/messages", data={"text": "hello"})
        ).status_code == 201
    assert owner_events.get_nowait()["type"] == "message.created"
    public = group_events.get_nowait()
    assert public["type"] == "message.created"
    assert public["group_owner"] == str(owner)
    assert public["data"]["text"] == "hello"
    assert member_events.empty()
    internal = await rows.thread(owner, kind="agent", member_key="data+lead")
    await rows.insert(t.thread_members, thread_id=internal, member_type="agent", member_id=lead)
    await rows.insert(t.thread_members, thread_id=internal, member_type="agent", member_id=worker)
    await post_message(
        group_app.state.harness,
        conn,
        thread_id=internal,
        sender_type="agent",
        sender_id=lead,
        content={"text": "private analysis"},
    )
    assert owner_events.get_nowait()["data"]["text"] == "private analysis"
    assert group_events.empty()


async def test_ai_request_only_reaches_group_lead_and_requires_readiness(
    group_app, accounts, rows, conn
):
    _, _, group, owner = await _setup(group_app, accounts, rows, conn)
    url = f"/api/threads/{group['room_thread_id']}/messages"
    async with await accounts.login("alice") as c:
        r = await c.post(url, data={"text": "Analyze", "target": "lead"})
        assert (r.status_code, r.json()["error"]) == (409, "group_ai_unavailable")
    assert await conn.scalar(select(func.count()).select_from(t.messages)) == 0
    lead, worker = await _ready(conn, rows, owner)
    async with await accounts.login("alice") as c:
        r = await c.post(url, data={"text": "Analyze", "target": "lead"})
        assert r.status_code == 201 and r.json()["target"] == "lead"
    deliveries = await _deliveries(conn)
    assert len(deliveries) == 1
    assert (deliveries[0].agent_id, deliveries[0].route) == (lead, "jev")
    assert deliveries[0].agent_id != worker
    assert group_app.state.harness.jev.scheduled == [deliveries[0].id]
    assert await conn.scalar(select(func.count()).select_from(t.messages)) == 1


async def test_member_only_room_and_internal_thread_access(group_app, accounts, rows, conn):
    _, _, group, owner = await _setup(group_app, accounts, rows, conn)
    lead, worker = await _ready(conn, rows, owner)
    internal = await rows.thread(owner, kind="agent", member_key="data+lead")
    await rows.insert(t.thread_members, thread_id=internal, member_type="agent", member_id=lead)
    await rows.insert(t.thread_members, thread_id=internal, member_type="agent", member_id=worker)
    await rows.message(internal, sender_type="agent", sender_id=worker, content={"text": "secret"})
    async with await accounts.login("bobby") as c:
        assert (await c.get(f"/api/threads/{group['room_thread_id']}/messages")).status_code == 404
        assert (
            await c.post(f"/api/threads/{group['room_thread_id']}/messages", data={"text": "x"})
        ).status_code == 404
    async with await accounts.login("alice") as c:
        assert (
            await c.patch(f"/api/threads/{group['room_thread_id']}", json={"name": "x"})
        ).status_code == 409
        assert (await c.get(f"/api/threads/{internal}/messages")).status_code == 404
        assert all(th["id"] != str(internal) for th in (await c.get("/api/threads")).json())
        assert (await c.get(f"/api/threads/{group['room_thread_id']}/messages")).json() == []


async def test_personal_target_is_rejected_and_personal_delivery_unchanged(
    group_app, accounts, rows, conn
):
    alice = await accounts.user("alice")
    agent = await rows.agent(alice, slug="data")
    thread = await rows.thread(alice, kind="direct", member_key="data")
    await rows.insert(t.thread_members, thread_id=thread, member_type="user", member_id=alice)
    await rows.insert(t.thread_members, thread_id=thread, member_type="agent", member_id=agent)
    async with await accounts.login("alice") as c:
        url = f"/api/threads/{thread}/messages"
        assert (await c.post(url, data={"text": "x", "target": "lead"})).status_code == 400
        assert (await c.post(url, data={"text": "x"})).status_code == 201
    assert len(await _deliveries(conn)) == 1


async def test_agent_mentions_route_through_the_group_lead_only(group_app, accounts, rows, conn):
    from backend.harness.items import pending_deliveries_work

    alice, _, group, owner = await _setup(group_app, accounts, rows, conn)
    url = f"/api/threads/{group['room_thread_id']}/messages"
    async with await accounts.login("alice") as c:  # not ready yet: no silent AI request
        r = await c.post(url, data={"text": "@Data số liệu", "mention": "data"})
        assert (r.status_code, r.json()["error"]) == (409, "group_ai_unavailable")
    lead, worker = await _ready(conn, rows, owner)
    await rows.agent(alice, slug="insight")  # Alice's personal agent
    other = await rows.user(username="svc.othergroup0001", account_type="service")
    await rows.agent(other, slug="chart")  # another group's agent

    async def deliveries_since(before):
        return [d for d in await _deliveries(conn) if d.id > before]

    async with await accounts.login("alice") as c:
        # MENTION-1: a normal message wakes nobody
        assert (await c.post(url, data={"text": "Chào cả nhóm"})).status_code == 201
        assert await _deliveries(conn) == []
        # MENTION-2: @Lead is the same as Hỏi AI
        r = await c.post(url, data={"text": "@Lead tóm tắt", "mention": "lead"})
        assert r.status_code == 201
        assert r.json()["target"] == "lead" and r.json()["mention"]["slug"] == "lead"
        [d] = await deliveries_since(0)
        assert (d.agent_id, d.route) == (lead, "jev")
        # MENTION-3/5: @Data still wakes only the lead, with the requested teammate attached
        r = await c.post(url, data={"text": "@Data lấy số liệu", "mention": "Data"})
        assert r.status_code == 201
        assert r.json()["mention"] == {"slug": "data", "name": r.json()["mention"]["name"]}
        [d2] = await deliveries_since(d.id)
        assert d2.agent_id == lead and d2.agent_id != worker
        # MENTION-6/7/8: only this group's own team can be mentioned
        for bad in ("insight", "chart", "nobody", "lead​"):
            r = await c.post(url, data={"text": "x", "mention": bad})
            assert (r.status_code, r.json()["error"]) == (400, "invalid_agent_mention"), bad
        r = await c.post(url, data={"text": "x", "mention": "data", "target": "group"})
        assert r.status_code == 400
    assert len(await deliveries_since(d2.id)) == 0
    assert await conn.scalar(select(func.count()).select_from(t.messages)) == 3
    members = (
        (
            await conn.execute(
                select(t.thread_members.c.member_id).where(
                    t.thread_members.c.thread_id == group["room_thread_id"],
                    t.thread_members.c.member_type == "agent",
                )
            )
        )
        .scalars()
        .all()
    )
    assert members == [lead]  # the mentioned worker never joins the room
    # the lead is told which teammate was asked for (only for the @Data request)
    await conn.execute(update(t.deliveries).values(status="pending"))
    lead_row = (await conn.execute(select(t.agents).where(t.agents.c.id == lead))).one()
    work = await pending_deliveries_work(conn, lead_row)
    assert [b.count("requested_agent: data") for b in work.blocks] == [0, 1]


async def test_personal_threads_take_no_mention(group_app, accounts, rows, conn):
    alice = await accounts.user("alice")
    agent = await rows.agent(alice, slug="data")
    thread = await rows.thread(alice, kind="direct", member_key="data")
    await rows.insert(t.thread_members, thread_id=thread, member_type="user", member_id=alice)
    await rows.insert(t.thread_members, thread_id=thread, member_type="agent", member_id=agent)
    async with await accounts.login("alice") as c:
        url = f"/api/threads/{thread}/messages"
        assert (await c.post(url, data={"text": "x", "mention": "data"})).status_code == 400
        assert (await c.post(url, data={"text": "x"})).status_code == 201
    assert len(await _deliveries(conn)) == 1
