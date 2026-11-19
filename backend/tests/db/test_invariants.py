"""Doc 10 "Invariants" that the database enforces (1, 3, 6, 8, 9).

Invariants 2, 4, 5 and 7 need application code; TODO.md lists them under the sections
that own them.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, func, select, text, update

from backend.db import tables as t
from backend.tests.db.conftest import SHA, TRACE
from backend.tests.dbutil import assert_rejected, assert_violates

APPEND_ONLY = "events are append-only"


# --- 1. events is append-only, except a batch offload of a tool_result --------------------


async def _tool_result(rows, agent_id, seq=1):
    payload = {
        "tool_call_id": "call_1",
        "exec_id": "x_1",
        "text": "a" * 10_000,
        "exit_code": 0,
        "final": False,
        "batch_offloaded_at": None,
        "system": False,
    }
    return await rows.event(agent_id, seq, kind="tool_result", payload=payload)


async def test_events_reject_update_and_delete(conn, rows):
    agent = await rows.agent(await rows.user())
    event_id = await rows.event(agent, 1, kind="assistant", payload={"text": "hi"})
    by_id = t.events.c.id == event_id
    await assert_rejected(conn, update(t.events).where(by_id).values(payload={}), APPEND_ONLY)
    await assert_rejected(conn, update(t.events).where(by_id).values(seq=2), APPEND_ONLY)
    await assert_rejected(conn, delete(t.events).where(by_id), APPEND_ONLY)


async def test_events_allow_batch_offload_of_tool_result(conn, rows):
    agent = await rows.agent(await rows.user())
    event_id = await _tool_result(rows, agent)
    offload = text(
        "UPDATE events SET payload = payload "
        "|| jsonb_build_object('text', 'offloaded: .contoso/outputs/x_1.txt') "
        "|| jsonb_build_object('batch_offloaded_at', now()::text) WHERE id = :id"
    )
    await conn.execute(offload, {"id": event_id})
    query = select(t.events.c.payload).where(t.events.c.id == event_id)
    payload = (await conn.execute(query)).scalar()
    assert payload["text"].startswith("offloaded:")
    assert payload["batch_offloaded_at"]
    assert payload["exit_code"] == 0

    # Offloaded once only.
    again = text(
        "UPDATE events SET payload = payload || jsonb_build_object('text', 'x') WHERE id = :id"
    )
    await assert_rejected(conn, again.bindparams(id=event_id), APPEND_ONLY)


async def test_events_batch_offload_may_touch_only_text(conn, rows):
    agent = await rows.agent(await rows.user())
    event_id = await _tool_result(rows, agent)
    other_key = text(
        "UPDATE events SET payload = payload || '{\"exit_code\": 1}'::jsonb "
        "|| jsonb_build_object('batch_offloaded_at', now()::text) WHERE id = :id"
    ).bindparams(id=event_id)
    await assert_rejected(conn, other_key, APPEND_ONLY)
    other_column = text(
        "UPDATE events SET epoch = 1, payload = payload "
        "|| jsonb_build_object('batch_offloaded_at', now()::text) WHERE id = :id"
    ).bindparams(id=event_id)
    await assert_rejected(conn, other_column, APPEND_ONLY)
    no_marker = text(
        "UPDATE events SET payload = payload || jsonb_build_object('text', 'x') WHERE id = :id"
    ).bindparams(id=event_id)
    await assert_rejected(conn, no_marker, APPEND_ONLY)


async def test_events_seq_unique_per_agent(conn, rows):
    user = await rows.user()
    a, b = await rows.agent(user), await rows.agent(user)
    await rows.event(a, 1)
    await rows.event(b, 1)  # another agent may reuse the number
    stmt = t.events.insert().values(
        agent_id=a,
        seq=1,
        epoch=0,
        kind="input",
        payload={},
        trace_id=TRACE,
        activation_kind="message",
    )
    await assert_violates(conn, stmt, "uq_events_agent_id_seq")


# --- 3. at most one running global task per user ----------------------------------------


async def test_one_running_task_per_user(conn, rows):
    alice, bob = await rows.user(), await rows.user()
    await rows.task(alice, status="running")
    await rows.task(alice, status="queued")
    await rows.task(alice, status="done")
    await rows.task(alice, status="done")
    await rows.task(bob, status="running")  # other users are independent
    stmt = t.global_tasks.insert().values(user_id=alice, description="2nd", status="running")
    await assert_violates(conn, stmt, "uq_global_tasks_one_running_per_user")


async def test_starting_a_queued_task_while_one_runs_fails(conn, rows):
    alice = await rows.user()
    await rows.task(alice, status="running")
    queued = await rows.task(alice, status="queued")
    stmt = (
        update(t.global_tasks)
        .where(t.global_tasks.c.id == queued)
        .values(status="running", started_at=func.now())
    )
    await assert_violates(conn, stmt, "uq_global_tasks_one_running_per_user")


# --- 6. a delivery is consumed by exactly one input event (or a jev begin_task) ----------


async def test_delivery_consumed_by_one_event_of_its_agent(conn, rows):
    user = await rows.user()
    agent, other = await rows.agent(user), await rows.agent(user)
    thread = await rows.thread(user)
    msg = await rows.message(thread)
    await rows.event(agent, 1)
    await rows.event(other, 2)
    d = await rows.insert(
        t.deliveries, agent_id=agent, message_id=msg, route="notification", status="pending"
    )
    by_id = t.deliveries.c.id == d
    # The FK is deferred (event and delivery are written in one transaction); check it now.
    await conn.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    await conn.execute(update(t.deliveries).where(by_id).values(status="consumed", consumed_seq=1))
    # seq 2 exists only for another agent.
    await assert_violates(
        conn,
        update(t.deliveries).where(by_id).values(consumed_seq=2),
        "fk_deliveries_agent_id_consumed_seq",
    )


async def test_delivery_fk_is_deferred_to_commit(conn, rows):
    user = await rows.user()
    agent = await rows.agent(user)
    msg = await rows.message(await rows.thread(user))
    # Consumption may be recorded before its input event within the transaction.
    await rows.insert(
        t.deliveries,
        agent_id=agent,
        message_id=msg,
        route="notification",
        status="consumed",
        consumed_seq=7,
    )
    await rows.event(agent, 7)
    await conn.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


async def test_only_consumed_deliveries_have_consumed_seq(conn, rows):
    user = await rows.user()
    agent = await rows.agent(user)
    await rows.event(agent, 1)
    msg = await rows.message(await rows.thread(user))
    stmt = t.deliveries.insert().values(
        agent_id=agent, message_id=msg, route="notification", status="pending", consumed_seq=1
    )
    await assert_violates(conn, stmt, "ck_deliveries_consumed_seq")
    # A jev-labelled task consumes its delivery without an input event.
    await rows.insert(t.deliveries, agent_id=agent, message_id=msg, route="jev", status="consumed")


async def test_delivery_is_a_message_or_a_notice(conn, rows):
    user = await rows.user()
    agent = await rows.agent(user)
    msg = await rows.message(await rows.thread(user))
    notice = {"kind": "builder", "text": "đã cài"}
    base = {"agent_id": agent, "route": "notification", "status": "pending"}
    await rows.insert(t.deliveries, message_id=msg, **base)
    await rows.insert(t.deliveries, notice=notice, **base)
    for values in ({}, {"message_id": msg, "notice": notice}):
        await assert_violates(
            conn, t.deliveries.insert().values(**base, **values), "ck_deliveries_message_or_notice"
        )


# --- 8. report versions, artifacts and evidence are never updated or deleted -------------


async def test_report_versions_artifacts_evidence_are_immutable(conn, rows):
    user = await rows.user()
    agent = await rows.agent(user)
    report = await rows.report(user, agent)
    version = await rows.version(report)
    artifact = await rows.insert(
        t.report_artifacts,
        version_id=version,
        filename="r.pdf",
        mime="application/pdf",
        size=1,
        sha256=SHA,
        path=f"/data/reports/{version}/r.pdf",
    )
    await rows.insert(
        t.report_evidence,
        version_id=version,
        id="E1",
        label="Kho",
        source_id="wh",
        data_through=datetime(2026, 10, 1, tzinfo=UTC),
        limitation="",
    )
    cases = [
        (t.report_versions, t.report_versions.c.id == version, {"policy_version": "p2"}),
        (t.report_artifacts, t.report_artifacts.c.id == artifact, {"size": 2}),
        (t.report_evidence, t.report_evidence.c.id == "E1", {"label": "Khác"}),
    ]
    for table, where, values in cases:
        message = f"{table.name} rows are never updated or deleted"
        await assert_rejected(conn, update(table).where(where).values(**values), message)
        await assert_rejected(conn, delete(table).where(where), message)
    # A change is a new version.
    await rows.version(report, sequence=2)
    await assert_violates(
        conn,
        t.report_versions.insert().values(
            report_id=report,
            sequence=2,
            schema={},
            source={},
            policy_version="p",
            content_revision="c",
            trace_id=TRACE,
        ),
        "uq_report_versions_report_id_sequence",
    )


# --- 9. at most one running attempt per report ------------------------------------------


async def test_one_running_attempt_per_report(conn, rows):
    user = await rows.user()
    agent = await rows.agent(user)
    r1, r2 = await rows.report(user, agent), await rows.report(user, agent)
    await rows.insert(t.report_attempts, report_id=r1, agent_id=agent, state="running")
    await rows.insert(t.report_attempts, report_id=r1, agent_id=agent, state="failed")
    await rows.insert(t.report_attempts, report_id=r1, agent_id=agent, state="queued")
    await rows.insert(t.report_attempts, report_id=r2, agent_id=agent, state="running")
    stmt = t.report_attempts.insert().values(report_id=r1, agent_id=agent, state="running")
    await assert_violates(conn, stmt, "uq_report_attempts_one_running_per_report")
