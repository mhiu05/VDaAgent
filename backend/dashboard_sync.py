"""`make dashboard-sync`: refresh each person's dashboard dataset from their domain's warehouse.

The dashboard reads the newest `dashboard` dataset an agent published (decision 0020). This does
what a person's `data` agent does when asked: in that agent's own sandbox (its credentials, a
read-only warehouse session) it runs `contoso.dashboard.build()`, which writes the dataset into
the agent's folder; the backend then validates and stores that file, exactly like
`publish_dataset`. The backend never sees the warehouse credentials. Re-running stores nothing
when the data has not changed.

    docker compose exec -T backend python -m backend.dashboard_sync
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

from backend import ids
from backend.agents.folders import folder_of
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.reports import dataset

SLUG = "data"
OUT = "files/dashboard-dataset.json"
# Runs in the data agent's venv (it has psycopg): a read-only session, then the stdlib builder.
BUILD = f"""\
import json, os
import psycopg
from psycopg.rows import dict_row
from contoso.dashboard import build
with psycopg.connect(os.environ["WAREHOUSE_DSN"], row_factory=dict_row,
                     options="-c default_transaction_read_only=on") as conn:
    print(json.dumps(build(lambda sql, params=(): conn.execute(sql, params).fetchall(), {OUT!r})))
"""
TIMEOUT_S = 300


async def candidates(db: Any, settings: Any) -> list[Any]:
    """Active people (never a group's service account) whose `data` agent has warehouse access."""
    u, a = t.users, t.agents
    async with db() as conn:
        rows = (
            await conn.execute(
                select(a, u.c.username)
                .select_from(a.join(u, u.c.id == a.c.user_id))
                .where(
                    u.c.account_type == "human",
                    u.c.role == "user",
                    u.c.status == "active",
                    a.c.slug == SLUG,
                    a.c.state == "active",
                )
                .order_by(u.c.username)
            )
        ).all()
    return [r for r in rows if _has_warehouse(folder_of(settings, r))]


def _has_warehouse(folder: Path) -> bool:
    """The agent's `warehouse` set carries both keys. Read from the `.env.keys` sidecar, which
    holds key names only — never the values."""
    sidecar = folder / ".env.d" / "warehouse.env.keys"
    try:
        keys = set(sidecar.read_text(encoding="utf-8").split())
    except OSError:
        return False
    return {"WAREHOUSE_DSN", "WAREHOUSE_SNAPSHOT_ID"} <= keys


async def sync_one(db: Any, settings: Any, execd: Any, agent: Any) -> str:
    folder = folder_of(settings, agent)
    result = await execd.exec(
        folder=str(folder),
        exec_id=ids.exec_id(),
        code=BUILD,
        timeout_s=TIMEOUT_S,
        author="contoso-harness",
    )
    if result.exit_code != 0:
        # the last line names the error; the agent's credentials never appear in a traceback
        last = ((result.stderr or "").strip().splitlines() or ["no output"])[-1]
        raise RuntimeError(f"build failed: {last[:300]}")
    counts = json.loads((result.stdout or "").strip().splitlines()[-1])
    raw = json.loads((Path(folder) / OUT).read_text(encoding="utf-8"))
    async with db() as conn:
        dataset_id, stored = await dataset.store(conn, agent.user_id, agent.id, raw)
    state = "stored" if stored else "unchanged"
    return (
        f"{state} {dataset_id}: snapshot {counts['snapshot']} ({counts['businessDate']}), "
        f"{counts['projects']} projects, {counts['properties']} units, "
        f"{counts['transactions']} sales"
    )


async def sync(db: Any, settings: Any, execd: Any) -> int:
    """Sync every candidate; returns how many failed (0 when there was nothing to do).
    `db()` opens a connection in a transaction (`backend.db.session.transaction`)."""
    failed = 0
    agents = await candidates(db, settings)
    if not agents:
        print("dashboard-sync: nobody has a data agent with warehouse access yet")
    for agent in agents:
        try:
            print(f"dashboard-sync: {agent.username}: {await sync_one(db, settings, execd, agent)}")
        except (RuntimeError, ValueError, OSError, ApiError) as e:
            failed += 1
            message = e.message if isinstance(e, ApiError) else str(e)
            print(f"dashboard-sync: {agent.username}: {message}", file=sys.stderr)
    return failed


async def main() -> int:
    from backend.db.session import create_engine, transaction
    from backend.execd_client import ExecdClient
    from backend.settings import Settings

    settings = Settings()
    engine = create_engine(settings.DATABASE_URL.get_secret_value())
    execd = ExecdClient(settings.EXECD_URL, settings.EXECD_TOKEN.get_secret_value())
    try:
        return 1 if await sync(lambda: transaction(engine), settings, execd) else 0
    finally:
        await execd.aclose()
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
