"""Admin observability routes (doc 15 "Admin API", doc 13 "Chat-trace view")."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from backend.db import tables as t


class FakeHarness:
    def __init__(self):
        from backend.harness.bus import EventBus

        self.bus = EventBus()
        self.woken = []
        self.jobs = type("Jobs", (), {"kick": lambda self: None})()

    def wake(self, agent_id):
        self.woken.append(agent_id)


@pytest.fixture
def app(make_app):
    app = make_app(LANGFUSE_PUBLIC_URL="http://localhost:3100")
    app.state.harness = FakeHarness()
    return app


async def setup(accounts, rows):
    alice = await accounts.user("alice", domain="fabrikam")
    await accounts.admin()
    lead = await rows.agent(alice, slug="lead", is_lead=True, origin="lead", status="busy")
    data = await rows.agent(alice, slug="data", compaction_failures=3)
    await rows.insert(
        t.agent_epochs, agent_id=lead, epoch=0, start_seq=0, system_prompt="S", reason="initial"
    )
    return alice, lead, data


async def test_overview(accounts, rows, conn):
    alice, lead, data = await setup(accounts, rows)
    task = await rows.insert(
        t.global_tasks,
        user_id=alice,
        description="Phân tích",
        status="running",
        started_at=func.now(),
    )
    await rows.insert(t.global_tasks, user_id=alice, description="Sau", status="queued")
    await rows.insert(
        t.deliveries,
        agent_id=data,
        notice={"kind": "builder", "text": "x"},
        route="notification",
        status="pending",
    )
    await rows.event(
        lead, 1, kind="assistant", payload={"text": "x", "tool_calls": [], "usage": {"cost": 0.25}}
    )
    await rows.event(
        lead, 2, kind="assistant", payload={"text": "y", "tool_calls": [], "usage": {"cost": 0.5}}
    )
    old = datetime.now(UTC) - timedelta(days=2)
    await rows.event(
        lead,
        3,
        kind="assistant",
        created_at=old,
        payload={"text": "z", "tool_calls": [], "usage": {"cost": 9}},
    )
    await rows.event(data, 1, kind="error", payload={"code": "step_limit", "text": "x"})
    async with await accounts.login("admin") as c:
        r = await c.get("/api/admin/overview")
    assert r.status_code == 200
    body = r.json()
    assert {d["id"] for d in body["domains"]} >= {"fabrikam"}
    rows_by_slug = {a["slug"]: a for a in body["agents"]}
    lead_row = rows_by_slug["lead"]
    assert lead_row["user"]["username"] == "alice" and lead_row["domain"] == "fabrikam"
    assert lead_row["current_task"]["id"] == task and lead_row["queue_len"] == 1
    assert abs(lead_row["cost_today"] - 0.75) < 1e-9
    assert lead_row["status"] == "busy"
    data_row = rows_by_slug["data"]
    assert data_row["pending"] == 1 and data_row["compaction_failed"] is True
    assert data_row["queue_len"] is None and data_row["last_error_at"]


async def test_events_epochs_and_jev(accounts, rows, conn):
    alice, lead, _ = await setup(accounts, rows)
    for seq in range(1, 6):
        await rows.event(lead, seq)
    thread = await rows.thread(alice, kind="direct", member_key="lead", name=None)
    msg = await rows.message(thread, sender_type="user", sender_id=alice)
    await rows.insert(t.deliveries, agent_id=lead, message_id=msg, route="jev", status="pending")
    await rows.insert(
        t.jev_decisions,
        message_id=msg,
        lead_id=lead,
        input={"messages": []},
        label="task",
        confidence=0.9,
        model="m",
        latency_ms=3,
        trace_id="0" * 32,
    )
    async with await accounts.login("admin") as c:
        r = await c.get(f"/api/admin/agents/{lead}/events", params={"after_seq": 2, "limit": 2})
    body = r.json()
    assert [e["seq"] for e in body["events"]] == [3, 4]
    assert body["events"][0]["kind"] == "input" and body["events"][0]["trace_id"]
    assert [e["epoch"] for e in body["epochs"]] == [0]
    assert body["jev"][0]["label"] == "task" and body["jev"][0]["message_id"] == msg


async def test_jev_observed_mark(accounts, rows, conn):
    alice, lead, _ = await setup(accounts, rows)
    thread = await rows.thread(alice, kind="direct", member_key="lead", name=None)
    msg = await rows.message(thread, sender_type="user", sender_id=alice)
    await rows.insert(
        t.jev_decisions,
        message_id=msg,
        lead_id=lead,
        input={},
        label="task",
        confidence=0.9,
        model="m",
        latency_ms=3,
        trace_id="0" * 32,
    )
    async with await accounts.login("admin") as c:
        r = await c.post(f"/api/admin/jev/{msg}/observed", json={"label": "side_question"})
        assert r.status_code == 204
        assert (
            await c.post(f"/api/admin/jev/{msg}/observed", json={"label": "urgent"})
        ).status_code == 400
        assert (
            await c.post("/api/admin/jev/999999/observed", json={"label": "task"})
        ).status_code == 404
    row = (await conn.execute(select(t.jev_decisions))).one()
    assert row.observed == "side_question" and row.observed_by is not None


async def test_compact_now(app, accounts, rows, conn):
    _, lead, _ = await setup(accounts, rows)
    async with await accounts.login("admin") as c:
        assert (await c.post(f"/api/admin/agents/{lead}/compact")).status_code == 204
    assert (
        await conn.scalar(select(t.agents.c.compaction_pending).where(t.agents.c.id == lead))
        is True
    )
    assert app.state.harness.woken == [lead]


async def test_admin_resets_a_users_agent(accounts, rows, conn):
    alice, lead, data = await setup(accounts, rows)
    async with await accounts.login("admin") as c:
        r = await c.post(f"/api/admin/agents/{data}/reset")
        assert r.status_code == 202, r.text
        job = (await conn.execute(select(t.jobs))).one()
        assert str(job.id) == r.json()["job_id"]
        assert (job.kind, job.agent_id, job.user_id) == ("agent_reset", data, alice)
        assert (await c.post(f"/api/admin/agents/{data}/reset")).json()["error"] == "job_running"
        task = await rows.insert(
            t.global_tasks, user_id=alice, description="x", status="running", started_at=func.now()
        )
        await rows.insert(t.task_involvement, task_id=task, agent_id=lead)
        r = await c.post(f"/api/admin/agents/{lead}/reset")
        assert (r.status_code, r.json()["error"]) == (409, "agent_busy_in_task")
        assert (await c.post("/api/admin/agents/nope/reset")).status_code == 404


async def test_user_agents_threads_and_any_thread(accounts, rows, conn):
    alice, lead, data = await setup(accounts, rows)
    agent_thread = await rows.thread(alice, kind="agent", member_key="data+lead", name=None)
    for a in (lead, data):
        await rows.insert(
            t.thread_members, thread_id=agent_thread, member_type="agent", member_id=a
        )
    await rows.message(
        agent_thread, sender_type="agent", sender_id=lead, content={"text": "Lấy số liệu"}
    )
    async with await accounts.login("admin") as c:
        agents = (await c.get(f"/api/admin/users/{alice}/agents")).json()
        assert {a["slug"] for a in agents} == {"lead", "data"}
        threads = (await c.get(f"/api/admin/users/{alice}/threads")).json()
        assert [th["kind"] for th in threads] == ["agent"]
        r = await c.get(f"/api/admin/threads/{agent_thread}")
        assert r.json()["thread"]["kind"] == "agent"
        assert [m["text"] for m in r.json()["messages"]] == ["Lấy số liệu"]


async def test_config_and_admin_only(accounts, rows):
    await setup(accounts, rows)
    async with await accounts.login("admin") as c:
        assert (await c.get("/api/admin/config")).json() == {
            "langfuse_url": "http://localhost:3100",
            "langfuse_project_id": "contoso-poc",
        }
    async with await accounts.login("alice") as c:
        assert (await c.get("/api/admin/overview")).status_code == 403
