"""The migrated schema is exactly `backend/db/tables.py` (doc 10)."""

from __future__ import annotations

import asyncio
import re

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text

from backend.db import migrate
from backend.db.session import create_engine
from backend.db.tables import metadata
from backend.tests.dbutil import recreate_database, with_database

# Every table doc 10 names, workspace extensions included.
DOC_10_TABLES = {
    "domains",
    "domain_credential_sets",
    "domain_credential_values",
    "domain_starters",
    "users",
    "auth_sessions",
    "agents",
    "agent_epochs",
    "events",
    "threads",
    "thread_members",
    "messages",
    "attachments",
    "telegram_links",
    "telegram_link_codes",
    "groups",
    "group_members",
    "deliveries",
    "global_tasks",
    "task_involvement",
    "jev_decisions",
    "routine_state",
    "skill_catalog",
    "library_presets",
    "jobs",
    "reports",
    "report_attempts",
    "report_versions",
    "report_artifacts",
    "report_evidence",
    "datasets",
    "user_notifications",
    "user_preferences",
}

# Enum columns and their values, as doc 10 lists them.
DOC_10_ENUMS = {
    ("domains", "status"): {"available", "unavailable"},
    ("users", "role"): {"user", "admin"},
    ("users", "status"): {"provisioning", "active", "failed", "disabled"},
    ("users", "account_type"): {"human", "service"},
    ("agents", "origin"): {"lead", "starter", "custom"},
    ("agents", "state"): {"active", "deleted"},
    ("agents", "status"): {"idle", "busy", "routine", "compacting"},
    ("agent_epochs", "reason"): {"initial", "compaction", "reset", "truncated"},
    ("events", "kind"): {"input", "assistant", "tool_result", "error"},
    ("events", "activation_kind"): {"message", "routine", "compaction", "task"},
    ("threads", "kind"): {"direct", "group", "agent"},
    ("thread_members", "member_type"): {"user", "agent"},
    ("messages", "sender_type"): {"user", "agent", "system"},
    ("deliveries", "route"): {"notification", "jev"},
    ("deliveries", "status"): {"classifying", "pending", "consumed"},
    ("global_tasks", "status"): {"queued", "running", "done", "failed", "cancelled"},
    ("global_tasks", "ended_by"): {"lead", "user", "timeout", "harness"},
    ("jev_decisions", "label"): {"task", "side_question"},
    ("jev_decisions", "observed"): {"task", "side_question"},
    ("jobs", "kind"): {
        "agent_create",
        "agent_reset",
        "skill_install",
        "skill_remove",
        "package_add",
        "package_remove",
        "preset_apply",
        "user_provision",
    },
    ("jobs", "status"): {"queued", "running", "done", "failed"},
    ("report_attempts", "state"): {"queued", "running", "succeeded", "failed"},
    ("datasets", "kind"): {"dashboard"},
    ("user_notifications", "kind"): {
        "account-created",
        "system",
        "report-ready",
        "task-failed",
        "action-required",
    },
}

# The indexes doc 10 states (beyond primary keys and UNIQUE constraints).
DOC_10_INDEXES = {
    "uq_agents_one_lead_per_user": r"UNIQUE INDEX .* ON public.agents USING btree \(user_id\) "
    r"WHERE is_lead$",
    "uq_threads_member_key": r"UNIQUE INDEX .* \(user_id, kind, member_key\) "
    r"WHERE \(kind = ANY \(ARRAY\['direct'::text, 'agent'::text\]\)\)",
    "ix_messages_thread_id_id": r"USING btree \(thread_id, id\)",
    "ix_deliveries_pending": r"USING btree \(agent_id\) WHERE \(status = 'pending'::text\)",
    "uq_global_tasks_one_running_per_user": r"UNIQUE INDEX .* \(user_id\) "
    r"WHERE \(status = 'running'::text\)",
    "ix_skill_catalog_tags": r"USING gin \(tags\)",
    "uq_report_attempts_one_running_per_report": r"UNIQUE INDEX .* \(report_id\) "
    r"WHERE \(state = 'running'::text\)",
    "ix_user_notifications_user_id_occurred_at": r"USING btree \(user_id, occurred_at DESC\)",
}

