"""Reading the reports library (doc 19 "Reading"): the frontend `ReportsService` shapes.

The selection rules are a port of the frontend `selectReports` / `summarizeRecord` /
`paginate` (`features/reports/model/{lifecycle,query}.ts`), run in Python over one user's
reports, so the API and the mock agree exactly: accent- and case-insensitive search, repeated
keys mean "any of", business dates `[from, to)` in the query timezone, pages of 25/50/100.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.api.errors import ApiError
from backend.db import tables as t
from backend.reports.schema import valid_date, valid_timezone
from backend.reports.service import status_of, version_code

STATUSES = ("completed", "generating", "failed", "draft", "unsupported")
PAGE_SIZES = (25, 50, 100)
DEFAULT_TZ = "Asia/Ho_Chi_Minh"


def fold(value: str) -> str:
    v = unicodedata.normalize("NFD", value)
    v = "".join(c for c in v if not unicodedata.combining(c)).replace("đ", "d").replace("Đ", "D")
    return re.sub(r"\s+", " ", v.lower().strip())


def iso(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


def business_date(instant: datetime | None, timezone: str) -> str | None:
    return instant.astimezone(ZoneInfo(timezone)).date().isoformat() if instant else None


def in_period(instant: datetime | None, start: str | None, end: str | None, tz: str) -> bool:
    if not start and not end:
        return instant is not None
    d = business_date(instant, tz)
    return d is not None and (not start or d >= start) and (not end or d < end)


def check_range(start: str | None, end: str | None, timezone: str) -> None:
    if not valid_timezone(timezone):
        raise ApiError(400, "invalid_request", "Múi giờ không hợp lệ.")
    if (
        (start and not valid_date(start))
        or (end and not valid_date(end))
        or (start and end and start >= end)
    ):
        raise ApiError(400, "invalid_request", "Khoảng ngày phải là [from, to) hợp lệ.")


@dataclass
class Query:
    q: str = ""
    types: list[str] = field(default_factory=list)
    statuses: list[str] = field(default_factory=list)
    markets: list[str] = field(default_factory=list)
    projects: list[str] = field(default_factory=list)
    authors: list[str] = field(default_factory=list)
    agents: list[str] = field(default_factory=list)
    date_field: str = "createdAt"
    start: str | None = None
    end: str | None = None
    timezone: str = DEFAULT_TZ
    sort: str = "createdAt"
    direction: str = "desc"
    page: int = 1
    page_size: int = 25


# --- loading one user's library ----------------------------------------------------------


@dataclass
class Library:
    user: Any
    records: list[dict]
    versions: dict[str, list[dict]]  # report code → saved versions, newest first
    attempts: dict[str, dict | None]  # report code → latest attempt
    evidence: dict[uuid.UUID, list[dict]]
    artifacts: dict[uuid.UUID, list[dict]]
    version_rows: dict[str, Any]  # version code → (uuid, report code)


def source_view(source: dict, completed_at: datetime) -> dict:
    return {
        "id": source.get("id", ""),
        "mode": "api",
        "label": source.get("label", ""),
        "dataThrough": source.get("dataThrough", iso(completed_at)),
        "updatedAt": iso(completed_at),
        "completeness": source.get("completeness", "partial"),
    }


async def load(conn: AsyncConnection, user_id: uuid.UUID) -> Library:
    user = (await conn.execute(select(t.users).where(t.users.c.id == user_id))).one()
    r, v, a, ag = t.reports, t.report_versions, t.report_attempts, t.agents
    reports = (
        await conn.execute(
            select(r, ag.c.slug)
            .select_from(r.join(ag, r.c.agent_id == ag.c.id))
            .where(r.c.user_id == user_id)
        )
    ).all()
    by_id = {row.id: row for row in reports}
    versions_rows = (
        await conn.execute(
            select(v)
            .where(v.c.report_id.in_(list(by_id)))
            .order_by(v.c.report_id, v.c.sequence.desc())
        )
    ).all()
    attempts_rows = (
        await conn.execute(
            select(a).where(a.c.report_id.in_(list(by_id))).order_by(a.c.created_at.desc(), a.c.id)
        )
    ).all()
    version_ids = [row.id for row in versions_rows]
    ev_rows = (
        await conn.execute(
            select(t.report_evidence)
            .where(t.report_evidence.c.version_id.in_(version_ids))
            .order_by(t.report_evidence.c.id)
        )
    ).all()
    art_rows = (
        await conn.execute(
            select(t.report_artifacts)
            .where(t.report_artifacts.c.version_id.in_(version_ids))
            .order_by(t.report_artifacts.c.filename)
        )
    ).all()
    code_of_version = {
        row.id: version_code(by_id[row.report_id].code, row.sequence) for row in versions_rows
    }
    evidence: dict[uuid.UUID, list[dict]] = {}
    for e in ev_rows:
        evidence.setdefault(e.version_id, []).append(
            {
                "id": e.id,
                "sourceId": e.source_id,
                "label": e.label,
                "projectIds": list(e.project_ids),
                "snapshotId": e.snapshot_id,
                "dataThrough": iso(e.data_through),
                "limitation": e.limitation,
            }
        )
    artifacts: dict[uuid.UUID, list[dict]] = {}
    for f in art_rows:
        artifacts.setdefault(f.version_id, []).append(
            {
                "id": str(f.id),
                "versionId": code_of_version[f.version_id],
                "filename": f.filename,
                "mediaType": f.mime,
                "_path": f.path,
                "_size": f.size,
            }
        )
    versions: dict[str, list[dict]] = {}
    version_rows: dict[str, Any] = {}
    for row in versions_rows:
        code = by_id[row.report_id].code
        vcode = code_of_version[row.id]
        versions.setdefault(code, []).append(
            {
                "schema": row.schema,
                "id": vcode,
                "reportId": code,
                "sequence": row.sequence,
                "completedAt": iso(row.completed_at),
                "source": source_view(row.source, row.completed_at),
                "policyVersion": row.policy_version,
                "contentRevision": row.content_revision,
                "sections": [],
                "evidenceIds": [e["id"] for e in evidence.get(row.id, [])],
                "artifactIds": [x["id"] for x in artifacts.get(row.id, [])],
                "_completed": row.completed_at,
            }
        )
        version_rows[vcode] = (row.id, code)
    attempts: dict[str, dict | None] = {}
    for row in attempts_rows:
        code = by_id[row.report_id].code
        if code not in attempts:
            attempts[code] = {
                "id": str(row.id),
                "reportId": code,
                "state": row.state,
                "createdAt": iso(row.created_at),
                "finishedAt": iso(row.finished_at),
                "versionId": code_of_version.get(row.version_id),
            }
    author = {"id": str(user.id), "name": user.display_name or user.username}
    records = [
        {
            "id": row.code,
            "code": row.code,
            "title": row.title,
            "type": row.type,
            "projectIds": list(row.project_ids),
            "marketIds": list(row.market_ids),
            "author": author,
            "agent": row.slug,
            "createdAt": iso(row.created_at),
            "versionIds": [x["id"] for x in versions.get(row.code, [])],
            "latestAttemptId": (attempts.get(row.code) or {}).get("id"),
            "_created": row.created_at,
        }
        for row in reports
    ]
    return Library(
        user=user,
        records=records,
        versions=versions,
        attempts=attempts,
        evidence=evidence,
        artifacts=artifacts,
        version_rows=version_rows,
    )


def public(d: dict | None) -> dict | None:
    return None if d is None else {k: v for k, v in d.items() if not k.startswith("_")}


# --- selection (port of the frontend) ----------------------------------------------------


def summarize(lib: Library, record: dict, query: Query | None = None) -> dict:
    versions = lib.versions.get(record["id"], [])
    attempt = lib.attempts.get(record["id"])
    status = status_of(len(versions), attempt["state"] if attempt else None)
    if query is not None and query.date_field == "completedAt":
        matched = next(
            (
                v
                for v in versions
                if in_period(v["_completed"], query.start, query.end, query.timezone)
            ),
            None,
        )
    else:
        matched = versions[0] if versions else None
    return {
        "record": public(record),
        "status": status,
        "latestVersion": public(versions[0]) if versions else None,
        "matchedVersion": public(matched),
        "latestAttempt": attempt,
        "_record": record,
        "_matched": matched,
    }


def select_reports(lib: Library, query: Query, project_names: dict[str, str]) -> list[dict]:
    check_range(query.start, query.end, query.timezone)
    needle = fold(query.q) if query.q else ""

    def matches(selected: list[str], actual: list[str]) -> bool:
        return not selected or any(v in actual for v in selected)

    rows = []
    for record in lib.records:
        row = summarize(lib, record, query)
        haystack = fold(
            " ".join(
                [
                    record["code"],
                    record["title"],
                    " ".join(project_names.get(p, p) for p in record["projectIds"]),
                    record["author"]["name"],
                ]
            )
        )
        if needle and needle not in haystack:
            continue
        if not (
            matches(query.types, [record["type"]])
            and matches(query.statuses, [row["status"]])
            and matches(query.projects, record["projectIds"])
            and matches(query.markets, record["marketIds"])
            and matches(query.authors, [record["author"]["id"]])
            and matches(query.agents, [record["agent"]])
        ):
            continue
        if query.date_field == "completedAt":
            if row["_matched"] is None:
                continue
        elif not in_period(record["_created"], query.start, query.end, query.timezone):
            continue
        rows.append(row)

    def key(row: dict) -> Any:
        if query.sort == "title":
            return fold(row["_record"]["title"])
        if query.sort == "status":
            return row["status"]
        value = (
            row["_record"]["_created"]
            if query.sort == "createdAt"
            else (row["_matched"] or {}).get("_completed")
        )
        return value.timestamp() if value else None

    with_value = [r for r in rows if key(r) is not None]
    without = sorted((r for r in rows if key(r) is None), key=lambda r: r["_record"]["id"])
    with_value.sort(key=lambda r: r["_record"]["id"])
    with_value.sort(key=key, reverse=query.direction == "desc")
    return with_value + without


def strip(row: dict) -> dict:
    return {k: v for k, v in row.items() if not k.startswith("_")}


def paginate(rows: list[dict], page: int, page_size: int) -> dict:
    if page < 1 or page_size not in PAGE_SIZES:
        raise ApiError(400, "invalid_request", "Phân trang không hợp lệ.")
    count = max(1, -(-len(rows) // page_size))
    page = min(page, count)
    return {
        "rows": [strip(r) for r in rows[(page - 1) * page_size : page * page_size]],
        "totalRows": len(rows),
        "page": page,
        "pageSize": page_size,
        "pageCount": count,
    }


def scope_query(
    start: str | None, end: str | None, timezone: str, project: str | None, market: str | None
) -> Query:
    return Query(
        start=start,
        end=end,
        timezone=timezone,
        statuses=["completed"],
        date_field="completedAt",
        sort="completedAt",
        direction="desc",
        projects=[project] if project else [],
        markets=[market] if market else [],
    )


def default_scope(timezone: str = DEFAULT_TZ, data_through: str | None = None) -> dict:
    """The dashboard's opening period: the last 30 days, ending tomorrow (the period end is
    exclusive) — or, when the newest dataset closes earlier, ending where its data does, so the
    first view shows the data that exists instead of an empty month."""
    today = datetime.now(UTC).astimezone(ZoneInfo(timezone)).date()
    end = today + timedelta(days=1)
    if data_through and valid_date(data_through):
        end = min(end, date.fromisoformat(data_through))
    return {
        "from": (end - timedelta(days=31)).isoformat(),
        "to": end.isoformat(),
        "timezone": timezone,
    }


def library_source() -> dict:
    now = datetime.now(UTC).isoformat()
    return {
        "id": "reports",
        "mode": "api",
        "label": "Thư viện báo cáo",
        "dataThrough": now,
        "updatedAt": now,
        "completeness": "full",
    }
