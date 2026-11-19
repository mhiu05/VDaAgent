"""Custom agents: chatable in personal chat, and copied into a group's own team on request."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select

from backend.catalog import seeds
from backend.db import tables as t
from backend.tests.api.test_builder_api import app, domains  # noqa: F401 (fixtures)
from backend.tests.api.test_group_provisioning import _seed_fabrikam

CUSTOM = {
    "slug": "demo-analyst",
    "display_name": "Demo Analyst",
    "avatar": {"emoji": "🧪", "color": "#7C3AED"},
    "description": "Trả lời ngắn gọn",
}


async def _custom_agent(app, c, conn, owner):  # noqa: F811
    r = await c.post("/api/agents", json=CUSTOM)
    assert r.status_code == 202, r.text
    await app.state.harness.jobs.run_pending()
    return await conn.scalar(
        select(t.agents.c.id).where(t.agents.c.user_id == owner, t.agents.c.slug == CUSTOM["slug"])
    )


async def _room_agents(conn, room):
    q = select(t.thread_members.c.member_id).where(
        t.thread_members.c.thread_id == room, t.thread_members.c.member_type == "agent"
    )
    return (await conn.execute(q)).scalars().all()


async def test_a_custom_agent_is_listed_and_chatable_by_its_owner_only(
    app,  # noqa: F811
    accounts,
    conn,
    domains,  # noqa: F811
):
    alice = await accounts.user("alice")
    await accounts.user("bobby")
    await seeds.upsert_catalogs(conn, app.state.settings, available=[])
    async with await accounts.login("alice") as c:
        agent = await _custom_agent(app, c, conn, alice)
        assert agent is not None
        listed = (await c.get("/api/agents")).json()
        assert CUSTOM["slug"] in [a["slug"] for a in listed]
        assert next(a for a in listed if a["slug"] == CUSTOM["slug"])["status"] == "idle"
        [direct] = [
            th
            for th in (await c.get("/api/threads")).json()
            if [m.get("id") for m in th["members"] if m["type"] == "agent"] == [str(agent)]
        ]
        assert direct["kind"] == "direct"
        r = await c.post(f"/api/threads/{direct['id']}/messages", data={"text": 'Trả lời "OK"'})
        assert r.status_code == 201
    [delivery] = (await conn.execute(select(t.deliveries))).all()
    assert (delivery.agent_id, delivery.route) == (agent, "notification")
    async with await accounts.login("bobby") as c:  # someone else's agent stays theirs
        assert CUSTOM["slug"] not in [a["slug"] for a in (await c.get("/api/agents")).json()]
        assert (await c.get(f"/api/agents/{agent}")).status_code == 404
        r = await c.post(f"/api/threads/{direct['id']}/messages", data={"text": "x"})
        assert r.status_code == 404


async def test_adding_a_custom_agent_gives_the_group_its_own_copy(
    app,  # noqa: F811
    accounts,
    conn,
    domains,  # noqa: F811
    monkeypatch,
):
    h = app.state.harness
    scheduled = []
    monkeypatch.setattr(h.jev, "schedule", scheduled.append)  # the lead's JEV runs elsewhere
    await _seed_fabrikam(conn)
    await seeds.upsert_catalogs(conn, app.state.settings, available=[])
    alice = await accounts.user("alice")
    bob = await accounts.user("bobby")
    await accounts.user("carol")
    async with await accounts.login("alice") as c:
        group = (await c.post("/api/groups", json={"name": "Sales Team"})).json()["group"]
        assert (
            await c.post(f"/api/groups/{group['id']}/members", json={"user_id": str(bob)})
        ).status_code == 201
        await h.jobs.run_pending()
        owner = await conn.scalar(
            select(t.groups.c.technical_owner_id).where(t.groups.c.id == group["id"])
        )
        personal = await _custom_agent(app, c, conn, alice)
        lead = await conn.scalar(
            select(t.agents.c.id).where(t.agents.c.user_id == owner, t.agents.c.is_lead)
        )
        events = h.bus.subscribe(bob)
        r = await c.post(f"/api/groups/{group['id']}/agents", json={"agent_id": str(personal)})
        assert r.status_code == 202, r.text
        assert await h.jobs.run_pending() == 1
        copy = (
            await conn.execute(
                select(t.agents).where(
                    t.agents.c.user_id == owner, t.agents.c.slug == "demo-analyst"
                )
            )
        ).one()
        # its own instance under the technical owner: new id, own folder, no shared history
        assert copy.id != personal and copy.state == "active" and copy.origin == "custom"
        assert copy.display_name == "Demo Analyst"
        folder = Path(app.state.settings.FOLDERS_DIR) / str(owner) / "demo-analyst"
        personal_folder = Path(app.state.settings.FOLDERS_DIR) / str(alice) / "demo-analyst"
        assert (folder / "prompts" / "system.md").read_text() == (
            personal_folder / "prompts" / "system.md"
        ).read_text()
        assert await _room_agents(conn, group["room_thread_id"]) == [lead]  # never a room member
        team = (await c.get(f"/api/groups/{group['id']}/agents")).json()
        assert "demo-analyst" in [a["slug"] for a in team]
        assert events.get_nowait()["type"] == "groups.changed"  # members refresh their team
        dup = await c.post(f"/api/groups/{group['id']}/agents", json={"agent_id": str(personal)})
        assert (dup.status_code, dup.json()["error"]) == (409, "slug_taken")
        # @mention reaches the copy through the lead only
        room = f"/api/threads/{group['room_thread_id']}/messages"
        r = await c.post(room, data={"text": "@Demo Analyst trả lời OK", "mention": "demo-analyst"})
        assert r.status_code == 201
        [delivery] = (await conn.execute(select(t.deliveries))).all()
        assert (delivery.agent_id, delivery.route) == (lead, "jev")
        assert scheduled == [delivery.id]
    async with await accounts.login("bobby") as c:
        # Bob cannot hand Alice's personal agent to the group (nor reach it)
        r = await c.post(f"/api/groups/{group['id']}/agents", json={"agent_id": str(personal)})
        assert r.status_code == 404
        # nor add the group's lead or the copy itself as "his" agent
        for other in (lead, copy.id):
            r = await c.post(f"/api/groups/{group['id']}/agents", json={"agent_id": str(other)})
            assert r.status_code == 404
    async with await accounts.login("carol") as c:  # not a member: the group does not exist
        r = await c.post(f"/api/groups/{group['id']}/agents", json={"agent_id": str(personal)})
        assert r.status_code == 404
    assert (
        await conn.scalar(
            select(func.count())
            .select_from(t.agents)
            .where(t.agents.c.user_id == owner, t.agents.c.slug == "demo-analyst")
        )
        == 1
    )
