"""Supervisor and event bus (doc 02 "Process model inside `api`")."""

from __future__ import annotations

import asyncio

from sqlalchemy import update

from backend.db import tables as t
from backend.harness.bus import EventBus
from backend.tests.harness.conftest import events_of, user_message

TEXT = """
agents:
  data:
    - reply: {text: "a"}
    - reply: {text: "b"}
"""


async def wait_for(predicate, timeout=5.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if await predicate():
            return True
        await asyncio.sleep(0.02)
    return False


def test_bus_fans_out_by_user():
    bus = EventBus()
    a, b = bus.subscribe("u1"), bus.subscribe("u2")
    bus.publish("u1", "message.created", {"id": 1})
    assert a.get_nowait() == {"type": "message.created", "data": {"id": 1}}
    assert b.empty()
    bus.unsubscribe("u1", a)
    bus.publish("u1", "x", {})
    assert a.empty()


def test_bus_admin_subscribers_see_raw_events_per_agent():
    bus = EventBus()
    q = bus.subscribe_agent("agent-1")
    bus.publish_agent("agent-1", "event.appended", {"seq": 3})
    assert q.get_nowait()["data"] == {"seq": 3}


async def test_starts_runners_for_eligible_agents_only(conn, rows, make_harness, team):
    h = make_harness(TEXT)
    other_domain = await rows.domain("broken", status="unavailable")
    bob = await rows.user(username="bob", domain_id=other_domain)
    await rows.agent(bob, slug="lead", is_lead=True, origin="lead")
    carol = await rows.user(username="carol", domain_id="fabrikam", status="disabled")
    await rows.agent(carol, slug="lead", is_lead=True, origin="lead")
    await rows.agent(team.user, slug="old", state="deleted")
    await h.supervisor.start()
    try:
        assert set(h.supervisor.running()) == {team.lead.id, team.data.id}
    finally:
        await h.supervisor.stop_all()
    assert h.supervisor.running() == []


async def test_wake_processes_new_deliveries(conn, rows, make_harness, team):
    h = make_harness(TEXT)
    await h.supervisor.start()
    try:
        await user_message(rows, team, "data", "hello")
        h.wake(team.data.id)

        async def done():
            return len(await events_of(conn, team.data.id)) == 2

        assert await wait_for(done)
    finally:
        await h.supervisor.stop_all()


async def test_idle_runners_poll_so_a_missed_wake_is_not_fatal(conn, rows, make_harness, team):
    h = make_harness(TEXT, RUNNER_POLL_S=0.05)
    await h.supervisor.start()
    try:
        await user_message(rows, team, "data", "no wake call")

        async def done():
            return len(await events_of(conn, team.data.id)) == 2

        assert await wait_for(done)
    finally:
        await h.supervisor.stop_all()


async def test_a_crashed_runner_restarts_after_backoff(conn, rows, make_harness, team):
    h = make_harness(TEXT, RUNNER_POLL_S=0.05)
    h.supervisor.restart_backoff_s = 0.05
    crashes = []
    original = h.run_activation

    async def flaky(runner, work):
        if not crashes:
            crashes.append(1)
            raise RuntimeError("boom")
        return await original(runner, work)

    h.run_activation = flaky
    await h.supervisor.start()
    try:
        await user_message(rows, team, "data", "x")
        h.wake(team.data.id)

        async def recovered():
            evs = await events_of(conn, team.data.id)
            return any(e.kind == "assistant" for e in evs)

        assert await wait_for(recovered)
        evs = await events_of(conn, team.data.id)
        errors = [e.payload for e in evs if e.kind == "error"]
        assert errors and errors[0]["code"] == "restart" and "boom" in errors[0]["text"]
    finally:
        await h.supervisor.stop_all()


async def test_stop_and_start_a_users_runners(conn, rows, make_harness, team):
    h = make_harness(TEXT)
    await h.supervisor.start()
    try:
        await h.supervisor.stop_user(team.user)
        assert h.supervisor.running() == []
        await conn.execute(update(t.users).where(t.users.c.id == team.user).values(status="active"))
        await h.supervisor.start_user(team.user)
        assert set(h.supervisor.running()) == {team.lead.id, team.data.id}
        await h.supervisor.stop_agent(team.data.id)
        assert h.supervisor.running() == [team.lead.id]
    finally:
        await h.supervisor.stop_all()
