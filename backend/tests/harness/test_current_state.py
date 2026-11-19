"""`current_state` (doc 06 "`current_state`")."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func

from backend.db import tables as t
from backend.harness.state import CurrentState, TaskLine, load_current_state, render_current_state
from backend.tests.db.conftest import rows  # noqa: F401

NOW = datetime(2026, 10, 17, 3, 2, 11, tzinfo=UTC)  # 10:02:11 in Asia/Ho_Chi_Minh


def base(**kw):
    values = {
        "now": NOW,
        "you_slug": "data",
        "you_name": "Data",
        "is_lead": False,
        "lead_slug": "lead",
        "lead_name": "Điều phối",
        "team": ["lead", "data", "insight", "compare", "chart", "report"],
        "task": TaskLine(
            id=42,
            description="Vì sao căn MAS-U03832 bán chậm? So sánh với các căn "
            "tương đồng, vẽ biểu đồ và xuất báo cáo.",
            started_at=datetime(2026, 10, 17, 3, 1, tzinfo=UTC),
        ),
        "queued": 2,
        "status": "busy",
        "pending_notifications": 2,
        "pending_routines": ["bao-cao-sang"],
    }
    values.update(kw)
    return CurrentState(**values)


def test_non_lead_block():
    assert render_current_state(base()) == (
        "<current_state>\n"
        "time: 2026-10-17T10:02:11+07:00\n"
        'you: data ("Data")\n'
        'lead: lead ("Điều phối")\n'
        "team: lead, data, insight, compare, chart, report\n"
        'task: T42 "Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đ…" '
        "(running since 10:01)\n"
        "status: busy\n"
        "pending: 2 notifications; routines: bao-cao-sang\n"
        "</current_state>"
    )


def test_lead_block_has_lead_you_and_queue():
    text = render_current_state(base(is_lead=True, you_slug="lead", you_name="Điều phối"))
    lines = text.splitlines()
    assert "lead: you" in lines
    task_i = next(i for i, line in enumerate(lines) if line.startswith("task:"))
    assert lines[task_i + 1] == "queue: 2 queued"


def test_no_task_and_nothing_pending():
    text = render_current_state(base(task=None, pending_notifications=0, pending_routines=[]))
    assert "task: none" in text.splitlines()
    assert "pending: none" in text.splitlines()


def test_one_notification_is_singular():
    text = render_current_state(base(pending_notifications=1, pending_routines=[]))
    assert "pending: 1 notification" in text.splitlines()


async def test_load_from_the_database(conn, rows):  # noqa: F811
    user = await rows.user(username="alice")
    lead = await rows.agent(
        user, slug="lead", display_name="Điều phối", is_lead=True, origin="lead"
    )
    data = await rows.agent(user, slug="data", display_name="Data", status="busy")
    await rows.agent(user, slug="gone", state="deleted")
    task = await rows.insert(
        t.global_tasks,
        user_id=user,
        description="Phân tích",
        status="running",
        started_at=func.now(),
    )
    await rows.insert(t.global_tasks, user_id=user, description="Sau", status="queued")
    thread = await rows.thread(user, kind="direct", member_key="data", name=None)
    msg = await rows.message(thread)
    await rows.insert(
        t.deliveries, agent_id=data, message_id=msg, route="notification", status="pending"
    )
    await rows.insert(
        t.routine_state,
        agent_id=data,
        name="sang",
        cron="0 8 * * *",
        enabled=True,
        prompt_sha="a" * 64,
        pending=True,
    )
    agent = (await conn.execute(t.agents.select().where(t.agents.c.id == data))).one()
    state = await load_current_state(conn, agent, now=NOW)
    assert state.team == ["lead", "data"]
    assert (state.lead_slug, state.is_lead) == ("lead", False)
    assert state.task.id == task and state.queued == 1
    assert state.pending_notifications == 1 and state.pending_routines == ["sang"]
    assert state.status == "busy"
    lead_row = (await conn.execute(t.agents.select().where(t.agents.c.id == lead))).one()
    assert (await load_current_state(conn, lead_row, now=NOW)).is_lead is True
