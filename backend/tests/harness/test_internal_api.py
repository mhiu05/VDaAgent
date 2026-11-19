"""The internal API on :8001 and its exec-token auth (doc 11, doc 15 "Internal API")."""

from __future__ import annotations

import time

import httpx

from backend.api.internal import create_internal_app
from backend.harness.tokens import ExecContext, sign


def ctx(team, exec_id="x_1"):
    return ExecContext(
        agent_id=team.data.id,
        user_id=team.user,
        slug="data",
        is_lead=False,
        exec_id=exec_id,
        trace_id="0" * 32,
        activation_kind="message",
        task_id=None,
        default_thread="direct:data",
        folder="/f",
    )


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://internal")


async def test_whoami_with_a_live_token(make_harness, team, settings):
    h = make_harness()
    h.registry.start(ctx(team), now=time.time())
    token = sign(
        settings.SESSION_SECRET.get_secret_value(), team.data.id, "x_1", exp=int(time.time()) + 60
    )
    async with client(create_internal_app(h)) as c:
        r = await c.get("/internal/v1/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"agent": "data", "exec_id": "x_1", "activation_kind": "message"}


async def test_bad_tokens_are_401(make_harness, team, settings):
    h = make_harness()
    h.registry.start(ctx(team), now=time.time())
    secret = settings.SESSION_SECRET.get_secret_value()
    expired = sign(secret, team.data.id, "x_1", exp=int(time.time()) - 1)
    other_exec = sign(secret, team.data.id, "x_2", exp=int(time.time()) + 60)
    async with client(create_internal_app(h)) as c:
        for headers in (
            {},
            {"Authorization": "Bearer nope"},
            {"Authorization": f"Bearer {expired}"},
            {"Authorization": f"Bearer {other_exec}"},
        ):
            r = await c.get("/internal/v1/whoami", headers=headers)
            assert r.status_code == 401, headers
            assert r.json()["error"] == "unauthenticated"


async def test_after_the_grace_period_the_token_is_dead(make_harness, team, settings):
    h = make_harness()
    now = time.time()
    h.registry.start(ctx(team), now=now - 30)
    h.registry.end("x_1", now=now - 6)
    token = sign(settings.SESSION_SECRET.get_secret_value(), team.data.id, "x_1", exp=int(now) + 60)
    async with client(create_internal_app(h)) as c:
        r = await c.get("/internal/v1/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


async def test_notices_insert_a_pending_delivery_and_wake(conn, make_harness, team):
    from sqlalchemy import select

    from backend.db import tables as t
    from backend.harness.notices import send_notice

    h = make_harness()
    woken = []
    h.wake = woken.append
    async with h.db() as c:
        await send_notice(h, c, team.data.id, "builder", "Kỹ năng mới: xlsx")
        assert woken == []  # only after commit
    assert woken == [team.data.id]
    row = (
        await conn.execute(select(t.deliveries).where(t.deliveries.c.agent_id == team.data.id))
    ).one()
    assert row.notice == {"kind": "builder", "text": "Kỹ năng mới: xlsx"}
    assert (row.route, row.status, row.message_id) == ("notification", "pending", None)
