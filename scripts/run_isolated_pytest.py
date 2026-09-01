"""Run pytest against a disposable PostgreSQL database.

The configured ``P170_TEST_DATABASE_URL`` supplies the server and credentials,
but its database is never modified. A uniquely named database is created,
migrated, used for the requested tests, then dropped in a ``finally`` block.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

ROOT = Path(__file__).resolve().parents[1]


def _configured_url() -> URL:
    raw = str(
        os.environ.get("P170_TEST_DATABASE_URL")
        or dotenv_values(ROOT / ".env").get("P170_TEST_DATABASE_URL")
        or ""
    ).strip()
    if not raw:
        raise RuntimeError("P170_TEST_DATABASE_URL is required.")
    if raw.startswith("postgresql://"):
        raw = raw.replace("postgresql://", "postgresql+psycopg://", 1)
    elif raw.startswith("postgres://"):
        raw = raw.replace("postgres://", "postgresql+psycopg://", 1)
    url = make_url(raw)
    if not url.drivername.startswith("postgresql"):
        raise RuntimeError("P170_TEST_DATABASE_URL must use PostgreSQL.")
    return url


def _admin_url(url: URL) -> URL:
    return url.set(database="postgres")


def _create_database(url: URL, database: str) -> None:
    engine = create_engine(_admin_url(url), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{database}"')
    finally:
        engine.dispose()


def _drop_database(url: URL, database: str) -> None:
    if not database.startswith("p170_test_") or len(database) != 27:
        raise RuntimeError("Refusing to drop an unexpected database name.")
    engine = create_engine(_admin_url(url), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname=:database AND pid <> pg_backend_pid()"
                ),
                {"database": database},
            )
            connection.exec_driver_sql(
                f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'
            )
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pytest_args", nargs="*", help="Paths passed to pytest.")
    args, pytest_options = parser.parse_known_args()
    configured = _configured_url()
    database = f"p170_test_{uuid4().hex[:17]}"
    isolated = configured.set(database=database)
    isolated_value = isolated.render_as_string(hide_password=False)
    environment = {
        **os.environ,
        "P170_TEST_DATABASE_URL": isolated_value,
        "DATABASE_URL": isolated_value,
    }
    _create_database(configured, database)
    print(f"Created isolated PostgreSQL database {database}.")
    try:
        subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=ROOT,
            env=environment,
            check=True,
        )
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                *(pytest_options + args.pytest_args or ["-q"]),
            ],
            cwd=ROOT,
            env=environment,
            check=True,
        )
    finally:
        _drop_database(configured, database)
        print(f"Removed isolated PostgreSQL database {database}.")


if __name__ == "__main__":
    main()
