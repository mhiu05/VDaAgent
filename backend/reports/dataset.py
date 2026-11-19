"""The business dashboard dataset (doc 19 "Dataset", "Tasks on the dashboard").

An agent publishes a `DashboardDataset` (the frontend type without `tasks`/`taskSource`) from a
JSON file in its folder; `api` validates it and stores a copy. `GET /api/dashboard/dataset`
returns the newest one with `tasks` built from the user's report attempts. The KPIs are computed
in the browser (doc 19 "Computation").
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.api.errors import ApiError
from backend.db import tables as t
from backend.messaging import attachments
from backend.reports.schema import valid_date, valid_timezone

MAX_BYTES = 20 * 1024 * 1024
KEEP = 5
PROPERTY_STATUS = ("available", "reserved", "sold", "withdrawn")
TRANSACTION_STATUS = ("completed", "cancelled", "reserved")
COMPLETENESS = ("full", "partial", "missing")


def _bad(message: str) -> ApiError:
    return ApiError(400, "invalid_dataset", message)


def _instant(v: Any, what: str, nullable: bool = False) -> None:
    if v is None and nullable:
        return
    try:
        parsed = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        raise _bad(f"{what} must be an ISO 8601 instant") from None
    if not isinstance(v, str) or parsed.tzinfo is None:
        raise _bad(f"{what} must be an ISO 8601 instant with an offset")


def _date(v: Any, what: str, nullable: bool = False) -> None:
    if v is None and nullable:
        return
    if not valid_date(v):
        raise _bad(f"{what} must be a YYYY-MM-DD date")


def _str(obj: dict, key: str, what: str) -> str:
    v = obj.get(key)
    if not isinstance(v, str) or not v.strip():
        raise _bad(f"{what}.{key} is required")
    return v


def _list(obj: dict, key: str, what: str) -> list:
    v = obj.get(key)
    if not isinstance(v, list):
        raise _bad(f"{what}.{key} must be an array")
    return v


def _source(v: Any, what: str) -> None:
    if not isinstance(v, dict):
        raise _bad(f"{what} must be an object")
    for key in ("id", "label"):
        _str(v, key, what)
    if v.get("completeness") not in COMPLETENESS:
        raise _bad(f"{what}.completeness must be full, partial or missing")
    _instant(v.get("dataThrough"), f"{what}.dataThrough")
    _instant(v.get("updatedAt"), f"{what}.updatedAt")


def validate_dataset(d: Any) -> dict:
    if not isinstance(d, dict):
        raise _bad("the dataset must be an object")
    tz = d.get("businessTimezone")
    if not isinstance(tz, str) or not valid_timezone(tz):
        raise _bad("businessTimezone must be an IANA timezone")
    projects = set()
    for p in _list(d, "projects", "dataset"):
        if not isinstance(p, dict):
            raise _bad("projects must be objects")
        for key in ("id", "name", "marketId", "marketLabel", "sourceId"):
            _str(p, key, "project")
        projects.add(p["id"])
    for s in _list(d, "snapshots", "dataset"):
        if not isinstance(s, dict):
            raise _bad("snapshots must be objects")
        for key in ("id", "policyVersion"):
            _str(s, key, "snapshot")
        _date(s.get("businessDate"), "snapshot.businessDate")
        # a date, like the dashboard period it closes (`closingBefore === scope.to` in the UI)
        _date(s.get("closingBefore"), "snapshot.closingBefore")
        if s["businessDate"] >= s["closingBefore"]:
            raise _bad("snapshot.businessDate must be before snapshot.closingBefore")
        _source(s.get("source"), "snapshot.source")
        for prop in _list(s, "properties", "snapshot"):
            if not isinstance(prop, dict):
                raise _bad("properties must be objects")
            for key in ("id", "snapshotId", "projectId", "sourceId"):
                _str(prop, key, "property")
            if prop["projectId"] not in projects:
                raise _bad(f"property {prop['id']} names an unknown project {prop['projectId']}")
            if prop.get("status") not in PROPERTY_STATUS:
                raise _bad(
                    f"property {prop['id']}: status must be one of {', '.join(PROPERTY_STATUS)}"
                )
            _date(prop.get("listedBusinessDate"), "property.listedBusinessDate", nullable=True)
    for tx in _list(d, "transactions", "dataset"):
        if not isinstance(tx, dict):
            raise _bad("transactions must be objects")
        for key in ("id", "propertyId", "projectId", "sourceId"):
            _str(tx, key, "transaction")
        if tx["projectId"] not in projects:
            raise _bad(f"transaction {tx['id']} names an unknown project {tx['projectId']}")
        if tx.get("status") not in TRANSACTION_STATUS:
            raise _bad(
                f"transaction {tx['id']}: status must be one of {', '.join(TRANSACTION_STATUS)}"
            )
        if not isinstance(tx.get("test"), bool):
            raise _bad(f"transaction {tx['id']}: test must be true or false")
        _instant(tx.get("completedAt"), f"transaction {tx['id']} completedAt", nullable=True)
    _source(d.get("transactionSource"), "transactionSource")
    covered = _list(d, "coveredDates", "dataset")
    for day in covered:
        _date(day, "coveredDates[]")
    out = {
        k: d[k]
        for k in (
            "businessTimezone",
            "projects",
            "snapshots",
            "transactions",
            "transactionSource",
            "coveredDates",
        )
    }
    return out


async def publish(conn: AsyncConnection, caller: Any, *, kind: str, path: str) -> str:
    if kind != "dashboard":
        raise ApiError(400, "invalid_request", "Chỉ có kind='dashboard'.")
    (f,) = attachments.from_folder(Path(caller.folder), [path])
    if f.source.stat().st_size > MAX_BYTES:
        raise ApiError(413, "file_too_large", "Bộ dữ liệu tối đa 20 MB.")
    try:
        raw = json.loads(f.source.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise _bad(f"{path} is not valid JSON: {e}") from None
    dataset_id, _ = await store(conn, caller.user_id, caller.agent_id, raw)
    return dataset_id


async def store(
    conn: AsyncConnection, user_id: Any, agent_id: Any, raw: Any, *, kind: str = "dashboard"
) -> tuple[str, bool]:
    """Validate and keep a dataset as the user's newest (five kept). Returns (id, stored): an
    identical copy of the newest one is not stored again, so re-publishing is idempotent."""
    payload = validate_dataset(raw)
    d = t.datasets
    newest = (
        await conn.execute(
            select(d.c.id, d.c.payload)
            .where(d.c.user_id == user_id, d.c.kind == kind)
            .order_by(d.c.published_at.desc(), d.c.id.desc())
            .limit(1)
        )
    ).one_or_none()
    if newest is not None and _same(newest.payload, payload):
        return str(newest.id), False
    dataset_id = await conn.scalar(
        d.insert()
        .values(user_id=user_id, kind=kind, payload=payload, agent_id=agent_id)
        .returning(d.c.id)
    )
    keep = (
        select(d.c.id)
        .where(d.c.user_id == user_id, d.c.kind == kind)
        .order_by(d.c.published_at.desc(), d.c.id.desc())
        .limit(KEEP)
    )
    await conn.execute(
        delete(d).where(d.c.user_id == user_id, d.c.kind == kind, d.c.id.not_in(keep))
    )
    return str(dataset_id), True


def _same(stored: dict, payload: dict) -> bool:
    """Equal data, ignoring when each source was last refreshed (`updatedAt`)."""

    def strip(v: Any) -> Any:
        if isinstance(v, dict):
            return {k: strip(x) for k, x in v.items() if k != "updatedAt"}
        if isinstance(v, list):
            return [strip(x) for x in v]
        return v

    return strip(stored) == strip(payload)


def _iso(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


async def tasks(conn: AsyncConnection, user_id: uuid.UUID) -> list[dict]:
    a, r, v = t.report_attempts, t.reports, t.report_versions
    rows = (
        await conn.execute(
            select(a, r.c.code, r.c.project_ids, v.c.sequence)
            .select_from(a.join(r, a.c.report_id == r.c.id).outerjoin(v, a.c.version_id == v.c.id))
            .where(r.c.user_id == user_id)
            .order_by(a.c.report_id, a.c.created_at, a.c.id)
        )
    ).all()
    number: dict[Any, int] = {}
    out = []
    now = datetime.now(UTC)
    for row in rows:
        number[row.report_id] = number.get(row.report_id, 0) + 1
        out.append(
            {
                "id": str(row.id),
                "projectId": row.project_ids[0] if row.project_ids else "",
                "state": row.state,
                "createdAt": _iso(row.created_at),
                "observedAt": _iso(row.finished_at or now),
                "failedAt": _iso(row.finished_at or row.created_at)
                if row.state == "failed"
                else None,
                "attemptNumber": number[row.report_id],
                "reportId": row.code,
                "versionId": f"{row.code}-v{row.sequence}" if row.sequence else None,
                "error": row.reason if row.state == "failed" else None,
            }
        )
    return out


async def dashboard_view(conn: AsyncConnection, user_id: uuid.UUID) -> dict:
    d = t.datasets
    row = (
        await conn.execute(
            select(d)
            .where(d.c.user_id == user_id, d.c.kind == "dashboard")
            .order_by(d.c.published_at.desc(), d.c.id.desc())
            .limit(1)
        )
    ).one_or_none()
    if row is None:
        return {"dataset": None, "publishedAt": None}
    now = datetime.now(UTC).isoformat()
    dataset = dict(row.payload)
    dataset["tasks"] = await tasks(conn, user_id)
    dataset["taskSource"] = {
        "id": "report-attempts",
        "mode": "api",
        "label": "Việc tạo báo cáo",
        "dataThrough": now,
        "updatedAt": now,
        "completeness": "full",
    }
    return {"dataset": dataset, "publishedAt": _iso(row.published_at)}
