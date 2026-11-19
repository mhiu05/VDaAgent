"""Keys, checks, defaults and cascades doc 10 states for each table."""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import delete, func, insert, select

from backend.db import tables as t
from backend.tests.db.conftest import TRACE
from backend.tests.dbutil import assert_violates

# --- Conventions --------------------------------------------------------------------------


async def test_uuid_ids_and_timestamps_default(conn, rows):
    user = await rows.user()
    assert isinstance(user, uuid.UUID)
    query = select(t.users.c.created_at).where(t.users.c.id == user)
    created = (await conn.execute(query)).scalar()
    assert isinstance(created, datetime)
    assert created.tzinfo is not None


async def test_bigint_ids_are_ordered(conn, rows):
    thread = await rows.thread(await rows.user())
    first, second = await rows.message(thread), await rows.message(thread)
    assert isinstance(first, int)
    assert second > first


async def test_enum_rejects_unknown_value(conn, rows):
    await assert_violates(
        conn, insert(t.domains).values(id="x", name="X", status="bogus"), "ck_domains_status"
    )


# --- users / auth_sessions ----------------------------------------------------------------


@pytest.mark.parametrize("username", ["ab", "Alice", "a" * 33, "bad name", "ồ-vi"])
async def test_username_format(conn, rows, username):
    domain = await rows.domain()
    stmt = insert(t.users).values(
        username=username, password_hash="h", role="user", domain_id=domain, status="active"
    )
    await assert_violates(conn, stmt, "ck_users_username")


async def test_username_unique(conn, rows):
    await rows.user(username="alice")
    domain = await rows.domain("other")
    stmt = insert(t.users).values(
        username="alice", password_hash="h", role="user", domain_id=domain, status="active"
    )
    await assert_violates(conn, stmt, "uq_users_username")


async def test_account_type_defaults_to_human(conn, rows):
    user = await rows.user()
    admin = await rows.user(role="admin")
    query = select(t.users.c.account_type).where(t.users.c.id.in_([user, admin]))
    assert set((await conn.execute(query)).scalars()) == {"human"}


async def test_account_type_values(conn, rows):
    domain = await rows.domain()
    stmt = insert(t.users).values(
        username="bogus",
        password_hash="h",
        role="user",
        domain_id=domain,
        status="active",
        account_type="group",
    )
    await assert_violates(conn, stmt, "ck_users_account_type")


async def test_service_account_is_never_admin(conn, rows):
    stmt = insert(t.users).values(
        username="svc.admin",
        password_hash="h",
        role="admin",
        status="active",
        account_type="service",
    )
    await assert_violates(conn, stmt, "ck_users_service_is_not_admin")
    assert await rows.user(username="svc.0123456789abcdef", account_type="service")


async def test_group_owner_unique_and_members_cascade(conn, rows):
    owner = await rows.user(account_type="service")
    alice = await rows.user()
    group = await rows.insert(
        t.groups, technical_owner_id=owner, name="Sales Team", created_by_user_id=alice
    )
    await rows.insert(t.group_members, group_id=group, user_id=alice)
    stmt = insert(t.groups).values(technical_owner_id=owner, name="Again", created_by_user_id=alice)
    await assert_violates(conn, stmt, "uq_groups_technical_owner_id")
    stmt = insert(t.groups).values(technical_owner_id=owner, name="", created_by_user_id=alice)
    await assert_violates(conn, stmt, "ck_groups_name")
    await conn.execute(delete(t.groups).where(t.groups.c.id == group))
    count = select(func.count()).select_from(t.group_members)
    assert (await conn.execute(count)).scalar() == 0


async def test_admin_has_no_domain_user_has_one(conn, rows):
    await rows.user(role="admin", domain_id=None)
    domain = await rows.domain("dx")
    base = {"password_hash": "h", "status": "active"}
    bad = [
        {"username": "admin2", "role": "admin", "domain_id": domain},
        {"username": "user9", "role": "user", "domain_id": None},
    ]
    for values in bad:
        await assert_violates(
            conn, insert(t.users).values(**base, **values), "ck_users_admin_has_no_domain"
        )


async def test_user_domain_must_exist(conn, rows):
    stmt = insert(t.users).values(
        username="ghost", password_hash="h", role="user", domain_id="nope", status="active"
    )
    await assert_violates(conn, stmt, "fk_users_domain_id")


