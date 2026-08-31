"""Alembic environment; migrations always use DATABASE_MIGRATION_URL when set."""

from __future__ import annotations

import os
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool
from src.services.repository import metadata as target_metadata

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# Alembic is invoked from the repository root during local/release jobs, while
# the application already treats the root .env as its shared configuration
# source.  Load it here as a fallback; an explicitly exported environment
# variable still wins and remains the preferred production secret mechanism.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

# Metadata is used for inspection commands (``alembic check`` and
# autogenerate).  Runtime schema creation remains exclusively in revisions;
# importing the table declarations has no database side effects.
_ROLLOUT_ONLY_OBJECTS = {
    "ix_datasource_connections_workspace_status",
    "uq_datasource_connections_workspace_fingerprint_active",
    "uq_query_executions_session_idempotency",
    "uq_report_versions_report_version",
    "ck_membership_role",
    "ck_membership_status",
}


def _include_object(object_, name, type_, reflected, compare_to):
    """Keep rollout-only indexes/checks without masking model additions.

    A few release migrations deliberately retain compatibility indexes and
    named checks that are not represented in the SQLAlchemy model.  They are
    valid database state, not pending work; reflected-only objects of those
    kinds are therefore excluded from ``alembic check``.  Columns, tables, and
    foreign keys remain fully compared.
    """
    if reflected and compare_to is None and name in _ROLLOUT_ONLY_OBJECTS and type_ in {
        "index",
        "unique_constraint",
        "check_constraint",
    }:
        return False
    return True


def _url() -> str:
    value = os.environ.get("DATABASE_MIGRATION_URL") or os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_MIGRATION_URL hoặc DATABASE_URL là bắt buộc để chạy migration.")
    return value


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        include_object=_include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "pyformat"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    supplied_connection = config.attributes.get("connection")
    if supplied_connection is not None:
        context.configure(
            connection=supplied_connection,
            target_metadata=target_metadata,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()
        return
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = _url()
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
