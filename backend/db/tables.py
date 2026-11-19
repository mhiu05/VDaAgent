"""Every Postgres table of doc 10 (SQLAlchemy Core).

Conventions (doc 10 "Conventions"): uuid ids from `gen_random_uuid()`, `bigint` identity ids
where order matters, `timestamptz` defaulting to `now()`, enums as `text` + `CHECK`, `jsonb`.
A column is `NOT NULL` unless doc 10 says "null".

Constraint names come from `NAMING`, so tests and error handling can match on them. The
migration in `backend/alembic/versions/` must produce exactly this schema; the test
`backend/tests/db/test_schema.py` compares both.
"""

from __future__ import annotations

from sqlalchemy import (
    DDL,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    PrimaryKeyConstraint,
    String,
    Table,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TIMESTAMP, UUID

NAMING = {
    "pk": "pk_%(table_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
}

metadata = MetaData(naming_convention=NAMING)

TZ = TIMESTAMP(timezone=True)
NOW = text("now()")
FALSE = text("false")
URGENCY_NORMAL = text("'normal'")
EMPTY_TEXT = text("''")
EMPTY_ARRAY = text("'{}'")


def _uuid_pk() -> Column:
    return Column(
        "id", UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )


def _identity_pk() -> Column:
    return Column("id", BigInteger, Identity(always=False), primary_key=True)


def _created_at(name: str = "created_at") -> Column:
    return Column(name, TZ, nullable=False, server_default=NOW)


def _enum(column: str, *values: str, nullable: bool = False) -> CheckConstraint:
    """`CHECK (column IN (...))`, named `ck_<table>_<column>`."""
    allowed = ", ".join(f"'{v}'" for v in values)
    expr = f"{column} IN ({allowed})"
    if nullable:
        expr = f"{column} IS NULL OR {expr}"
    return CheckConstraint(expr, name=column)


def _fk(target: str, **kw) -> ForeignKey:
    return ForeignKey(target, **kw)


# --- Enum values (doc 10) ---------------------------------------------------------------

DOMAIN_STATUS = ("available", "unavailable")
USER_ROLE = ("user", "admin")
# `service`: a group's technical owner (PLAN_GROUPCHAT §5) — owns the group's agents, never logs in.
USER_ACCOUNT_TYPE = ("human", "service")
USER_STATUS = ("provisioning", "active", "failed", "disabled")
AGENT_ORIGIN = ("lead", "starter", "custom")
AGENT_STATE = ("active", "deleted")
AGENT_STATUS = ("idle", "busy", "routine", "compacting")
EPOCH_REASON = ("initial", "compaction", "reset", "truncated")
EVENT_KIND = ("input", "assistant", "tool_result", "error")
ACTIVATION_KIND = ("message", "routine", "compaction", "task")
THREAD_KIND = ("direct", "group", "agent")
MEMBER_TYPE = ("user", "agent")
SENDER_TYPE = ("user", "agent", "system")
DELIVERY_ROUTE = ("notification", "jev")
DELIVERY_STATUS = ("classifying", "pending", "consumed")
URGENCY = ("low", "normal", "high")
TASK_STATUS = ("queued", "running", "done", "failed", "cancelled")
TASK_ENDED_BY = ("lead", "user", "timeout", "harness")
JEV_LABEL = ("task", "side_question")
JOB_KIND = (
    "agent_create",
    "agent_reset",
    "skill_install",
    "skill_remove",
    "package_add",
    "package_remove",
    "preset_apply",
    "user_provision",
)
JOB_STATUS = ("queued", "running", "done", "failed")
ATTEMPT_STATE = ("queued", "running", "succeeded", "failed")
DATASET_KIND = ("dashboard",)
NOTIFICATION_KIND = ("account-created", "system", "report-ready", "task-failed", "action-required")

# --- Core tables ------------------------------------------------------------------------

domains = Table(
    "domains",
    metadata,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("status_reason", Text),
    Column("synced_at", TZ, nullable=False, server_default=NOW),
    Column("created_by", Text),
    _enum("status", *DOMAIN_STATUS),
)

# Admin-managed domain content (doc 12 "Domains"): declarations here, values (encrypted) in
# `domain_credential_values`, never read back out over the API.
domain_credential_sets = Table(
    "domain_credential_sets",
    metadata,
    _uuid_pk(),
    Column("domain_id", Text, _fk("domains.id"), nullable=False),
    Column("name", Text, nullable=False),
    Column("description", Text, nullable=False, server_default=EMPTY_TEXT),
    Column("keys", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    UniqueConstraint("domain_id", "name"),
)

domain_credential_values = Table(
    "domain_credential_values",
    metadata,
    Column("set_id", UUID(as_uuid=True), _fk("domain_credential_sets.id"), nullable=False),
    Column("key", Text, nullable=False),
    Column("ciphertext", LargeBinary, nullable=False),
    Column("updated_at", TZ, nullable=False, server_default=NOW),
    Column("updated_by", Text),
    PrimaryKeyConstraint("set_id", "key"),
)

domain_starters = Table(
    "domain_starters",
    metadata,
    _uuid_pk(),
    Column("domain_id", Text, _fk("domains.id"), nullable=False),
    Column("slug", Text, nullable=False),
    Column("display_name", Text, nullable=False, server_default=EMPTY_TEXT),
    Column("description", Text, nullable=False, server_default=EMPTY_TEXT),
    Column("avatar", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("presets", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("credentials", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("prompt", Text, nullable=False, server_default=EMPTY_TEXT),
    Column("is_lead", Boolean, nullable=False, server_default=FALSE),
    UniqueConstraint("domain_id", "slug"),
)

users = Table(
    "users",
    metadata,
    _uuid_pk(),
    Column("username", Text, nullable=False, unique=True),
    Column("display_name", Text, nullable=False, server_default=EMPTY_TEXT),
    Column("password_hash", Text, nullable=False),
    Column("role", Text, nullable=False),
    Column("domain_id", Text, _fk("domains.id")),
    Column("status", Text, nullable=False),
    Column("status_detail", Text),
    _created_at(),
    Column("account_type", Text, nullable=False, server_default=text("'human'")),
    CheckConstraint("username ~ '^[a-z0-9._-]{3,32}$'", name="username"),
    CheckConstraint("char_length(display_name) <= 100", name="display_name"),
    _enum("role", *USER_ROLE),
    CheckConstraint("(role = 'admin') = (domain_id IS NULL)", name="admin_has_no_domain"),
    _enum("status", *USER_STATUS),
    _enum("account_type", *USER_ACCOUNT_TYPE),
    CheckConstraint("account_type = 'human' OR role = 'user'", name="service_is_not_admin"),
)

auth_sessions = Table(
    "auth_sessions",
    metadata,
    Column("token_hash", LargeBinary, primary_key=True),
    Column("user_id", UUID(as_uuid=True), _fk("users.id", ondelete="CASCADE"), nullable=False),
    _created_at(),
    Column("last_seen_at", TZ, nullable=False, server_default=NOW),
    Column("expires_at", TZ, nullable=False),
    CheckConstraint("octet_length(token_hash) = 32", name="token_hash"),
    Index("ix_auth_sessions_user_id", "user_id"),
)

agents = Table(
    "agents",
    metadata,
    _uuid_pk(),
    Column("user_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    Column("slug", Text, nullable=False),
    Column("display_name", Text, nullable=False),
    Column("description", Text, nullable=False, server_default=EMPTY_TEXT),
    Column("avatar", JSONB, nullable=False),
    Column("origin", Text, nullable=False),
    Column("is_lead", Boolean, nullable=False, server_default=FALSE),
    Column("state", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("status_detail", Text),
    Column("compaction_pending", Boolean, nullable=False, server_default=FALSE),
    Column("compaction_failures", Integer, nullable=False, server_default=text("0")),
    Column("baseline_commit", Text, nullable=False),
    _created_at(),
    UniqueConstraint("user_id", "slug"),
    CheckConstraint("slug ~ '^[a-z0-9][a-z0-9-]{1,31}$'", name="slug"),
    _enum("origin", *AGENT_ORIGIN),
    _enum("state", *AGENT_STATE),
    _enum("status", *AGENT_STATUS),
    CheckConstraint("compaction_failures >= 0", name="compaction_failures"),
    Index(
        "uq_agents_one_lead_per_user",
        "user_id",
        unique=True,
        postgresql_where=text("is_lead"),
    ),
)

agent_epochs = Table(
    "agent_epochs",
    metadata,
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    Column("epoch", Integer, nullable=False),
    Column("start_seq", BigInteger, nullable=False),
    Column("system_prompt", Text, nullable=False),
    Column("summary", Text, nullable=False, server_default=EMPTY_TEXT),
    Column("reason", Text, nullable=False),
    _created_at(),
    PrimaryKeyConstraint("agent_id", "epoch"),
    CheckConstraint("epoch >= 0", name="epoch"),
    _enum("reason", *EPOCH_REASON),
)

threads = Table(
    "threads",
    metadata,
    _uuid_pk(),
    Column("user_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    Column("kind", Text, nullable=False),
    Column("name", Text),
    Column("member_key", Text),
    Column("read_only", Boolean, nullable=False, server_default=FALSE),
    Column("last_message_at", TZ, nullable=False, server_default=NOW),
    _enum("kind", *THREAD_KIND),
    Index(
        "uq_threads_member_key",
        "user_id",
        "kind",
        "member_key",
        unique=True,
        postgresql_where=text("kind IN ('direct', 'agent')"),
    ),
)

thread_members = Table(
    "thread_members",
    metadata,
    Column("thread_id", UUID(as_uuid=True), _fk("threads.id"), nullable=False),
    Column("member_type", Text, nullable=False),
    Column("member_id", UUID(as_uuid=True), nullable=False),
    Column("last_read_message_id", BigInteger),
    PrimaryKeyConstraint("thread_id", "member_type", "member_id"),
    _enum("member_type", *MEMBER_TYPE),
)

messages = Table(
    "messages",
    metadata,
    _identity_pk(),
    Column("thread_id", UUID(as_uuid=True), _fk("threads.id"), nullable=False),
    Column("sender_type", Text, nullable=False),
    Column("sender_id", UUID(as_uuid=True)),
    Column("content", JSONB, nullable=False),
    Column("trace_id", String(32)),
    Column("exec_id", Text),
    _created_at(),
    _enum("sender_type", *SENDER_TYPE),
    CheckConstraint("(sender_type = 'system') = (sender_id IS NULL)", name="system_has_no_sender"),
    Index("ix_messages_thread_id_id", "thread_id", "id"),
)

attachments = Table(
    "attachments",
    metadata,
    _uuid_pk(),
    Column("message_id", BigInteger, _fk("messages.id"), nullable=False),
    Column("filename", Text, nullable=False),
    Column("mime", Text, nullable=False),
    Column("size", BigInteger, nullable=False),
    Column("sha256", String(64), nullable=False),
    Column("path", Text, nullable=False),
    CheckConstraint("size >= 0", name="size"),
)

telegram_links = Table(
    "telegram_links",
    metadata,
    Column("user_id", UUID(as_uuid=True), _fk("users.id", ondelete="CASCADE"), primary_key=True),
    Column("chat_id", BigInteger, nullable=False),
    _created_at("linked_at"),
    UniqueConstraint("chat_id"),
)

telegram_link_codes = Table(
    "telegram_link_codes",
    metadata,
    Column("code", Text, primary_key=True),
    Column("user_id", UUID(as_uuid=True), _fk("users.id", ondelete="CASCADE"), nullable=False),
    Column("expires_at", TZ, nullable=False),
    _created_at(),
    Index("ix_telegram_link_codes_user_id", "user_id"),
)

# A group: human members sharing one technical owner (`users.account_type='service'`) whose
# agents are the group's team. Its status and domain are the technical owner's.
groups = Table(
    "groups",
    metadata,
    _uuid_pk(),
    Column("technical_owner_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    Column("name", Text, nullable=False),
    Column("created_by_user_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    _created_at(),
    UniqueConstraint("technical_owner_id"),
    CheckConstraint("char_length(name) BETWEEN 1 AND 100", name="name"),
)

group_members = Table(
    "group_members",
    metadata,
    Column("group_id", UUID(as_uuid=True), _fk("groups.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", UUID(as_uuid=True), _fk("users.id", ondelete="CASCADE"), primary_key=True),
    _created_at(),
    Index("ix_group_members_user_id", "user_id"),
)

global_tasks = Table(
    "global_tasks",
    metadata,
    _identity_pk(),
    Column("user_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    Column("source_message_id", BigInteger, _fk("messages.id")),
    Column("description", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("outcome", Text),
    Column("ended_by", Text),
    _created_at(),
    Column("started_at", TZ),
    Column("ended_at", TZ),
    _enum("status", *TASK_STATUS),
    _enum("ended_by", *TASK_ENDED_BY, nullable=True),
    # Invariant 3 (doc 10): at most one running task per user.
    Index(
        "uq_global_tasks_one_running_per_user",
        "user_id",
        unique=True,
        postgresql_where=text("status = 'running'"),
    ),
)

events = Table(
    "events",
    metadata,
    _identity_pk(),
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    Column("seq", BigInteger, nullable=False),
    Column("epoch", Integer, nullable=False),
    Column("kind", Text, nullable=False),
    Column("payload", JSONB, nullable=False),
    Column("trace_id", String(32), nullable=False),
    Column("activation_kind", Text, nullable=False),
    Column("task_id", BigInteger, _fk("global_tasks.id")),
    _created_at(),
    UniqueConstraint("agent_id", "seq"),
    _enum("kind", *EVENT_KIND),
    _enum("activation_kind", *ACTIVATION_KIND),
)

deliveries = Table(
    "deliveries",
    metadata,
    _identity_pk(),
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    Column("message_id", BigInteger, _fk("messages.id")),
    Column("notice", JSONB),
    Column("route", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("urgency", Text, nullable=False, server_default=URGENCY_NORMAL),
    Column("consumed_seq", BigInteger),
    _created_at(),
    CheckConstraint("(message_id IS NULL) <> (notice IS NULL)", name="message_or_notice"),
    _enum("route", *DELIVERY_ROUTE),
    _enum("status", *DELIVERY_STATUS),
    _enum("urgency", *URGENCY),
    # Invariant 6: the consuming `input` event is one event of the receiving agent.
    CheckConstraint("status = 'consumed' OR consumed_seq IS NULL", name="consumed_seq"),
    ForeignKeyConstraint(
        ["agent_id", "consumed_seq"],
        ["events.agent_id", "events.seq"],
        deferrable=True,
        initially="DEFERRED",
    ),
    Index("ix_deliveries_pending", "agent_id", postgresql_where=text("status = 'pending'")),
)

task_involvement = Table(
    "task_involvement",
    metadata,
    Column("task_id", BigInteger, _fk("global_tasks.id"), nullable=False),
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    Column("first_at", TZ, nullable=False, server_default=NOW),
    PrimaryKeyConstraint("task_id", "agent_id"),
)

jev_decisions = Table(
    "jev_decisions",
    metadata,
    _identity_pk(),
    Column("message_id", BigInteger, _fk("messages.id"), nullable=False),
    Column("lead_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    Column("input", JSONB, nullable=False),
    Column("label", Text, nullable=False),
    Column("confidence", Float, nullable=True),
    Column("urgency", Text, nullable=False, server_default=URGENCY_NORMAL),
    Column("fallback", Boolean, nullable=False, server_default=FALSE),
    Column("model", Text, nullable=False),
    Column("latency_ms", Integer, nullable=False),
    Column("trace_id", String(32), nullable=False),
    Column("observed", Text),
    Column("observed_by", UUID(as_uuid=True)),
    _created_at(),
    _enum("label", *JEV_LABEL),
    _enum("urgency", *URGENCY),
    _enum("observed", *JEV_LABEL, nullable=True),
)

routine_state = Table(
    "routine_state",
    metadata,
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    Column("name", Text, nullable=False),
    Column("cron", Text, nullable=False),
    Column("enabled", Boolean, nullable=False),
    Column("prompt_sha", String(64), nullable=False),
    Column("next_fire_at", TZ),
    Column("last_fired_at", TZ),
    Column("last_started_at", TZ),
    Column("last_ended_at", TZ),
    Column("pending", Boolean, nullable=False, server_default=FALSE),
    PrimaryKeyConstraint("agent_id", "name"),
)

skill_catalog = Table(
    "skill_catalog",
    metadata,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("title_vi", Text, nullable=False),
    Column("description_vi", Text, nullable=False),
    Column("tags", ARRAY(Text), nullable=False, server_default=EMPTY_ARRAY),
    Column("install_cmd", ARRAY(Text), nullable=False),
    Column("domain_id", Text, _fk("domains.id")),
    Column("seeded_at", TZ, nullable=False, server_default=NOW),
    Index("ix_skill_catalog_tags", "tags", postgresql_using="gin"),
)

library_presets = Table(
    "library_presets",
    metadata,
    Column("id", Text, primary_key=True),
    Column("title_vi", Text, nullable=False),
    Column("description_vi", Text, nullable=False),
    Column("packages", ARRAY(Text), nullable=False),
    Column("domain_id", Text, _fk("domains.id")),
)

jobs = Table(
    "jobs",
    metadata,
    _uuid_pk(),
    Column("user_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id")),
    Column("kind", Text, nullable=False),
    Column("request", JSONB, nullable=False),
    Column("status", Text, nullable=False),
    Column("output", Text, nullable=False, server_default=EMPTY_TEXT),
    _created_at(),
    Column("finished_at", TZ),
    _enum("kind", *JOB_KIND),
    _enum("status", *JOB_STATUS),
)

# --- Workspace extension tables (doc 19) ------------------------------------------------

reports = Table(
    "reports",
    metadata,
    _uuid_pk(),
    Column("user_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    Column("code", Text, nullable=False),
    Column("title", Text, nullable=False),
    Column("type", Text, nullable=False),
    Column("project_ids", ARRAY(Text), nullable=False, server_default=EMPTY_ARRAY),
    Column("market_ids", ARRAY(Text), nullable=False, server_default=EMPTY_ARRAY),
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    _created_at(),
    UniqueConstraint("user_id", "code"),
    CheckConstraint("code ~ '^R[0-9]+$'", name="code"),
    CheckConstraint("type ~ '^[a-z][a-z0-9-]{0,79}$'", name="type"),
)

report_versions = Table(
    "report_versions",
    metadata,
    _uuid_pk(),
    Column("report_id", UUID(as_uuid=True), _fk("reports.id"), nullable=False),
    Column("sequence", Integer, nullable=False),
    Column("schema", JSONB, nullable=False),
    Column("source", JSONB, nullable=False),
    Column("policy_version", Text, nullable=False),
    Column("content_revision", Text, nullable=False),
    Column("trace_id", String(32), nullable=False),
    Column("completed_at", TZ, nullable=False, server_default=NOW),
    UniqueConstraint("report_id", "sequence"),
    CheckConstraint("sequence >= 1", name="sequence"),
)

report_attempts = Table(
    "report_attempts",
    metadata,
    _uuid_pk(),
    Column("report_id", UUID(as_uuid=True), _fk("reports.id"), nullable=False),
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    Column("task_id", BigInteger, _fk("global_tasks.id")),
    Column("state", Text, nullable=False),
    Column("reason", Text),
    Column("version_id", UUID(as_uuid=True), _fk("report_versions.id")),
    _created_at(),
    Column("finished_at", TZ),
    _enum("state", *ATTEMPT_STATE),
    # Invariant 9: at most one running attempt per report.
    Index(
        "uq_report_attempts_one_running_per_report",
        "report_id",
        unique=True,
        postgresql_where=text("state = 'running'"),
    ),
)

report_artifacts = Table(
    "report_artifacts",
    metadata,
    _uuid_pk(),
    Column("version_id", UUID(as_uuid=True), _fk("report_versions.id"), nullable=False),
    Column("filename", Text, nullable=False),
    Column("mime", Text, nullable=False),
    Column("size", BigInteger, nullable=False),
    Column("sha256", String(64), nullable=False),
    Column("path", Text, nullable=False),
    CheckConstraint("size >= 0", name="size"),
)

report_evidence = Table(
    "report_evidence",
    metadata,
    Column("version_id", UUID(as_uuid=True), _fk("report_versions.id"), nullable=False),
    Column("id", Text, nullable=False),
    Column("label", Text, nullable=False),
    Column("source_id", Text, nullable=False),
    Column("project_ids", ARRAY(Text), nullable=False, server_default=EMPTY_ARRAY),
    Column("snapshot_id", Text),
    Column("data_through", TZ, nullable=False),
    Column("limitation", Text, nullable=False),
    PrimaryKeyConstraint("version_id", "id"),
)

datasets = Table(
    "datasets",
    metadata,
    _uuid_pk(),
    Column("user_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    Column("kind", Text, nullable=False),
    Column("payload", JSONB, nullable=False),
    Column("agent_id", UUID(as_uuid=True), _fk("agents.id"), nullable=False),
    Column("published_at", TZ, nullable=False, server_default=NOW),
    _enum("kind", *DATASET_KIND),
)

user_notifications = Table(
    "user_notifications",
    metadata,
    _uuid_pk(),
    Column("user_id", UUID(as_uuid=True), _fk("users.id"), nullable=False),
    Column("kind", Text, nullable=False),
    Column("title", JSONB, nullable=False),
    Column("summary", JSONB, nullable=False),
    Column("target", JSONB, nullable=False),
    Column("occurred_at", TZ, nullable=False, server_default=NOW),
    Column("read_at", TZ),
    _enum("kind", *NOTIFICATION_KIND),
    Index("ix_user_notifications_user_id_occurred_at", "user_id", text("occurred_at DESC")),
)

user_preferences = Table(
    "user_preferences",
    metadata,
    Column("user_id", UUID(as_uuid=True), _fk("users.id"), primary_key=True),
    Column("value", JSONB, nullable=False),
    Column("updated_at", TZ, nullable=False, server_default=NOW),
)

# --- Triggers (invariants 1 and 8) ------------------------------------------------------
# The same SQL is in the initial migration; test_schema compares the two schemas.

EVENTS_APPEND_ONLY_FN = """
CREATE FUNCTION events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.kind = 'tool_result'
     AND (to_jsonb(NEW) - 'payload') = (to_jsonb(OLD) - 'payload')
     AND (NEW.payload - 'text' - 'batch_offloaded_at')
         = (OLD.payload - 'text' - 'batch_offloaded_at')
     AND OLD.payload ->> 'batch_offloaded_at' IS NULL
     AND NEW.payload ->> 'batch_offloaded_at' IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    MESSAGE = 'events are append-only (only a batch offload may rewrite a tool_result)',
    ERRCODE = 'integrity_constraint_violation';
END
$$
"""

IMMUTABLE_ROW_FN = """
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = TG_TABLE_NAME || ' rows are never updated or deleted',
    ERRCODE = 'integrity_constraint_violation';
END
$$
"""

IMMUTABLE_TABLES = ("report_versions", "report_artifacts", "report_evidence")

event.listen(metadata, "before_create", DDL(EVENTS_APPEND_ONLY_FN))
event.listen(metadata, "before_create", DDL(IMMUTABLE_ROW_FN))
event.listen(metadata, "after_drop", DDL("DROP FUNCTION IF EXISTS events_append_only()"))
event.listen(metadata, "after_drop", DDL("DROP FUNCTION IF EXISTS immutable_row()"))
event.listen(
    events,
    "after_create",
    DDL(
        "CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON events "
        "FOR EACH ROW EXECUTE FUNCTION events_append_only()"
    ),
)
for _name in IMMUTABLE_TABLES:
    event.listen(
        metadata.tables[_name],
        "after_create",
        DDL(
            f"CREATE TRIGGER {_name}_immutable BEFORE UPDATE OR DELETE ON {_name} "
            "FOR EACH ROW EXECUTE FUNCTION immutable_row()"
        ),
    )