async def test_display_name_defaults_empty_and_max_100(conn, rows):
    user = await rows.user()
    name = (await conn.execute(select(t.users.c.display_name).where(t.users.c.id == user))).scalar()
    assert name == ""
    await rows.user(display_name="x" * 100)
    domain = await rows.domain("dn")
    stmt = insert(t.users).values(
        username="long",
        display_name="x" * 101,
        password_hash="h",
        role="user",
        domain_id=domain,
        status="active",
    )
    await assert_violates(conn, stmt, "ck_users_display_name")


async def test_sessions_cascade_with_user_and_hash_is_sha256(conn, rows):
    user = await rows.user()
    await rows.session(user, b"one")
    await rows.session(user, b"two")
    stmt = insert(t.auth_sessions).values(token_hash=b"short", user_id=user, expires_at=func.now())
    await assert_violates(conn, stmt, "ck_auth_sessions_token_hash")
    await conn.execute(delete(t.users).where(t.users.c.id == user))
    count = await conn.execute(select(func.count()).select_from(t.auth_sessions))
    assert count.scalar() == 0


# --- agents / epochs ----------------------------------------------------------------------


async def test_agent_slug_unique_per_user(conn, rows):
    alice, bob = await rows.user(), await rows.user()
    agent = await rows.agent(alice, slug="data")
    await rows.agent(bob, slug="data")
    row = (await conn.execute(select(t.agents).where(t.agents.c.id == agent))).one()
    stmt = insert(t.agents).values(
        user_id=alice,
        slug="data",
        display_name="D",
        avatar={},
        origin="custom",
        state="deleted",
        status="idle",
        baseline_commit="x",
    )
    await assert_violates(conn, stmt, "uq_agents_user_id_slug")
    assert row.compaction_pending is False
    assert row.compaction_failures == 0
    assert row.is_lead is False


@pytest.mark.parametrize("slug", ["a", "-data", "Data", "da_ta", "x" * 33])
async def test_agent_slug_format(conn, rows, slug):
    user = await rows.user()
    stmt = insert(t.agents).values(
        user_id=user,
        slug=slug,
        display_name="D",
        avatar={},
        origin="custom",
        state="active",
        status="idle",
        baseline_commit="x",
    )
    await assert_violates(conn, stmt, "ck_agents_slug")


async def test_one_lead_per_user(conn, rows):
    alice, bob = await rows.user(), await rows.user()
    await rows.agent(alice, slug="lead", origin="lead", is_lead=True)
    await rows.agent(bob, slug="lead", origin="lead", is_lead=True)
    await rows.agent(alice, slug="data")  # non-leads are unlimited
    stmt = insert(t.agents).values(
        user_id=alice,
        slug="lead2",
        display_name="L",
        avatar={},
        origin="lead",
        is_lead=True,
        state="active",
        status="idle",
        baseline_commit="x",
    )
    await assert_violates(conn, stmt, "uq_agents_one_lead_per_user")


async def test_epochs_keyed_by_agent_and_epoch(conn, rows):
    agent = await rows.agent(await rows.user())
    base = {"agent_id": agent, "start_seq": 0, "system_prompt": "p", "reason": "initial"}
    key = await rows.insert(t.agent_epochs, epoch=0, **base)
    assert key == (agent, 0)
    summary = await conn.execute(select(t.agent_epochs.c.summary))
    assert summary.scalar() == ""
    await assert_violates(conn, insert(t.agent_epochs).values(epoch=0, **base), "pk_agent_epochs")
    await assert_violates(
        conn, insert(t.agent_epochs).values(epoch=-1, **base), "ck_agent_epochs_epoch"
    )


async def test_event_task_must_exist(conn, rows):
    agent = await rows.agent(await rows.user())
    stmt = insert(t.events).values(
        agent_id=agent,
        seq=1,
        epoch=0,
        kind="input",
        payload={},
        trace_id=TRACE,
        activation_kind="task",
        task_id=999_999,
    )
    await assert_violates(conn, stmt, "fk_events_task_id")


# --- threads / messages -------------------------------------------------------------------


async def test_member_key_unique_for_direct_and_agent_threads(conn, rows):
    user = await rows.user()
    for kind in ("direct", "agent"):
        await rows.thread(user, kind=kind, name=None, member_key="data+lead")
        stmt = insert(t.threads).values(user_id=user, kind=kind, member_key="data+lead")
        await assert_violates(conn, stmt, "uq_threads_member_key")
    # Groups may share a member set.
    await rows.thread(user, kind="group", member_key="data+lead")
    await rows.thread(user, kind="group", member_key="data+lead")
    # Another user's thread with the same key is fine.
    await rows.thread(await rows.user(), kind="agent", member_key="data+lead")


