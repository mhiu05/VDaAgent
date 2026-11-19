"""`/api/reports*` (doc 15 "Reports"; doc 19 "Reading"). User-only and owner-scoped."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import select

from backend.api.deps import Conn, UserRole
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.reports import read, service

router = APIRouter(prefix="/reports", tags=["reports"])
MAX_Q = 500


async def latest_dataset(conn, user_id):
    d = t.datasets
    return (
        await conn.execute(
            select(d)
            .where(d.c.user_id == user_id, d.c.kind == "dashboard")
            .order_by(d.c.published_at.desc())
            .limit(1)
        )
    ).one_or_none()


def _data_through(ds) -> str | None:
    """The newest inventory snapshot's `closingBefore` (a date) in the user's dataset."""
    snapshots = ds.payload.get("snapshots", []) if ds else []
    ends = [s.get("closingBefore") for s in snapshots if isinstance(s, dict)]
    ends = [e for e in ends if isinstance(e, str) and read.valid_date(e)]
    return max(ends, default=None)


async def projects_of(conn, user_id, lib: read.Library) -> list[dict]:
    projects: dict[str, dict] = {}
    ds = await latest_dataset(conn, user_id)
    for p in ds.payload.get("projects", []) if ds else []:
        if isinstance(p, dict) and p.get("id"):
            projects[p["id"]] = {
                "id": p["id"],
                "name": p.get("name", p["id"]),
                "marketId": p.get("marketId", ""),
                "marketLabel": p.get("marketLabel", ""),
            }
    for record in lib.records:
        for pid in record["projectIds"]:
            projects.setdefault(pid, {"id": pid, "name": pid, "marketId": "", "marketLabel": ""})
    return sorted(projects.values(), key=lambda p: p["id"])


def _query(request: Request) -> read.Query:
    p = request.query_params
    q = p.get("q", "")
    if len(q) > MAX_Q:
        raise ApiError(400, "invalid_request", "Từ khóa tìm kiếm quá dài.")
    try:
        page, page_size = int(p.get("page", 1)), int(p.get("pageSize", 25))
    except ValueError:
        raise ApiError(400, "invalid_request") from None
    query = read.Query(
        q=q,
        types=p.getlist("type"),
        statuses=p.getlist("status"),
        markets=p.getlist("market"),
        projects=p.getlist("project"),
        authors=p.getlist("author"),
        agents=p.getlist("agent"),
        date_field=p.get("dateField", "createdAt"),
        start=p.get("from") or None,
        end=p.get("to") or None,
        timezone=p.get("timezone", read.DEFAULT_TZ),
        sort=p.get("sort", "createdAt"),
        direction=p.get("direction", "desc"),
        page=page,
        page_size=page_size,
    )
    if (
        query.date_field not in ("createdAt", "completedAt")
        or query.sort not in ("createdAt", "completedAt", "title", "status")
        or query.direction not in ("asc", "desc")
        or any(s not in read.STATUSES for s in query.statuses)
    ):
        raise ApiError(400, "invalid_request")
    return query


def _scope(request: Request) -> read.Query:
    p = request.query_params
    return read.scope_query(
        p.get("from") or None,
        p.get("to") or None,
        p.get("timezone", read.DEFAULT_TZ),
        p.get("project") or None,
        p.get("market") or None,
    )


@router.get("/catalog")
async def catalog(conn: Conn, user: UserRole) -> dict:
    lib = await read.load(conn, user.id)
    ds = await latest_dataset(conn, user.id)
    tz = ds.payload.get("businessTimezone") if ds else None
    tz = tz if isinstance(tz, str) and read.valid_timezone(tz) else read.DEFAULT_TZ
    agents = (
        (
            await conn.execute(
                select(t.agents.c.slug)
                .where(t.agents.c.user_id == user.id, t.agents.c.state == "active")
                .order_by(t.agents.c.slug)
            )
        )
        .scalars()
        .all()
    )
    types = sorted({r["type"] for r in lib.records})
    return {
        "reportTypes": [{"id": x, "name": x} for x in types],
        "projects": await projects_of(conn, user.id, lib),
        "authors": [{"id": str(user.id), "name": user.display_name or user.username}],
        "agents": list(agents),
        "defaultScope": read.default_scope(tz, _data_through(ds)),
    }


async def _names(conn, user_id, lib) -> dict[str, str]:
    return {p["id"]: p["name"] for p in await projects_of(conn, user_id, lib)}


@router.get("")
async def list_reports(request: Request, conn: Conn, user: UserRole) -> dict:
    query = _query(request)
    lib = await read.load(conn, user.id)
    rows = read.select_reports(lib, query, await _names(conn, user.id, lib))
    return read.paginate(rows, query.page, query.page_size)


@router.get("/summary")
async def summary(request: Request, conn: Conn, user: UserRole) -> dict:
    query = _scope(request)
    lib = await read.load(conn, user.id)
    rows = read.select_reports(lib, query, await _names(conn, user.id, lib))
    completed = sum(
        1
        for row in rows
        for v in lib.versions.get(row["_record"]["id"], [])
        if read.in_period(v["_completed"], query.start, query.end, query.timezone)
    )
    return {
        "distinctReports": len(rows),
        "completedVersions": completed,
        "source": read.library_source(),
    }


@router.get("/recent")
async def recent(request: Request, conn: Conn, user: UserRole, limit: int = 5) -> list[dict]:
    if not 0 <= limit <= 20:
        raise ApiError(400, "invalid_request", "limit phải từ 0 đến 20.")
    query = _scope(request)
    lib = await read.load(conn, user.id)
    rows = read.select_reports(lib, query, await _names(conn, user.id, lib))
    return [read.strip(r) for r in rows[:limit]]


@router.get("/{report_id}")
async def detail(report_id: str, conn: Conn, user: UserRole, version: str | None = None) -> dict:
    lib = await read.load(conn, user.id)
    record = next((r for r in lib.records if r["id"] == report_id), None)
    if record is None:
        raise ApiError(404, "not_found")
    versions = lib.versions.get(report_id, [])
    chosen = (
        next((v for v in versions if v["id"] == version), None)
        if version
        else (versions[0] if versions else None)
    )
    if version and chosen is None:
        raise ApiError(404, "not_found")
    vid = lib.version_rows[chosen["id"]][0] if chosen else None
    return {
        "summary": read.strip(read.summarize(lib, record)),
        "version": read.public(chosen),
        "versions": [read.public(v) for v in versions],
        "evidence": lib.evidence.get(vid, []) if vid else [],
        "artifacts": [read.public(a) | {} for a in lib.artifacts.get(vid, [])] if vid else [],
    }


@router.delete("/{report_id}", status_code=204)
async def delete_report(report_id: str, conn: Conn, user: UserRole) -> Response:
    await service.delete(conn, user.id, report_id=report_id)
    return Response(status_code=204)


@router.get("/{report_id}/versions/{version_id}/artifacts/{artifact_id}")
async def artifact(
    report_id: str, version_id: str, artifact_id: str, conn: Conn, user: UserRole
) -> FileResponse:
    lib = await read.load(conn, user.id)
    row = lib.version_rows.get(version_id)
    if row is None or row[1] != report_id:
        raise ApiError(404, "not_found")
    match = next((a for a in lib.artifacts.get(row[0], []) if a["id"] == artifact_id), None)
    if match is None or not Path(match["_path"]).is_file():
        raise ApiError(404, "not_found")
    return FileResponse(
        match["_path"],
        media_type=match["mediaType"],
        filename=match["filename"],
        content_disposition_type="attachment",
        headers={"X-Content-Type-Options": "nosniff"},
    )
