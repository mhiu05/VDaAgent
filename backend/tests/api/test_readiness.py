"""`make up` readiness: wait for the demo teams (bounded, fails clearly) and the final checks."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import update

from backend import readiness
from backend.db import migrate
from backend.db import tables as t


@pytest.fixture
def db(conn):
    @asynccontextmanager
    async def provider():
        async with conn.begin_nested():
            yield conn

    return provider


async def _demo(rows, status="active", agents=6):
    domain = await rows.domain("fabrikam")
    alice = await rows.user(username="alice", domain_id=domain, status=status)
    for i in range(agents):
        await rows.agent(alice, slug="lead" if i == 0 else f"a{i}", is_lead=i == 0)
    return alice


async def test_wait_demo_returns_once_the_teams_are_active(conn, rows, db):
    await _demo(rows)
    assert await readiness.wait_demo(db, timeout_s=5, poll_s=0.01) == 0


async def test_wait_demo_fails_fast_on_a_failed_provisioning(conn, rows, db, capsys):
    await _demo(rows, status="failed", agents=1)
    assert await readiness.wait_demo(db, timeout_s=60, poll_s=0.01) == 1
    assert "provisioning failed for alice" in capsys.readouterr().err


async def test_wait_demo_gives_up_after_its_timeout(conn, rows, db, capsys):
    await _demo(rows, status="provisioning", agents=1)
    assert await readiness.wait_demo(db, timeout_s=0.05, poll_s=0.01) == 1
    assert "still provisioning" in capsys.readouterr().err


async def test_check_reports_what_keeps_the_demo_from_working(conn, rows, db, tmp_path):
    head = ScriptDirectory.from_config(migrate.config("unused")).get_current_head()
    settings = SimpleNamespace(FOLDERS_DIR=str(tmp_path))
    alice = await _demo(rows)
    await conn.execute(
        t.domain_starters.insert().values(domain_id="fabrikam", slug="data", display_name="Data")
    )
    data = await rows.agent(alice, slug="data")
    keys = Path(tmp_path) / str(alice) / "data" / ".env.d"
    keys.mkdir(parents=True)
    (keys / "warehouse.env.keys").write_text("WAREHOUSE_DSN\nWAREHOUSE_SNAPSHOT_ID\n")
    # alice has warehouse access but no dataset yet
    assert await readiness.check(db, head, settings) == ["no dashboard dataset for alice"]
    await conn.execute(
        t.datasets.insert().values(user_id=alice, agent_id=data, kind="dashboard", payload={})
    )
    assert await readiness.check(db, head, settings) == []
    await conn.execute(update(t.domains).values(status="unavailable"))
    assert await readiness.check(db, "9999", settings) == [
        f"database schema at {head}, source head is 9999",
        "domain fabrikam is unavailable with 1 starters",
    ]
