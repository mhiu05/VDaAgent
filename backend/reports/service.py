"""The report lifecycle (doc 19 "Lifecycle"): start → publish (or fail), attempts that end with
their task, and the status rule of the frontend `lifecycle.ts`.

Report ids are `R<n>` per user, version ids `<code>-v<sequence>`. A published version, its
artifacts and its evidence are immutable (invariant 8). `report.updated` is published on every
change, `report-ready` / `task-failed` notifications on success and failure.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import Integer, cast, func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.api.errors import ApiError
from backend.db import tables as t
from backend.db.session import on_commit
from backend.messaging import attachments
from backend.notifications import notify
from backend.reports.schema import SchemaError, validate_schema

TYPE_RE = re.compile(r"^[a-z][a-z0-9-]{0,79}$")
ARTIFACT_TYPES = {
    ".html": "text/html",
    ".htm": "text/html",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
COMPLETENESS = ("full", "partial", "missing")
POLICY_VERSION = "report-policy-v1"


def status_of(saved_versions: int, latest_attempt_state: str | None) -> str:
    """Doc 19 / frontend `summarizeRecord`."""
    if saved_versions:
        return "completed"
    if latest_attempt_state is None:
        return "draft"
    return {"queued": "generating", "running": "generating", "failed": "failed"}.get(
        latest_attempt_state, "unsupported"
    )


def version_code(code: str, sequence: int) -> str:
    return f"{code}-v{sequence}"


def _invalid(message: str) -> ApiError:
    return ApiError(400, "invalid_report", message)


def _instant(value: Any, what: str) -> datetime:
    if not isinstance(value, str):
        raise _invalid(f"{what} must be an ISO 8601 instant")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise _invalid(f"{what} must be an ISO 8601 instant") from None
    if parsed.tzinfo is None:
        raise _invalid(f"{what} needs a UTC offset")
    if parsed > datetime.now(UTC) + timedelta(minutes=5):
        raise _invalid(f"{what} is later than the publish time")
    return parsed


def _evidence(items: list[Any]) -> list[dict]:
    out, seen = [], set()
    for raw in items:
        if not isinstance(raw, dict):
            raise _invalid("evidence items must be objects")
        eid = raw.get("id")
        if not isinstance(eid, str) or not eid.strip() or eid in seen:
            raise _invalid("evidence ids must be unique non-empty strings")
        seen.add(eid)
        for key in ("label", "sourceId"):
            if not isinstance(raw.get(key), str) or not raw[key].strip():
                raise _invalid(f"evidence {eid}: {key} is required")
        projects = raw.get("projectIds", [])
        if not isinstance(projects, list) or not all(isinstance(p, str) for p in projects):
            raise _invalid(f"evidence {eid}: projectIds must be strings")
        snapshot = raw.get("snapshotId")
        if snapshot is not None and not isinstance(snapshot, str):
            raise _invalid(f"evidence {eid}: snapshotId must be a string or null")
        out.append(
            {
                "id": eid,
                "label": raw["label"],
                "source_id": raw["sourceId"],
                "project_ids": projects,
                "snapshot_id": snapshot,
                "data_through": _instant(raw.get("dataThrough"), f"evidence {eid} dataThrough"),
                "limitation": str(raw.get("limitation") or ""),
            }
        )
    return out


def _source(raw: Any, slug: str, completed_at: datetime) -> dict:
    if raw is None:
        return {
            "id": f"agent:{slug}",
            "label": slug,
            "dataThrough": completed_at.isoformat(),
            "completeness": "partial",
        }
    if not isinstance(raw, dict):
        raise _invalid("source must be an object")
    for key in ("id", "label"):
        if not isinstance(raw.get(key), str) or not raw[key].strip():
            raise _invalid(f"source.{key} is required")
    if raw.get("completeness") not in COMPLETENESS:
        raise _invalid("source.completeness must be full, partial or missing")
    _instant(raw.get("dataThrough"), "source dataThrough")
    return {
        "id": raw["id"],
        "label": raw["label"],
        "dataThrough": raw["dataThrough"],
        "completeness": raw["completeness"],
    }


def publish_update(h: Any, conn: AsyncConnection, user_id: Any, data: dict) -> None:
    on_commit(conn, lambda: h.bus.publish(user_id, "report.updated", data))


async def _report_for_user(conn: AsyncConnection, user_id: Any, code: str) -> Any:
    row = (
        await conn.execute(
            select(t.reports).where(t.reports.c.user_id == user_id, t.reports.c.code == code)
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found")
    return row


async def _attempt_for_user(conn: AsyncConnection, user_id: Any, attempt_id: str) -> Any:
    try:
        aid = uuid.UUID(str(attempt_id))
    except ValueError:
        raise ApiError(404, "not_found") from None
    a, r = t.report_attempts, t.reports
    row = (
        await conn.execute(
            select(a, r.c.code, r.c.user_id)
            .select_from(a.join(r, a.c.report_id == r.c.id))
            .where(a.c.id == aid)
            .with_for_update(of=a)
        )
    ).one_or_none()
    if row is None or row.user_id != user_id:
        raise ApiError(404, "not_found")
    return row


async def start(
    h: Any,
    conn: AsyncConnection,
    caller: Any,
    *,
    title: str,
    type_: str,
    projects: list[str],
    markets: list[str],
    report_id: str | None,
) -> dict:
    if not TYPE_RE.match(type_):
        raise ApiError(400, "invalid_request", "type must match ^[a-z][a-z0-9-]{0,79}$")
    if report_id:
        report = await _report_for_user(conn, caller.user_id, report_id)
    else:
        n = await conn.scalar(
            select(
                func.coalesce(func.max(cast(func.substr(t.reports.c.code, 2), Integer)), 0)
            ).where(t.reports.c.user_id == caller.user_id)
        )
        report = (
            await conn.execute(
                t.reports.insert()
                .values(
                    user_id=caller.user_id,
                    code=f"R{n + 1}",
                    title=title,
                    type=type_,
                    project_ids=projects,
                    market_ids=markets,
                    agent_id=caller.agent_id,
                )
                .returning(*t.reports.c)
            )
        ).one()
    a = t.report_attempts
    if await conn.scalar(select(a.c.id).where(a.c.report_id == report.id, a.c.state == "running")):
        raise ApiError(409, "job_running", f"Báo cáo {report.code} đang được tạo.")
    attempt_id = await conn.scalar(
        a.insert()
        .values(
            report_id=report.id,
            agent_id=caller.agent_id,
            task_id=caller.task_id,
            state="running",
        )
        .returning(a.c.id)
    )
    publish_update(h, conn, caller.user_id, {"reportId": report.code, "status": "generating"})
    return {"report_id": report.code, "attempt_id": str(attempt_id)}


async def publish(
    h: Any,
    conn: AsyncConnection,
    caller: Any,
    *,
    attempt_id: str,
    schema_path: str,
    artifacts: list[str],
    evidence: list[Any],
    source: Any,
) -> str:
    attempt = await _attempt_for_user(conn, caller.user_id, attempt_id)
    if attempt.state != "running":
        raise ApiError(409, "attempt_ended", "Lần tạo báo cáo này đã kết thúc.")
    folder = Path(caller.folder)
    (schema_file,) = attachments.from_folder(folder, [schema_path])
    try:
        raw = json.loads(schema_file.source.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise _invalid(f"{schema_path} is not valid JSON: {e}") from None
    files = attachments.from_folder(folder, artifacts)
    for f in files:
        if Path(f.filename).suffix.lower() not in ARTIFACT_TYPES:
            raise _invalid(f"artifact {f.filename}: only HTML, CSV, DOCX, PDF or XLSX")
    evidence_rows = _evidence(evidence)
    # `completed_at` is the version's instant. The column default is `now()`, which in Postgres is
    # the *transaction* start: it lands before the Python-side `source.dataThrough` used below, and
    # the reader (backend/reports/read.py) then hands the UI a source newer than its own version,
    # which `decodeReportVersion` rejects. Pin both to one Python instant instead.
    completed_at = datetime.now(UTC)
    source_meta = _source(source, caller.slug, completed_at)
    sequence = 1 + await conn.scalar(
        select(func.coalesce(func.max(t.report_versions.c.sequence), 0)).where(
            t.report_versions.c.report_id == attempt.report_id
        )
    )
    vcode = version_code(attempt.code, sequence)
    try:
        schema = validate_schema(
            raw,
            report_id=attempt.code,
            version_id=vcode,
            evidence_ids=[e["id"] for e in evidence_rows],
        )
    except SchemaError as e:
        raise _invalid(str(e)) from None
    revision = hashlib.sha256(
        json.dumps(schema, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:16]
    # `completed_at` is the version's instant. The column default is `now()`, which in Postgres is
    # the *transaction* start: it lands before the Python-side `source.dataThrough` written below,
    # and the reader (backend/reports/read.py) then hands the UI a source newer than its own
    # version, which `decodeReportVersion` rejects. Pin both to one Python instant instead.
    version_id = await conn.scalar(
        t.report_versions.insert()
        .values(
            report_id=attempt.report_id,
            sequence=sequence,
            schema=schema,
            source=source_meta,
            completed_at=completed_at,
            policy_version=POLICY_VERSION,
            content_revision=revision,
            trace_id=caller.trace_id,
        )
        .returning(t.report_versions.c.id)
    )
    directory = Path(h.settings.REPORTS_DIR) / str(version_id)
    directory.mkdir(parents=True, exist_ok=True)
    for f, name in zip(files, attachments.unique_names([f.filename for f in files]), strict=True):
        path = directory / name
        shutil.copyfile(f.source, path)
        data = path.read_bytes()
        await conn.execute(
            t.report_artifacts.insert().values(
                version_id=version_id,
                filename=name,
                mime=ARTIFACT_TYPES[Path(name).suffix.lower()],
                size=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
                path=str(path),
            )
        )
    for e in evidence_rows:
        await conn.execute(t.report_evidence.insert().values(version_id=version_id, **e))
    await conn.execute(
        update(t.report_attempts)
        .where(t.report_attempts.c.id == attempt.id)
        .values(state="succeeded", version_id=version_id, finished_at=func.now())
    )
    await notify(
        conn,
        caller.user_id,
        "report_ready",
        target={"kind": "report", "reportId": attempt.code, "versionId": vcode},
        params={"report": attempt.code, "version": vcode},
        bus=h.bus,
    )
    publish_update(
        h,
        conn,
        caller.user_id,
        {"reportId": attempt.code, "status": "completed", "versionId": vcode},
    )
    return vcode


async def _fail(h: Any, conn: AsyncConnection, attempt: Any, user_id: Any, reason: str) -> None:
    await conn.execute(
        update(t.report_attempts)
        .where(t.report_attempts.c.id == attempt.id)
        .values(state="failed", reason=reason[:1000], finished_at=func.now())
    )
    versions = await conn.scalar(
        select(func.count())
        .select_from(t.report_versions)
        .where(t.report_versions.c.report_id == attempt.report_id)
    )
    await notify(
        conn,
        user_id,
        "report_failed",
        target={"kind": "report", "reportId": attempt.code},
        params={"report": attempt.code},
        bus=h.bus,
    )
    publish_update(
        h, conn, user_id, {"reportId": attempt.code, "status": status_of(versions, "failed")}
    )


async def fail(h: Any, conn: AsyncConnection, caller: Any, *, attempt_id: str, reason: str) -> None:
    attempt = await _attempt_for_user(conn, caller.user_id, attempt_id)
    if attempt.state != "running":
        raise ApiError(409, "attempt_ended", "Lần tạo báo cáo này đã kết thúc.")
    await _fail(h, conn, attempt, caller.user_id, reason)


async def delete(conn: AsyncConnection, user_id: Any, *, report_id: str) -> None:
    """Delete an unpublished report (invariant 8: a published version is immutable, so a report
    that has published one can never be deleted this way)."""
    report = await _report_for_user(conn, user_id, report_id)
    a, v = t.report_attempts, t.report_versions
    if await conn.scalar(select(func.count()).select_from(v).where(v.c.report_id == report.id)):
        raise ApiError(409, "has_published_version", f"Báo cáo {report.code} đã được publish.")
    if await conn.scalar(select(a.c.id).where(a.c.report_id == report.id, a.c.state == "running")):
        raise ApiError(409, "job_running", f"Báo cáo {report.code} đang được tạo.")
    await conn.execute(a.delete().where(a.c.report_id == report.id))
    await conn.execute(t.reports.delete().where(t.reports.c.id == report.id))


async def _running(conn: AsyncConnection, *conditions: Any) -> list[Any]:
    a, r = t.report_attempts, t.reports
    return (
        await conn.execute(
            select(a, r.c.code, r.c.user_id)
            .select_from(a.join(r, a.c.report_id == r.c.id))
            .where(a.c.state == "running", *conditions)
            .with_for_update(of=a, skip_locked=True)
        )
    ).all()


async def fail_attempts_for_task(h: Any, conn: AsyncConnection, task_id: int) -> int:
    """When a global task ends (any status), its running attempts fail with `task_ended`."""
    rows = await _running(conn, t.report_attempts.c.task_id == task_id)
    for row in rows:
        await _fail(h, conn, row, row.user_id, "task_ended")
    return len(rows)


async def fail_stale_attempts(h: Any) -> int:
    """Scheduler hook: attempts started outside a task fail after `TASK_MAX_S`."""
    cutoff = datetime.now(UTC) - timedelta(seconds=h.settings.TASK_MAX_S)
    async with h.db() as conn:
        rows = await _running(
            conn, t.report_attempts.c.task_id.is_(None), t.report_attempts.c.created_at < cutoff
        )
        for row in rows:
            await _fail(h, conn, row, row.user_id, "timeout")
    return len(rows)
