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

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    load_dotenv(ROOT / ".env", override=False)
    raw = os.environ.get("P170_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not raw:
        raise RuntimeError("P170_TEST_DATABASE_URL or DATABASE_URL is required")
    target_url = make_url(raw)
    name = "p170_migration_smoke_" + uuid.uuid4().hex[:10]
    assert re.fullmatch(r"p170_migration_smoke_[0-9a-f]{10}", name)
    admin_url = target_url.set(database="postgres")
    admin = sa.create_engine(
        admin_url,
        future=True,
        isolation_level="AUTOCOMMIT",
        connect_args={"connect_timeout": 15},
    )
    created = False
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}"'))
        created = True
        migration_url = target_url.set(database=name).render_as_string(hide_password=False)
        environment = os.environ.copy()
        environment["DATABASE_MIGRATION_URL"] = migration_url
        environment["DATABASE_URL"] = migration_url
        for args in (("upgrade", "head"), ("current",), ("heads",), ("check",)):
            print("$ alembic " + " ".join(args), flush=True)
            result = subprocess.run(
                [sys.executable, "-m", "alembic", "-c", "alembic.ini", *args],
                cwd=ROOT,
                env=environment,
                check=False,
                text=True,
            )
            if result.returncode:
                return result.returncode
        print(f"Migration smoke PASS ({name})")
        return 0
    finally:
        admin.dispose()
        if created:
            cleanup = sa.create_engine(
                admin_url,
                future=True,
                isolation_level="AUTOCOMMIT",
                connect_args={"connect_timeout": 15},
            )
            try:
                with cleanup.connect() as connection:
                    connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
            finally:
                cleanup.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
