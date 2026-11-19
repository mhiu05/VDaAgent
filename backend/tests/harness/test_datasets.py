"""`contoso.publish_dataset` and `GET /api/dashboard/dataset` (doc 19 "Business dashboard")."""

from __future__ import annotations

import copy
import json

import pytest
from sqlalchemy import func, select

from backend.db import tables as t
from backend.tests.harness.test_reports_internal import internal, write  # noqa: F401

SOURCE = {
    "id": "warehouse",
    "mode": "api",
    "label": "Kho cdw",
    "dataThrough": "2026-10-16T17:00:00Z",
    "updatedAt": "2026-10-17T01:00:00Z",
    "completeness": "full",
}
DATASET = {
    "businessTimezone": "Asia/Ho_Chi_Minh",
    "projects": [
        {
            "id": "MAS",
            "name": "Riverstone",
            "marketId": "hn",
            "marketLabel": "Hà Nội",
            "sourceId": "warehouse",
        }
    ],
    "snapshots": [
        {
            "id": "s1",
            "businessDate": "2026-10-16",
            "closingBefore": "2026-10-17",
            "policyVersion": "p1",
            "source": SOURCE,
            "properties": [
                {
                    "id": "MAS-U03832",
                    "snapshotId": "s1",
                    "projectId": "MAS",
                    "status": "available",
                    "listedBusinessDate": "2026-03-01",
                    "sourceId": "warehouse",
                }
            ],
        }
    ],
    "transactions": [
        {
            "id": "tx1",
            "propertyId": "MAS-U03832",
            "projectId": "MAS",
            "status": "completed",
            "completedAt": "2026-10-10T03:00:00Z",
            "test": False,
            "sourceId": "warehouse",
        }
    ],
    "transactionSource": SOURCE,
    "coveredDates": ["2026-10-15", "2026-10-16"],
}


async def publish(internal, team, payload, path="files/dashboard.json"):  # noqa: F811
    write(internal.h.folder(team.data), path, payload)
    async with internal(team.data) as c:
        return await c.post(
            "/internal/v1/datasets/publish", json={"kind": "dashboard", "path": path}
        )


async def test_publish_stores_a_copy(conn, team, internal):  # noqa: F811
    r = await publish(internal, team, DATASET)
    assert r.status_code == 200, r.text
    row = (await conn.execute(select(t.datasets))).one()
    assert str(row.id) == r.json()["dataset_id"]
    assert row.payload == DATASET and row.agent_id == team.data.id and row.kind == "dashboard"


@pytest.mark.parametrize(
    "mutate,needle",
    [
        (lambda d: d.update(businessTimezone="Mars/Base"), "businessTimezone"),
        (lambda d: d["transactions"][0].update(projectId="NOPE"), "project"),
        (lambda d: d["snapshots"][0]["properties"][0].update(status="lost"), "status"),
        (lambda d: d.update(coveredDates=["2026-13-01"]), "coveredDates"),
        (lambda d: d.pop("projects"), "projects"),
        (lambda d: d["transactions"][0].update(completedAt="yesterday"), "completedAt"),
    ],
)
async def test_invalid_datasets(conn, team, internal, mutate, needle):  # noqa: F811
    bad = copy.deepcopy(DATASET)
    mutate(bad)
    r = await publish(internal, team, bad)
    assert (r.status_code, r.json()["error"]) == (400, "invalid_dataset")
    assert needle in r.json()["message"]
    assert await conn.scalar(select(func.count()).select_from(t.datasets)) == 0


async def test_unknown_kind_and_not_json(team, internal):  # noqa: F811
    write(internal.h.folder(team.data), "files/x.json", "{not json")
    async with internal(team.data) as c:
        r = await c.post(
            "/internal/v1/datasets/publish", json={"kind": "sales", "path": "files/x.json"}
        )
        assert r.status_code == 400
        r = await c.post(
            "/internal/v1/datasets/publish", json={"kind": "dashboard", "path": "files/x.json"}
        )
        assert r.json()["error"] == "invalid_dataset"


async def test_only_the_five_newest_are_kept(conn, team, internal):  # noqa: F811
    for i in range(7):
        d = copy.deepcopy(DATASET)
        d["coveredDates"] = [f"2026-10-{10 + i:02d}"]
        assert (await publish(internal, team, d)).status_code == 200
    rows = (
        (await conn.execute(select(t.datasets.c.payload).order_by(t.datasets.c.published_at)))
        .scalars()
        .all()
    )
    assert len(rows) == 5


async def test_the_dashboard_view(conn, rows, team, internal):  # noqa: F811
    from backend.reports.dataset import dashboard_view

    assert await dashboard_view(conn, team.user) == {"dataset": None, "publishedAt": None}
    await publish(internal, team, DATASET)
    report = await rows.insert(
        t.reports,
        user_id=team.user,
        code="R1",
        title="x",
        type="x",
        agent_id=team.data.id,
        project_ids=["MAS"],
    )
    await rows.insert(
        t.report_attempts,
        report_id=report,
        agent_id=team.data.id,
        state="failed",
        reason="thiếu dữ liệu",
    )
    body = await dashboard_view(conn, team.user)
    ds = body["dataset"]
    assert body["publishedAt"] and ds["projects"] == DATASET["projects"]
    assert ds["taskSource"]["mode"] == "api"
    (task,) = ds["tasks"]
    assert (
        task["state"],
        task["reportId"],
        task["projectId"],
        task["attemptNumber"],
        task["error"],
    ) == ("failed", "R1", "MAS", 1, "thiếu dữ liệu")
    assert task["failedAt"] and task["versionId"] is None
    assert json


async def test_storing_an_identical_dataset_again_is_a_no_op(conn, rows):
    from backend.reports.dataset import store

    user = await rows.user()
    agent = await rows.agent(user, slug="data")
    first, stored = await store(conn, user, agent, DATASET)
    assert stored
    later = {
        **DATASET,
        "transactionSource": {**DATASET["transactionSource"], "updatedAt": "2026-10-21T00:00:00Z"},
    }
    again, stored = await store(conn, user, agent, later)
    assert (again, stored) == (first, False)
    changed = {**DATASET, "coveredDates": []}
    _, stored = await store(conn, user, agent, changed)
    assert stored


def test_closing_before_is_a_date_after_the_business_date():
    from backend.api.errors import ApiError
    from backend.reports.dataset import validate_dataset

    snap = DATASET["snapshots"][0]
    for bad in ("2026-10-16T17:00:00Z", "2026-10-16"):
        with pytest.raises(ApiError):
            validate_dataset({**DATASET, "snapshots": [{**snap, "closingBefore": bad}]})
