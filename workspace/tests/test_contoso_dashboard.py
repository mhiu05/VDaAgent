"""`contoso.dashboard.assemble`: warehouse rows in, the dashboard's dataset out — nothing added."""

from __future__ import annotations

from datetime import UTC, date, datetime

from contoso.dashboard import POLICY_VERSION, assemble

MANIFEST = {
    "snapshot_id": "SNAP-1  ",
    "snapshot_date": date(2026, 6, 30),
    "timezone": "Asia/Ho_Chi_Minh",
    "source_system": "DW",
}
PROJECTS = [
    {"project_id": "PRJ-B", "project_name": "B", "market_id": "MB", "market_name": "Thị trường B"},
    {"project_id": "PRJ-A", "project_name": "A", "market_id": "MA", "market_name": "Thị trường A"},
]
UNITS = [
    {
        "unit_id": "U1",
        "project_id": "PRJ-A",
        "inventory_status": "AVAILABLE",
        "release_date": date(2026, 6, 1),
    },
    {
        "unit_id": "U2",
        "project_id": "PRJ-A",
        "inventory_status": "BOOKED",
        "release_date": date(2025, 1, 1),
    },
    {"unit_id": "U3", "project_id": "PRJ-B", "inventory_status": "AVAILABLE", "release_date": None},
    {
        "unit_id": "U9",
        "project_id": "PRJ-X",
        "inventory_status": "AVAILABLE",
        "release_date": date(2026, 1, 1),
    },
]
SALES = [
    {"unit_id": "S1", "project_id": "PRJ-A", "sold_date": date(2026, 6, 30)},
    {"unit_id": "S2", "project_id": "PRJ-B", "sold_date": date(2024, 7, 1)},  # first day kept
    {"unit_id": "S3", "project_id": "PRJ-B", "sold_date": date(2024, 6, 30)},  # outside the window
]


def test_assemble_maps_the_snapshot_without_inventing_rows():
    d = assemble(MANIFEST, PROJECTS, UNITS, SALES, now=datetime(2026, 10, 21, tzinfo=UTC))
    assert d["businessTimezone"] == "Asia/Ho_Chi_Minh"
    assert [p["id"] for p in d["projects"]] == ["PRJ-A", "PRJ-B"]
    [snap] = d["snapshots"]
    assert (snap["id"], snap["businessDate"], snap["closingBefore"]) == (
        "SNAP-1",
        "2026-06-30",
        "2026-07-01",
    )
    assert snap["policyVersion"] == POLICY_VERSION
    assert snap["source"]["dataThrough"] == "2026-07-01T00:00:00+07:00"
    # statuses map 1:1; units of an unknown project are left out; a missing listing date stays null
    assert [(p["id"], p["status"], p["listedBusinessDate"]) for p in snap["properties"]] == [
        ("U1", "available", "2026-06-01"),
        ("U2", "reserved", "2025-01-01"),
        ("U3", "available", None),
    ]
    # sales: completed, real, at local noon of the sale date, only inside the covered window
    assert [(x["id"], x["completedAt"]) for x in d["transactions"]] == [
        ("sale:S1", "2026-06-30T12:00:00+07:00"),
        ("sale:S2", "2024-07-01T12:00:00+07:00"),
    ]
    assert all(x["status"] == "completed" and x["test"] is False for x in d["transactions"])
    assert d["coveredDates"][0] == "2024-07-01" and d["coveredDates"][-1] == "2026-06-30"
    assert len(d["coveredDates"]) == 730


def test_read_splits_the_snapshot_rows_and_asks_for_the_snapshot_date_key():
    from contoso.dashboard import read

    asked = []

    def query(sql, params=()):
        asked.append(params)
        if "snapshot_manifest" in sql:
            return [MANIFEST]
        if "dim_project_profile p" not in sql:
            return PROJECTS
        return [
            *UNITS,
            {
                "unit_id": "S1",
                "project_id": "PRJ-A",
                "inventory_status": "SOLD",
                "release_date": date(2025, 1, 1),
                "sold_date": date(2026, 6, 30),
            },
        ]

    manifest, projects, units, sales = read(query, "SNAP-1")
    assert asked == [("SNAP-1",), (), (20260630,)]
    assert manifest is MANIFEST and projects == PROJECTS
    assert [u["unit_id"] for u in units] == ["U1", "U2", "U3", "U9"]
    assert [s["unit_id"] for s in sales] == ["S1"]
