"""Focused Fabrikam demo path across provisioning, room API, and open-stream revocation."""

from __future__ import annotations

from sqlalchemy import func, select

from backend import groups
from backend.api.stream import sse_events
from backend.catalog import seeds
from backend.db import tables as t
from backend.tests.api.test_group_provisioning import _seed_fabrikam, app, domains  # noqa: F401


class OpenRequest:
    async def is_disconnected(self) -> bool:
        return False


async def test_fabrikam_group_demo_path(app, accounts, rows, conn, domains):  # noqa: F811
    await _seed_fabrikam(conn)
    await seeds.upsert_catalogs(conn, app.state.settings, available=[])
    alice = await accounts.user("alice")
    bob = await accounts.user("bobby")
    for user_id in (alice, bob):
        for slug in ("lead", "data", "insight", "compare", "chart", "report"):
            await rows.agent(
                user_id,
                slug=slug,
                is_lead=slug == "lead",
                origin="lead" if slug == "lead" else "starter",
            )
    async with await accounts.login("alice") as client:
        created = await client.post("/api/groups", json={"name": "Sales Team"})
    assert created.status_code == 202
    group = created.json()["group"]
    owner = await conn.scalar(
        select(t.groups.c.technical_owner_id).where(t.groups.c.id == group["id"])
    )
    assert await app.state.harness.jobs.run_pending() == 1
    agents = (await conn.execute(select(t.agents).where(t.agents.c.user_id == owner))).all()
    assert len(agents) == 6
    lead = next(agent.id for agent in agents if agent.is_lead)
    assert (
        await conn.execute(
            select(t.thread_members.c.member_id).where(
                t.thread_members.c.thread_id == group["room_thread_id"],
                t.thread_members.c.member_type == "agent",
            )
        )
    ).scalars().all() == [lead]
    assert (
        await conn.scalar(
            select(func.count()).select_from(t.agents).where(t.agents.c.user_id.in_([alice, bob]))
        )
        == 12
    )
    async with await accounts.login("alice") as client:
        assert (
            await client.post(f"/api/groups/{group['id']}/members", json={"user_id": str(bob)})
        ).status_code == 201
    async with await accounts.login("bobby") as client:
        assert group["room_thread_id"] in [
            thread["id"] for thread in (await client.get("/api/threads")).json()
        ]

    async def member(user_id):
        async def check(group_owner):
            return await groups.is_current_member(conn, group_owner, user_id)

        return check

    bus = app.state.harness.bus
    alice_stream = sse_events(
        bus,
        alice,
        OpenRequest(),
        heartbeat_s=0.01,
        group_owners=(owner,),
        still_member=await member(alice),
    )
    bob_stream = sse_events(
        bus,
        bob,
        OpenRequest(),
        heartbeat_s=0.01,
        group_owners=(owner,),
        still_member=await member(bob),
    )
    await alice_stream.__anext__()
    await bob_stream.__anext__()
    room_url = f"/api/threads/{group['room_thread_id']}/messages"
    async with await accounts.login("alice") as client:
        hello = await client.post(room_url, data={"text": "Chào Bob"})
    assert hello.status_code == 201
    assert "Chào Bob" in await alice_stream.__anext__()
    assert "Chào Bob" in await bob_stream.__anext__()
    async with await accounts.login("bobby") as client:
        reply = await client.post(room_url, data={"text": "Chào Alice", "target": "group"})
        assert reply.status_code == 201
        assert [m["text"] for m in (await client.get(room_url)).json()] == [
            "Chào Bob",
            "Chào Alice",
        ]
    assert "Chào Alice" in await alice_stream.__anext__()
    assert "Chào Alice" in await bob_stream.__anext__()
    for message_id in (hello.json()["id"], reply.json()["id"]):
        assert (
            await conn.scalar(
                select(func.count())
                .select_from(t.deliveries)
                .where(t.deliveries.c.message_id == message_id)
            )
            == 0
        )
    # Runtime activation is covered by test_group_flow; this API fixture shares one
    # rollback connection and cannot run its JEV task concurrently with API assertions.
    app.state.harness.jev.schedule = lambda _delivery_id: None
    async with await accounts.login("alice") as client:
        ai = await client.post(room_url, data={"text": "Phân tích căn A12-08", "target": "lead"})
    assert ai.status_code == 201
    delivery = (
        await conn.execute(select(t.deliveries).where(t.deliveries.c.message_id == ai.json()["id"]))
    ).one()
    assert (delivery.agent_id, delivery.route) == (lead, "jev")
    assert "Phân tích căn" in await alice_stream.__anext__()
    assert "Phân tích căn" in await bob_stream.__anext__()
    async with await accounts.login("alice") as client:
        assert (await client.delete(f"/api/groups/{group['id']}/members/{bob}")).status_code == 204
    assert "groups.changed" in await alice_stream.__anext__()
    assert "groups.changed" in await bob_stream.__anext__()
    async with await accounts.login("alice") as client:
        after = await client.post(room_url, data={"text": "Sau khi xóa Bob"})
    assert after.status_code == 201
    assert "Sau khi xóa Bob" in await alice_stream.__anext__()
    assert await bob_stream.__anext__() == ": ping\n\n"
    async with await accounts.login("bobby") as client:
        assert (await client.get(room_url)).status_code == 404
    await alice_stream.aclose()
    await bob_stream.aclose()
