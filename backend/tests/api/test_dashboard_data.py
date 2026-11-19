"""Dashboard data: the warehouse sync stores what a person's data agent built, idempotently,
and the dashboard opens on the period its data covers."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from backend import dashboard_sync
from backend.db import tables as t

SOURCE = {
    "mode": "api",
    "dataThrough": "2026-07-01T00:00:00+07:00",
    "updatedAt": "2026-10-21T00:00:00+00:00",
    "completeness": "full",
}


def built_dataset(updated: str = SOURCE["updatedAt"]) -> dict:
    """What `contoso.dashboard.build()` writes for a one-project snapshot of 2026-06-30."""
    source = {**SOURCE, "updatedAt": updated}
    units = [("U1", "2026-06-20"), ("U2", "2025-12-01"), ("U3", "2025-05-01")]
    return {
        "businessTimezone": "Asia/Ho_Chi_Minh",
        "projects": [
            {
                "id": "PRJ-A",
                "name": "A",
                "marketId": "M",
                "marketLabel": "Thị trường M",
                "sourceId": "DW:project:PRJ-A",
            }
        ],
        "snapshots": [
            {
                "id": "SNAP-1",
                "businessDate": "2026-06-30",
                "closingBefore": "2026-07-01",
                "policyVersion": "slow-demo-180d-v1",
                "source": {**source, "id": "warehouse:SNAP-1", "label": "Kho dữ liệu"},
                "properties": [
                    {
                        "id": uid,
                        "snapshotId": "SNAP-1",
                        "projectId": "PRJ-A",
                        "status": "available",
                        "listedBusinessDate": listed,
                        "sourceId": f"DW:unit:{uid}",
                    }
                    for uid, listed in units
                ],
            }
        ],
        "transactions": [
            {
                "id": "sale:S1",
                "propertyId": "S1",
                "projectId": "PRJ-A",
                "status": "completed",
                "completedAt": "2026-06-15T12:00:00+07:00",
                "test": False,
                "sourceId": "DW:sale:S1",
            }
        ],
        "transactionSource": {**source, "id": "warehouse:SNAP-1:sales", "label": "Giao dịch"},
        "coveredDates": [f"2026-06-{d:02d}" for d in range(1, 31)],
    }


class FakeExecd:
    """Stands in for execd running `contoso.dashboard.build()` in the agent's folder."""

    def __init__(self, fail: bool = False):
        self.fail, self.calls, self.updated = fail, [], SOURCE["updatedAt"]

    async def exec(self, *, folder, code, **_):
        self.calls.append((folder, code))
        if self.fail:
            return SimpleNamespace(
                exit_code=1, stdout="", stderr="Traceback ...\nOperationalError: timeout"
            )
        out = Path(folder) / dashboard_sync.OUT
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(built_dataset(self.updated)))
        counts = {
            "snapshot": "SNAP-1",
            "businessDate": "2026-06-30",
            "projects": 1,
            "properties": 3,
            "transactions": 1,
        }
        return SimpleNamespace(exit_code=0, stdout=json.dumps(counts), stderr="")


@pytest.fixture
def settings(tmp_path):
    return SimpleNamespace(FOLDERS_DIR=str(tmp_path / "folders"))


@pytest.fixture
def db(conn):
    @asynccontextmanager
    async def provider():
        async with conn.begin_nested():
            yield conn

    return provider


async def _data_agent(rows, settings, owner, *, warehouse=True):
    agent = await rows.agent(owner, slug="data")
    env_d = Path(settings.FOLDERS_DIR) / str(owner) / "data" / ".env.d"
    env_d.mkdir(parents=True)
    (env_d / "warehouse.env").write_text("WAREHOUSE_DSN=postgresql://x\n")
    # key names only; a set without the DSN (another domain's warehouse) is skipped, not failed
    keys = "WAREHOUSE_DSN\nWAREHOUSE_SNAPSHOT_ID\n" if warehouse else "OTHER_KEY\n"
    (env_d / "warehouse.env.keys").write_text(keys)
    return agent


async def _datasets(conn, owner):
    q = select(func.count()).select_from(t.datasets).where(t.datasets.c.user_id == owner)
    return await conn.scalar(q)


async def test_sync_stores_the_built_dataset_once_and_only_for_people(conn, rows, settings, db):
    alice = await rows.user(username="alice")
    bob = await rows.user(username="bobby")
    service = await rows.user(username="svc.0123456789abcdef", account_type="service")
    await _data_agent(rows, settings, alice)
    await _data_agent(rows, settings, bob, warehouse=False)  # no warehouse access: skipped
    await _data_agent(rows, settings, service)  # a group's team: no dashboard of its own
    execd = FakeExecd()
    assert await dashboard_sync.sync(db, settings, execd) == 0
    assert [Path(folder).parent.name for folder, _ in execd.calls] == [str(alice)]
    assert "contoso.dashboard" in execd.calls[0][1]
    assert (
        await _datasets(conn, alice),
        await _datasets(conn, bob),
        await _datasets(conn, service),
    ) == (1, 0, 0)
    # DASH-11: re-running with the same data (only `updatedAt` moved) stores nothing new
    execd.updated = "2026-10-22T00:00:00+00:00"
    assert await dashboard_sync.sync(db, settings, execd) == 0
    assert await _datasets(conn, alice) == 1


async def test_a_failed_build_is_reported_and_stores_nothing(conn, rows, settings, db, capsys):
    alice = await rows.user(username="alice")
    await _data_agent(rows, settings, alice)
    assert await dashboard_sync.sync(db, settings, FakeExecd(fail=True)) == 1
    assert "OperationalError: timeout" in capsys.readouterr().err
    assert await _datasets(conn, alice) == 0


async def test_catalog_opens_the_dashboard_on_the_period_the_data_covers(accounts, conn, rows):
    alice = await accounts.user("alice")
    agent = await rows.agent(alice, slug="data")
    async with await accounts.login("alice") as c:
        today_scope = (await c.get("/api/reports/catalog")).json()["defaultScope"]
        await conn.execute(
            t.datasets.insert().values(
                user_id=alice, agent_id=agent, kind="dashboard", payload=built_dataset()
            )
        )
        scope = (await c.get("/api/reports/catalog")).json()["defaultScope"]
        dataset = (await c.get("/api/dashboard/dataset")).json()["dataset"]
    assert today_scope["to"] > "2026-07-01"  # without data: the last 30 days
    assert (scope["from"], scope["to"]) == ("2026-05-31", "2026-07-01")
    assert dataset["snapshots"][0]["closingBefore"] == scope["to"]  # the snapshot the UI picks