async def test_thread_members_key(conn, rows):
    user = await rows.user()
    thread = await rows.thread(user)
    await rows.insert(t.thread_members, thread_id=thread, member_type="user", member_id=user)
    stmt = insert(t.thread_members).values(thread_id=thread, member_type="user", member_id=user)
    await assert_violates(conn, stmt, "pk_thread_members")


async def test_system_messages_have_no_sender(conn, rows):
    user = await rows.user()
    thread = await rows.thread(user)
    await rows.message(thread, sender_type="user", sender_id=user)
    for values in (
        {"sender_type": "system", "sender_id": user},
        {"sender_type": "agent", "sender_id": None},
    ):
        stmt = insert(t.messages).values(thread_id=thread, content={}, **values)
        await assert_violates(conn, stmt, "ck_messages_system_has_no_sender")


# --- tasks, jev, jobs ---------------------------------------------------------------------


async def test_task_involvement_key(conn, rows):
    user = await rows.user()
    agent = await rows.agent(user)
    task = await rows.task(user, status="running")
    await rows.insert(t.task_involvement, task_id=task, agent_id=agent)
    stmt = insert(t.task_involvement).values(task_id=task, agent_id=agent)
    await assert_violates(conn, stmt, "pk_task_involvement")


async def test_jev_observed_is_a_label(conn, rows):
    user = await rows.user()
    lead = await rows.agent(user, slug="lead", origin="lead", is_lead=True)
    msg = await rows.message(await rows.thread(user))
    base = {
        "message_id": msg,
        "lead_id": lead,
        "input": {},
        "label": "task",
        "confidence": 0.9,
        "model": "m",
        "latency_ms": 10,
        "trace_id": TRACE,
    }
    await rows.insert(t.jev_decisions, **base, observed="side_question")
    stmt = insert(t.jev_decisions).values(**base, observed="maybe")
    await assert_violates(conn, stmt, "ck_jev_decisions_observed")


async def test_routine_state_key(conn, rows):
    agent = await rows.agent(await rows.user())
    base = {
        "agent_id": agent,
        "name": "bao-cao-sang",
        "cron": "0 8 * * *",
        "enabled": True,
        "prompt_sha": "a" * 64,
    }
    await rows.insert(t.routine_state, **base)
    await assert_violates(conn, insert(t.routine_state).values(**base), "pk_routine_state")


async def test_jobs_defaults(conn, rows):
    user = await rows.user()
    job = await rows.insert(t.jobs, user_id=user, kind="agent_create", request={}, status="queued")
    row = (await conn.execute(select(t.jobs).where(t.jobs.c.id == job))).one()
    assert row.output == ""
    assert row.agent_id is None
    assert row.finished_at is None


async def test_jobs_kind_includes_user_provisioning(conn, rows):
    # Doc 12 "Provisioning a user": one job per created user (S2 adds the kind).
    user = await rows.user(status="provisioning")
    await rows.insert(t.jobs, user_id=user, kind="user_provision", request={}, status="queued")
    bad = insert(t.jobs).values(user_id=user, kind="provision", request={}, status="queued")
    await assert_violates(conn, bad, "ck_jobs_kind")


# --- workspace extensions -----------------------------------------------------------------


async def test_report_code_unique_per_user_and_formats(conn, rows):
    alice, bob = await rows.user(), await rows.user()
    agent_a, agent_b = await rows.agent(alice), await rows.agent(bob)
    await rows.report(alice, agent_a, code="R001")
    await rows.report(bob, agent_b, code="R001")
    await assert_violates(
        conn,
        insert(t.reports).values(user_id=alice, code="R001", title="x", type="t", agent_id=agent_a),
        "uq_reports_user_id_code",
    )
    await assert_violates(
        conn,
        insert(t.reports).values(user_id=alice, code="X1", title="x", type="t", agent_id=agent_a),
        "ck_reports_code",
    )
    for bad_type in ("Sales", "1abc", "a" * 81, "a_b"):
        await assert_violates(
            conn,
            insert(t.reports).values(
                user_id=alice, code="R900", title="x", type=bad_type, agent_id=agent_a
            ),
            "ck_reports_type",
        )


async def test_preferences_one_row_per_user(conn, rows):
    user = await rows.user()
    await rows.insert(t.user_preferences, user_id=user, value={"theme": "dark"})
    stmt = insert(t.user_preferences).values(user_id=user, value={})
    await assert_violates(conn, stmt, "pk_user_preferences")