CATALOG_QUERIES = {
    "columns": """
        SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
               character_maximum_length, is_identity
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'alembic_version'""",
    "constraints": """
        SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid),
               condeferrable, condeferred
        FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND conrelid::regclass::text <> 'alembic_version'""",
    "indexes": """
        SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename <> 'alembic_version'""",
    "triggers": """
        SELECT event_object_table, trigger_name, action_timing, event_manipulation,
               action_statement
        FROM information_schema.triggers WHERE trigger_schema = 'public'""",
    "functions": """
        SELECT proname, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace""",
}


async def _catalog(conn) -> dict[str, set[tuple]]:
    out = {}
    for name, sql in CATALOG_QUERIES.items():
        rows = (await conn.execute(text(sql))).all()
        out[name] = {tuple(r) for r in rows}
    return out


async def _tables(conn) -> set[str]:
    rows = await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
    return {r[0] for r in rows}


async def test_every_doc_10_table_exists(conn):
    assert await _tables(conn) == DOC_10_TABLES | {"alembic_version"}
    assert set(metadata.tables) == DOC_10_TABLES


async def test_head_revision_applied(conn):
    head = ScriptDirectory.from_config(migrate.config("unused")).get_current_head()
    assert head is not None
    assert (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar() == head


async def test_autogenerate_finds_no_diff(conn):
    def diff(sync_conn):
        ctx = MigrationContext.configure(
            sync_conn, opts={"compare_type": True, "compare_server_default": True}
        )
        return compare_metadata(ctx, metadata)

    assert await conn.run_sync(diff) == []


async def test_enum_checks_match_doc_10(conn):
    rows = await conn.execute(
        text(
            "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) "
            "FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace"
        )
    )
    defs = {(t, name): d for t, name, d in rows}
    for (table, column), values in DOC_10_ENUMS.items():
        definition = defs[(table, f"ck_{table}_{column}")]
        assert set(re.findall(r"'([^']*)'::text", definition)) == values, (table, column)


async def test_doc_10_indexes(conn):
    rows = await conn.execute(text("SELECT indexname, indexdef FROM pg_indexes"))
    defs = dict(rows.all())
    for name, pattern in DOC_10_INDEXES.items():
        assert name in defs, name
        assert re.search(pattern, defs[name]), defs[name]


async def test_migration_matches_create_all(migrated_url, conn):
    """`create_all` (tables.py, triggers included) and the migration give the same catalog."""
    scratch = with_database(migrated_url, "contoso_test_create_all")
    await recreate_database(scratch)
    eng = create_engine(scratch)
    try:
        async with eng.begin() as c:
            await c.run_sync(metadata.create_all)
        async with eng.connect() as c:
            expected = await _catalog(c)
    finally:
        await eng.dispose()
    actual = await _catalog(conn)
    for key in CATALOG_QUERIES:
        assert actual[key] == expected[key], (
            key,
            sorted(actual[key] - expected[key]),
            sorted(expected[key] - actual[key]),
        )


async def test_downgrade_and_upgrade_round_trip(migrated_url):
    scratch = with_database(migrated_url, "contoso_test_round_trip")
    await recreate_database(scratch)
    eng = create_engine(scratch)
    try:
        await asyncio.to_thread(migrate.upgrade, scratch)
        await asyncio.to_thread(migrate.upgrade, scratch)  # idempotent
        async with eng.connect() as c:
            assert await _tables(c) == DOC_10_TABLES | {"alembic_version"}
        await asyncio.to_thread(migrate.downgrade, scratch, "base")
        async with eng.connect() as c:
            assert await _tables(c) == {"alembic_version"}
            functions = await c.execute(
                text("SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace")
            )
            assert functions.scalar() == 0
        await asyncio.to_thread(migrate.upgrade, scratch)
        async with eng.connect() as c:
            assert await _tables(c) == DOC_10_TABLES | {"alembic_version"}
    finally:
        await eng.dispose()
