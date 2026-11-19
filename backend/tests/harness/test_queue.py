"""The global task queue (doc 07 "Global task queue", decision 0001)."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select, update

from backend.api.internal import create_internal_app
from backend.db import tables as t
from backend.harness.queue import enforce_task_timeouts, task_source
from backend.harness.runner import AgentRunner
from backend.harness.tokens import ExecContext, sign
from backend.tests.harness.conftest import events_of


async def queued(rows, team, description, message=None):
    return await rows.insert(
        t.global_tasks,
        user_id=team.user,
        description=description,
        status="queued",
        source_message_id=message,
    )


async def test_begin_moves_the_oldest_queued_task_to_running(conn, rows, make_harness, team):
    h = make_harness()
    msg = await rows.insert(
        t.messages,
        thread_id=team.threads["lead"],
        sender_type="user",
        sender_id=team.user,
        content={"text": "Vì sao căn này bán chậm?"},
    )
    first = await queued(rows, team, "Phân tích căn chậm bán", msg)
    await queued(rows, team, "Báo cáo tuần")
    async with h.db() as c:
        lead = (await c.execute(select(t.agents).where(t.agents.c.id == team.lead.id))).one()
        work = await task_source(h, c, lead)
    assert work.kind == "task" and work.task_id == first
    assert work.items == [{"type": "begin_task", "task_id": first}]
    assert work.default_thread == "direct:lead"
    block = work.blocks[0]
    assert block.startswith(
        f'<begin_task id="T{first}" source_message="m_{msg}" thread="direct:lead">'
    )
    assert "Phân tích căn chậm bán\n--- original message ---\nVì sao căn này bán chậm?" in block
    row = (await conn.execute(select(t.global_tasks).where(t.global_tasks.c.id == first))).one()
    assert row.status == "running" and row.started_at is not None
    involved = await conn.scalar(
        select(t.task_involvement.c.agent_id).where(t.task_involvement.c.task_id == first)
    )
    assert involved == team.lead.id


async def test_no_begin_for_non_leads_or_while_a_task_runs(conn, rows, make_harness, team):
    h = make_harness()
    await queued(rows, team, "a")
    async with h.db() as c:
        assert await task_source(h, c, team.data) is None
    await rows.insert(
        t.global_tasks, user_id=team.user, description="b", status="running", started_at=func.now()
    )
    async with h.db() as c:
        assert await task_source(h, c, team.lead) is None


async def test_the_lead_runs_a_task_activation(conn, rows, make_harness, team):
    h = make_harness("""
    agents:
      lead:
        - match: {input_contains: "<begin_task"}
          reply: {text: "bắt đầu"}
    """)
    task = await queued(rows, team, "Phân tích")
    await AgentRunner(h, team.lead.id).run_until_idle()
    evs = await events_of(conn, team.lead.id)
    assert evs[0].activation_kind == "task" and evs[0].task_id == task
    assert "task: T" in evs[0].payload["text"] and "<begin_task" in evs[0].payload["text"]
    assert "queue: 0 queued" in evs[0].payload["text"]
    assert evs[1].task_id == task


# --- internal end_task / queue_task -----------------------------------------------------------


def caller(team, agent, exec_id="x_1"):
    return ExecContext(
        agent_id=agent.id,
        user_id=team.user,
        slug=agent.slug,
        is_lead=agent.is_lead,
        exec_id=exec_id,
        trace_id="0" * 32,
        activation_kind="task",
        task_id=None,
        default_thread=None,
        folder="/f",
    )


@pytest.fixture
def internal(make_harness, team, settings):
    h = make_harness()
    woken = []
    h.wake = woken.append
    app = create_internal_app(h)

    def call(agent):
        exec_id = f"x_{agent.slug}"
        h.registry.start(caller(team, agent, exec_id), now=time.time())
        token = sign(
            settings.SESSION_SECRET.get_secret_value(), agent.id, exec_id, exp=int(time.time()) + 60
        )
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://internal",
            headers={"Authorization": f"Bearer {token}"},
        )

    call.harness, call.woken = h, woken
    return call


async def test_end_task_by_the_lead(conn, rows, team, internal):
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    events = internal.harness.bus.subscribe(team.user)
    async with internal(team.lead) as c:
        r = await c.post("/internal/v1/end_task", json={"outcome": "đã trả lời", "status": "done"})
    assert r.status_code == 200 and r.json() == {"task_id": task}
    row = (await conn.execute(select(t.global_tasks).where(t.global_tasks.c.id == task))).one()
    assert (row.status, row.outcome, row.ended_by) == ("done", "đã trả lời", "lead")
    assert row.ended_at is not None
    published = events.get_nowait()
    assert published["type"] == "task.updated" and published["data"]["status"] == "done"
    assert published["data"]["id"] == task


async def test_end_task_failed_status(conn, rows, team, internal):
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    async with internal(team.lead) as c:
        r = await c.post(
            "/internal/v1/end_task", json={"outcome": "thiếu dữ liệu", "status": "failed"}
        )
    assert r.status_code == 200
    status = await conn.scalar(select(t.global_tasks.c.status).where(t.global_tasks.c.id == task))
    assert status == "failed"


async def test_end_task_rules(rows, team, internal):
    async with internal(team.lead) as c:
        r = await c.post("/internal/v1/end_task", json={"outcome": "x"})
        assert r.status_code == 409 and r.json()["error"] == "no_running_task"
        r = await c.post("/internal/v1/end_task", json={"outcome": "x", "status": "cancelled"})
        assert r.status_code == 400
    await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    async with internal(team.data) as c:
        r = await c.post("/internal/v1/end_task", json={"outcome": "x"})
        assert r.status_code == 403 and r.json()["error"] == "lead_only"


async def test_queue_task(conn, team, internal):
    async with internal(team.lead) as c:
        r = await c.post("/internal/v1/queue_task", json={"description": "Báo cáo tuần"})
    task = r.json()["task_id"]
    row = (await conn.execute(select(t.global_tasks).where(t.global_tasks.c.id == task))).one()
    assert (row.status, row.description, row.source_message_id) == ("queued", "Báo cáo tuần", None)
    assert internal.woken == [team.lead.id]
    async with internal(team.data) as c:
        r = await c.post("/internal/v1/queue_task", json={"description": "x"})
        assert r.status_code == 403


# --- timeout ------------------------------------------------------------------------------


async def test_timeout_fails_the_task_and_notifies(conn, rows, make_harness, team):
    h = make_harness(TASK_MAX_S=60)
    h.wake = lambda a: None
    old = datetime.now(UTC) - timedelta(seconds=120)
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=old
    )
    fresh = await rows.insert(t.global_tasks, user_id=team.user, description="y", status="queued")
    for a in (team.lead.id, team.data.id):
        await rows.insert(t.task_involvement, task_id=task, agent_id=a)
    await enforce_task_timeouts(h)
    row = (await conn.execute(select(t.global_tasks).where(t.global_tasks.c.id == task))).one()
    assert (row.status, row.ended_by) == ("failed", "timeout")
    status = await conn.scalar(select(t.global_tasks.c.status).where(t.global_tasks.c.id == fresh))
    assert status == "queued"
    notices = (await conn.execute(select(t.deliveries.c.agent_id, t.deliveries.c.notice))).all()
    assert sorted(n.agent_id for n in notices) == sorted([team.lead.id, team.data.id])
    assert {n.notice["kind"] for n in notices} == {"task_timeout"}
    assert all(f"T{task}" in n.notice["text"] for n in notices)


async def test_tasks_that_are_not_due_are_left(conn, rows, make_harness, team):
    h = make_harness(TASK_MAX_S=3600)
    await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    await enforce_task_timeouts(h)
    assert await conn.scalar(select(t.global_tasks.c.status)) == "running"
    await conn.execute(update(t.global_tasks).values(status="done", ended_at=func.now()))
