"""Posting a message: deliveries, routes, involvement, wakes (doc 07 "Triggers", "Deliveries")."""

from __future__ import annotations

from sqlalchemy import func, select

from backend.db import tables as t
from backend.messaging.messages import post_message


async def deliveries(conn, message_id):
    rows = (
        await conn.execute(select(t.deliveries).where(t.deliveries.c.message_id == message_id))
    ).all()
    return {r.agent_id: r for r in rows}


async def group(rows, team, *agent_ids, name="Nhóm"):
    thread = await rows.thread(team.user, kind="group", name=name)
    await rows.insert(t.thread_members, thread_id=thread, member_type="user", member_id=team.user)
    for a in agent_ids:
        await rows.insert(t.thread_members, thread_id=thread, member_type="agent", member_id=a)
    return thread


def recorder(h):
    woken, jev = [], []
    h.wake = woken.append
    h.jev.schedule = jev.append
    return woken, jev


async def test_user_message_to_a_non_lead_is_a_pending_notification(conn, make_harness, team):
    h = make_harness()
    woken, jev = recorder(h)
    events = h.bus.subscribe(team.user)
    async with h.db() as c:
        msg = await post_message(
            h,
            c,
            thread_id=team.threads["data"],
            sender_type="user",
            sender_id=team.user,
            content={"text": "Xin số liệu"},
        )
        assert woken == []  # not before commit
    d = await deliveries(conn, msg)
    assert set(d) == {team.data.id}
    assert (d[team.data.id].route, d[team.data.id].status) == ("notification", "pending")
    assert woken == [team.data.id] and jev == []
    created = events.get_nowait()
    assert created["type"] == "message.created" and created["data"]["id"] == msg
    last = await conn.scalar(
        select(t.threads.c.last_message_at).where(t.threads.c.id == team.threads["data"])
    )
    assert last is not None


async def test_the_leads_copy_goes_through_jev(conn, make_harness, team):
    h = make_harness()
    woken, jev = recorder(h)
    async with h.db() as c:
        msg = await post_message(
            h,
            c,
            thread_id=team.threads["lead"],
            sender_type="user",
            sender_id=team.user,
            content={"text": "Vì sao?"},
        )
    d = (await deliveries(conn, msg))[team.lead.id]
    assert (d.route, d.status) == ("jev", "classifying")
    assert jev == [d.id] and woken == []


async def test_group_message_reaches_every_member_but_the_sender(conn, rows, make_harness, team):
    h = make_harness()
    recorder(h)
    chart = await rows.agent(team.user, slug="chart")
    gone = await rows.agent(team.user, slug="gone", state="deleted")
    thread = await group(rows, team, team.lead.id, team.data.id, chart, gone)
    async with h.db() as c:
        msg = await post_message(
            h,
            c,
            thread_id=thread,
            sender_type="user",
            sender_id=team.user,
            content={"text": "Báo cáo Q3"},
        )
    d = await deliveries(conn, msg)
    assert set(d) == {team.lead.id, team.data.id, chart}
    assert d[team.lead.id].route == "jev" and d[chart].route == "notification"
    async with h.db() as c:
        msg2 = await post_message(
            h,
            c,
            thread_id=thread,
            sender_type="agent",
            sender_id=team.data.id,
            content={"text": "Xong phần số liệu"},
        )
    d2 = await deliveries(conn, msg2)
    assert set(d2) == {team.lead.id, chart}  # never the sender


async def test_involvement_while_a_task_runs(conn, rows, make_harness, team):
    h = make_harness()
    recorder(h)
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    thread = await rows.thread(team.user, kind="agent", member_key="data+lead", name=None)
    for a in (team.lead.id, team.data.id):
        await rows.insert(t.thread_members, thread_id=thread, member_type="agent", member_id=a)
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=thread,
            sender_type="agent",
            sender_id=team.lead.id,
            content={"text": "Lấy số liệu"},
        )
        await post_message(
            h,
            c,
            thread_id=thread,
            sender_type="agent",
            sender_id=team.data.id,
            content={"text": "Đây"},
        )  # second time: no duplicate rows
    involved = (
        (
            await conn.execute(
                select(t.task_involvement.c.agent_id).where(t.task_involvement.c.task_id == task)
            )
        )
        .scalars()
        .all()
    )
    assert sorted(involved) == sorted([team.lead.id, team.data.id])


async def test_no_involvement_without_a_running_task(conn, make_harness, team):
    h = make_harness()
    recorder(h)
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=team.threads["data"],
            sender_type="user",
            sender_id=team.user,
            content={"text": "hi"},
        )
    assert await conn.scalar(select(func.count()).select_from(t.task_involvement)) == 0
