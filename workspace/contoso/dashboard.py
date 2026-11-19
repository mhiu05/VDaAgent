"""The business dashboard dataset from an enterprise real-estate warehouse (doc 19 "Dataset").

Agent code only: the warehouse credentials are the agent's (`WAREHOUSE_DSN`,
`WAREHOUSE_SNAPSHOT_ID` from `.env.d`), and the caller opens a read-only session (see `Query`).
`build()` writes a `DashboardDataset` file into the folder; `publish()` also hands it to the
dashboard (`publish_dataset`). Nothing is invented: every row comes from the `gold` tables of the
snapshot, and days outside the sales history window are left out of `coveredDates` (unknown,
never zero).

    from contoso.dashboard import publish
    publish(query)  # files/dashboard-dataset.json, then publish_dataset("dashboard", ...)

`assemble()` is the pure part (rows in, dataset out), so it is testable without a database.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_PATH = "files/dashboard-dataset.json"
# The age policy the dashboard computes with (frontend `DEMO_POLICY`): bands from the listing date.
POLICY_VERSION = "slow-demo-180d-v1"
# Two years of daily sales: a period of up to 366 days and its previous comparable period.
HISTORY_DAYS = 730
STATUS = {"AVAILABLE": "available", "BOOKED": "reserved"}  # inventory statuses kept in a snapshot

__all__ = ["DEFAULT_PATH", "Query", "assemble", "build", "publish", "read"]

# `query(sql, params) -> rows as dicts`, on a read-only warehouse session the caller opens (this
# package is standard library only; the agent's environment has the driver), e.g. with psycopg:
#   conn = psycopg.connect(os.environ["WAREHOUSE_DSN"], row_factory=dict_row,
#                          options="-c default_transaction_read_only=on")
#   query = lambda sql, params=(): conn.execute(sql, params).fetchall()
Query = Callable[[str, tuple], list[dict]]


def _clean(v):
    return v.strip() if isinstance(v, str) else v


def _instant(day: date, tz: ZoneInfo, at: time = time(0, 0)) -> str:
    return datetime.combine(day, at, tzinfo=tz).isoformat()


def assemble(
    manifest: dict,
    projects: list[dict],
    units: list[dict],
    sales: list[dict],
    *,
    history_days: int = HISTORY_DAYS,
    now: datetime | None = None,
) -> dict:
    """A `DashboardDataset` (without `tasks`/`taskSource`) for one warehouse snapshot.

    `manifest`: snapshot_id, snapshot_date, timezone, source_system. `projects`: project_id,
    project_name, market_id, market_name. `units`: unit_id, project_id, inventory_status,
    release_date (inventory at the snapshot). `sales`: unit_id, project_id, sold_date.
    """
    tz = ZoneInfo(_clean(manifest["timezone"]))
    snapshot_id = _clean(manifest["snapshot_id"])
    system = _clean(manifest["source_system"])
    day: date = manifest["snapshot_date"]
    closing = day + timedelta(days=1)
    first = day - timedelta(days=history_days - 1)
    updated = (now or datetime.now(UTC)).isoformat()
    through = _instant(closing, tz)
    known = {_clean(p["project_id"]) for p in projects}
    dataset_projects = [
        {
            "id": _clean(p["project_id"]),
            "name": _clean(p["project_name"]),
            "marketId": _clean(p["market_id"]),
            "marketLabel": _clean(p["market_name"]),
            "sourceId": f"{system}:project:{_clean(p['project_id'])}",
        }
        for p in sorted(projects, key=lambda p: _clean(p["project_id"]))
    ]
    properties = [
        {
            "id": _clean(u["unit_id"]),
            "snapshotId": snapshot_id,
            "projectId": _clean(u["project_id"]),
            "status": STATUS[_clean(u["inventory_status"])],
            "listedBusinessDate": u["release_date"].isoformat() if u["release_date"] else None,
            "sourceId": f"{system}:unit:{_clean(u['unit_id'])}",
        }
        for u in units
        if _clean(u["inventory_status"]) in STATUS and _clean(u["project_id"]) in known
    ]
    transactions = [
        {
            "id": f"sale:{_clean(s['unit_id'])}",
            "propertyId": _clean(s["unit_id"]),
            "projectId": _clean(s["project_id"]),
            "status": "completed",
            # the warehouse keeps the sale date only: noon local time keeps that business date
            "completedAt": _instant(s["sold_date"], tz, time(12, 0)),
            "test": False,
            "sourceId": f"{system}:sale:{_clean(s['unit_id'])}",
        }
        for s in sales
        if s["sold_date"] and first <= s["sold_date"] <= day and _clean(s["project_id"]) in known
    ]
    source = {"mode": "api", "dataThrough": through, "updatedAt": updated, "completeness": "full"}
    return {
        "businessTimezone": str(tz),
        "projects": dataset_projects,
        "snapshots": [
            {
                "id": snapshot_id,
                "businessDate": day.isoformat(),
                "closingBefore": closing.isoformat(),
                "policyVersion": POLICY_VERSION,
                "properties": properties,
                "source": {
                    **source,
                    "id": f"warehouse:{snapshot_id}",
                    "label": f"Kho dữ liệu · snapshot {day.isoformat()}",
                },
            }
        ],
        "transactions": transactions,
        "transactionSource": {
            **source,
            "id": f"warehouse:{snapshot_id}:sales",
            "label": f"Giao dịch hoàn tất · kho dữ liệu đến {day.isoformat()}",
        },
        "coveredDates": [
            (first + timedelta(days=i)).isoformat() for i in range((day - first).days + 1)
        ],
    }


def read(query: Query, snapshot_id: str) -> tuple[dict, list[dict], list[dict], list[dict]]:
    """The snapshot's manifest, projects, inventory units and sold units, through `query`."""
    found = query(
        "select snapshot_id, snapshot_date, timezone, source_system"
        " from gold.snapshot_manifest where snapshot_id = %s",
        (snapshot_id,),
    )
    if not found:
        raise ValueError(f"snapshot {snapshot_id} is not in gold.snapshot_manifest")
    manifest = found[0]
    key = int(manifest["snapshot_date"].strftime("%Y%m%d"))
    projects = query(
        "select project_id, project_name, market_id, market_name from gold.dim_project_profile", ()
    )
    rows = query(
        "select u.unit_id, p.project_id, f.inventory_status, f.release_date, f.sold_date"
        " from gold.fact_unit_inventory_snapshot f"
        " join gold.dim_unit_master u on u.unit_key = f.unit_key"
        " join gold.dim_project_profile p on p.project_key = f.project_key"
        " where f.snapshot_date_key = %s",
        (key,),
    )
    units = [r for r in rows if _clean(r["inventory_status"]) in STATUS]
    sales = [r for r in rows if _clean(r["inventory_status"]) == "SOLD"]
    return manifest, projects, units, sales


def build(query: Query, path: str = DEFAULT_PATH, *, snapshot_id: str | None = None) -> dict:
    """Write the dataset for the configured snapshot; returns counts (no row data)."""
    snapshot_id = snapshot_id or os.environ["WAREHOUSE_SNAPSHOT_ID"]
    dataset = assemble(*read(query, snapshot_id))
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dataset, ensure_ascii=False), encoding="utf-8")
    snapshot = dataset["snapshots"][0]
    return {
        "path": str(out),
        "snapshot": snapshot["id"],
        "businessDate": snapshot["businessDate"],
        "projects": len(dataset["projects"]),
        "properties": len(snapshot["properties"]),
        "transactions": len(dataset["transactions"]),
    }


def publish(query: Query, path: str = DEFAULT_PATH) -> str:
    """`build()`, then publish it as the user's dashboard dataset; returns the dataset id."""
    from contoso import publish_dataset

    build(query, path)
    return publish_dataset("dashboard", path)
