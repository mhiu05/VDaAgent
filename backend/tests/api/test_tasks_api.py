"""`/api/tasks` and `/api/presence` (doc 15 "Tasks, presence and stream"; doc 07)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from backend.db import tables as t


class FakeHarness:
    def __init__(self):
        from backend.harness.bus import EventBus

        self.bus = EventBus()
        self.woken = []

    def wake(self, agent_id):
        self.woken.append(agent_id)


@pytest.fixture
def app(make_app):
    app = make_app()
    app.state.harness = FakeHarness()
    return app


async def team(accounts, rows, username="alice"):
    user = await accounts.user(username)
    lead = await rows.agent(user, slug="lead", is_lead=True, origin="lead")
    data = await rows.agent(user, slug="data")
    return user, lead, data


async def test_list_tasks(accounts, rows):
    user, _, _ = await team(accounts, rows)
    await rows.insert(t.global_tasks, user_id=user, description="a", status="queued")
    await rows.insert(t.global_tasks, user_id=user, description="b", status="done")
    async with await accounts.login("alice") as c:
        r = await c.get("/api/tasks", params={"status": "queued,running"})
        assert r.status_code == 200
        body = r.json()
        assert [x["description"] for x in body] == ["a"]
        assert set(body[0]) == {
            "id",
            "description",
            "status",
            "outcome",
            "ended_by",
            "source_message_id",
            "created_at",
            "started_at",
            "ended_at",
            "group_id",
        }
        assert len((await c.get("/api/tasks")).json()) == 2
        assert (await c.get("/api/tasks", params={"status": "bogus"})).status_code == 400


async def test_cancel_a_running_task_notifies_the_lead_and_involved(app, accounts, rows, conn):
    user, lead, data = await team(accounts, rows)
    task = await rows.insert(
        t.global_tasks, user_id=user, description="a", status="running", started_at=func.now()
    )
    await rows.insert(t.task_involvement, task_id=task, agent_id=data)
    events = app.state.harness.bus.subscribe(user)
    async with await accounts.login("alice") as c:
        r = await c.post(f"/api/tasks/{task}/cancel")
        assert r.status_code == 200
        assert (r.json()["status"], r.json()["ended_by"]) == ("cancelled", "user")
        assert (await c.post(f"/api/tasks/{task}/cancel")).status_code == 409
    notices = (await conn.execute(select(t.deliveries.c.agent_id, t.deliveries.c.notice))).all()
    assert sorted(n.agent_id for n in notices) == sorted([lead, data])
    assert {n.notice["kind"] for n in notices} == {"task_cancelled"}
    assert sorted(app.state.harness.woken) == sorted([lead, data])
    assert events.get_nowait()["type"] == "task.updated"


async def test_cancel_a_queued_task(accounts, rows, conn):
    user, lead, _ = await team(accounts, rows)
    task = await rows.insert(t.global_tasks, user_id=user, description="a", status="queued")
    async with await accounts.login("alice") as c:
        assert (await c.post(f"/api/tasks/{task}/cancel")).status_code == 200
    notice = (await conn.execute(select(t.deliveries.c.agent_id))).scalars().all()
    assert notice == [lead]


async def test_another_users_task_is_404(accounts, rows):
    user, _, _ = await team(accounts, rows)
    await team(accounts, rows, "bob")
    task = await rows.insert(t.global_tasks, user_id=user, description="a", status="queued")
    async with await accounts.login("bob") as c:
        assert (await c.post(f"/api/tasks/{task}/cancel")).status_code == 404


async def test_group_task_visibility_and_revocation(app, accounts, rows, conn):
    from types import SimpleNamespace

    app.state.harness.jobs = SimpleNamespace(kick=lambda: None)
    alice = await accounts.user("alice")
    bob = await accounts.user("bobby")
    await accounts.user("carol")
    async with await accounts.login("alice") as c:
        created = await c.post("/api/groups", json={"name": "Sales Team"})
        assert created.status_code == 202
        group = created.json()["group"]
        assert (
            await c.post(f"/api/groups/{group['id']}/members", json={"user_id": str(bob)})
        ).status_code == 201
    owner = await conn.scalar(
        select(t.groups.c.technical_owner_id).where(t.groups.c.id == group["id"])
    )
    task = await rows.insert(
        t.global_tasks, user_id=owner, description="group work", status="queued"
    )
    personal = await rows.insert(
        t.global_tasks, user_id=alice, description="private work", status="queued"
    )
    async with await accounts.login("bobby") as c:
        listed = (await c.get("/api/tasks")).json()
        assert [(item["id"], item["group_id"]) for item in listed] == [(task, group["id"])]
        assert (await c.post(f"/api/tasks/{personal}/cancel")).status_code == 404
        assert (await c.get(f"/api/groups/{group['id']}/agents")).json() == []
    async with await accounts.login("carol") as c:
        assert (await c.get("/api/tasks")).json() == []
        assert (await c.post(f"/api/tasks/{task}/cancel")).status_code == 404
        assert (await c.get(f"/api/groups/{group['id']}/agents")).status_code == 404
    async with await accounts.login("alice") as c:
        assert (await c.delete(f"/api/groups/{group['id']}/members/{bob}")).status_code == 204
    async with await accounts.login("bobby") as c:
        assert (await c.get("/api/tasks")).json() == []
        assert (await c.post(f"/api/tasks/{task}/cancel")).status_code == 404
        assert (await c.get(f"/api/groups/{group['id']}/agents")).status_code == 404


async def test_presence_is_debounced_to_30_minutes(app, accounts, rows, conn):
    _user, lead, _ = await team(accounts, rows)
    async with await accounts.login("alice") as c:
        assert (await c.post("/api/presence")).status_code == 204
        assert (await c.post("/api/presence")).status_code == 204
        notices = (
            await conn.execute(select(t.deliveries).where(t.deliveries.c.agent_id == lead))
        ).all()
        assert len(notices) == 1 and notices[0].notice["kind"] == "presence"
        await conn.execute(
            update(t.deliveries).values(created_at=datetime.now(UTC) - timedelta(minutes=31))
        )
        assert (await c.post("/api/presence")).status_code == 204
    count = await conn.scalar(select(func.count()).select_from(t.deliveries))
    assert count == 2
    assert app.state.harness.woken == [lead, lead]


async def test_admins_have_no_queue(accounts):
    await accounts.admin()
    async with await accounts.login("admin") as c:
        assert (await c.get("/api/tasks")).status_code == 403
        assert (await c.post("/api/presence")).status_code == 403
