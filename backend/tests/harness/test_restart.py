"""Restart handling at boot (doc 03 "Restart"; doc 10 invariant 5)."""

from __future__ import annotations

from sqlalchemy import func, select, update

from backend.db import tables as t
from backend.harness import events as ev
from backend.harness.restart import reconcile
from backend.tests.harness.conftest import events_of

TRACE = "f" * 32


async def test_lost_exec_gets_a_tool_result_and_the_agent_a_notice(conn, rows, make_harness, team):
    h = make_harness()
    data = team.data.id
    await ev.append(
        conn,
        data,
        kind="input",
        payload={"text": "go", "items": []},
        trace_id=TRACE,
        activation_kind="message",
    )
    await ev.append(
        conn,
        data,
        kind="assistant",
        payload={
            "text": None,
            "tool_calls": [{"id": "c1", "code": "a"}, {"id": "c2", "code": "b"}],
        },
        trace_id=TRACE,
        activation_kind="message",
    )
    await ev.append(
        conn,
        data,
        kind="tool_result",
        payload={"tool_call_id": "c1", "exec_id": "x_1", "text": "exit_code: 0"},
        trace_id=TRACE,
        activation_kind="message",
    )
    await conn.execute(update(t.agents).where(t.agents.c.id == data).values(status="busy"))

    woken = await reconcile(h)

    evs = await events_of(conn, data)
    assert [e.kind for e in evs] == ["input", "assistant", "tool_result", "tool_result"]
    lost = evs[-1].payload
    assert lost["tool_call_id"] == "c2"
    assert lost["text"] == "exit_code: lost (harness restart)"
    assert lost["exit_code"] is None and lost["system"] is True
    assert evs[-1].trace_id == TRACE
    notice = (await conn.execute(select(t.deliveries).where(t.deliveries.c.agent_id == data))).one()
    assert notice.notice["kind"] == "restart" and notice.status == "pending"
    assert "interrupted" in notice.notice["text"]
    status = await conn.scalar(select(t.agents.c.status).where(t.agents.c.id == data))
    assert status == "idle"
    assert data in woken


async def test_idle_agents_are_left_alone(conn, make_harness, team):
    h = make_harness()
    await reconcile(h)
    count = await conn.scalar(select(func.count()).select_from(t.deliveries))
    assert count == 0


async def test_running_task_stays_running_and_the_lead_is_asked_to_continue(
    conn, rows, make_harness, team
):
    h = make_harness()
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    woken = await reconcile(h)
    status = await conn.scalar(select(t.global_tasks.c.status).where(t.global_tasks.c.id == task))
    assert status == "running"
    notice = (
        await conn.execute(select(t.deliveries).where(t.deliveries.c.agent_id == team.lead.id))
    ).one()
    assert notice.notice["kind"] == "task_resume"
    assert f"T{task}" in notice.notice["text"] and "end_task" in notice.notice["text"]
    assert team.lead.id in woken
