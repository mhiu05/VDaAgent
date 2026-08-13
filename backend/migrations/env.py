"""Alembic environment; migrations always use DATABASE_MIGRATION_URL when set."""

from __future__ import annotations

import os
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# Alembic is invoked from the repository root during local/release jobs, while
# the application already treats the root .env as its shared configuration
# source.  Load it here as a fallback; an explicitly exported environment
# variable still wins and remains the preferred production secret mechanism.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

target_metadata = None


def _url() -> str:
    value = os.environ.get("DATABASE_MIGRATION_URL") or os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_MIGRATION_URL hoặc DATABASE_URL là bắt buộc để chạy migration.")
    return value


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "pyformat"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = _url()
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
