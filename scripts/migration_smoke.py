"""Run the production migration contract against an isolated PostgreSQL DB."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.engine import make_url
from dotenv import load_dotenv

from assert_database_security import assert_database_security

ROOT = Path(__file__).resolve().parents[1]
BROWSER_ROLES = ("anon", "authenticated")
OBSERVED_PRE_FIX_REVISION = "20260827_0020"


def _ensure_browser_roles(connection: sa.Connection) -> list[str]:
    """Create test-only Supabase browser roles on a plain PostgreSQL cluster."""
    created: list[str] = []
    for role in BROWSER_ROLES:
        exists = connection.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": role}
        ).scalar_one_or_none()
        if exists is None:
            connection.execute(text(f'CREATE ROLE "{role}" NOLOGIN'))
            created.append(role)
    return created


def _run_alembic(database_url: str, *args: str) -> None:
    environment = os.environ.copy()
    environment["DATABASE_MIGRATION_URL"] = database_url
    environment["DATABASE_URL"] = database_url
    print("$ alembic " + " ".join(args), flush=True)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", *args],
        cwd=ROOT,
        env=environment,
        check=False,
        text=True,
    )
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, result.args)


def _create_database(connection: sa.Connection, name: str) -> None:
    assert re.fullmatch(r"p170_migration_(?:smoke|upgrade)_[0-9a-f]{10}", name)
    connection.execute(text(f'CREATE DATABASE "{name}"'))


def _drop_database(connection: sa.Connection, name: str) -> None:
    assert re.fullmatch(r"p170_migration_(?:smoke|upgrade)_[0-9a-f]{10}", name)
    connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def _create_optional_tables(database_url: str) -> None:
    engine = sa.create_engine(database_url, future=True)
    try:
        with engine.begin() as connection:
            for table_name in (
                "checkpoint_blobs",
                "checkpoint_migrations",
                "checkpoint_writes",
                "checkpoints",
                "published_reports",
                "user_accounts",
            ):
                connection.execute(
                    text(f'CREATE TABLE public."{table_name}" (id text PRIMARY KEY)')
                )
    finally:
        engine.dispose()


def main() -> int:
    load_dotenv(ROOT / ".env", override=False)
    raw = os.environ.get("P170_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not raw:
        raise RuntimeError("P170_TEST_DATABASE_URL or DATABASE_URL is required")
    target_url = make_url(raw)
    fresh_name = "p170_migration_smoke_" + uuid.uuid4().hex[:10]
    upgrade_name = "p170_migration_upgrade_" + uuid.uuid4().hex[:10]
    admin_url = target_url.set(database="postgres")
    admin = sa.create_engine(
        admin_url,
        future=True,
        isolation_level="AUTOCOMMIT",
        connect_args={"connect_timeout": 15},
    )
    created_databases: list[str] = []
    created_roles: list[str] = []
    try:
        with admin.connect() as connection:
            created_roles = _ensure_browser_roles(connection)
            _create_database(connection, fresh_name)
            created_databases.append(fresh_name)
            _create_database(connection, upgrade_name)
            created_databases.append(upgrade_name)

        fresh_url = target_url.set(database=fresh_name).render_as_string(
            hide_password=False
        )
        upgrade_url = target_url.set(database=upgrade_name).render_as_string(
            hide_password=False
        )

        # Fresh database contract.
        _run_alembic(fresh_url, "upgrade", "head")
        assert_database_security(fresh_url)
        for args in (("upgrade", "head"), ("current",), ("heads",), ("check",)):
            _run_alembic(fresh_url, *args)

        # Upgrade contract from the deployed pre-fix revision observed during
        # the P1-01 audit, including runtime and legacy tables present there.
        _run_alembic(upgrade_url, "upgrade", OBSERVED_PRE_FIX_REVISION)
        _create_optional_tables(upgrade_url)
        _run_alembic(upgrade_url, "upgrade", "head")
        assert_database_security(upgrade_url)

        print(
            f"Migration smoke PASS (fresh={fresh_name}, upgrade={upgrade_name})"
        )
        return 0
    except subprocess.CalledProcessError as exc:
        return exc.returncode
    finally:
        admin.dispose()
        if created_databases or created_roles:
            cleanup = sa.create_engine(
                admin_url,
                future=True,
                isolation_level="AUTOCOMMIT",
                connect_args={"connect_timeout": 15},
            )
            try:
                with cleanup.connect() as connection:
                    for name in reversed(created_databases):
                        _drop_database(connection, name)
                    for role in reversed(created_roles):
                        connection.execute(text(f'DROP ROLE IF EXISTS "{role}"'))
            finally:
                cleanup.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
