"""`contoso.start_report` / `publish_report` / `fail_report` (doc 19 "Lifecycle")."""

from __future__ import annotations

import hashlib
import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select, update

from backend.api.internal import create_internal_app
from backend.db import tables as t
from backend.harness.tokens import ExecContext, sign
from backend.tests.reports.test_schema import MINIMAL


@pytest.fixture
def internal(make_harness, team, settings, tmp_path):
    settings.REPORTS_DIR = str(tmp_path / "reports")
    h = make_harness()
    h.wake = lambda a: None
    app = create_internal_app(h)

    def call(agent, task_id=None):
        exec_id = f"x_{agent.slug}_{time.monotonic_ns()}"
        h.registry.start(
            ExecContext(
                agent_id=agent.id,
                user_id=team.user,
                slug=agent.slug,
                is_lead=agent.is_lead,
                exec_id=exec_id,
                trace_id="b" * 32,
                activation_kind="message",
                task_id=task_id,
                default_thread=f"direct:{agent.slug}",
                folder=str(h.folder(agent)),
            ),
            now=time.time(),
        )
        token = sign(
            settings.SESSION_SECRET.get_secret_value(), agent.id, exec_id, exp=int(time.time()) + 60
        )
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://internal",
            headers={"Authorization": f"Bearer {token}"},
        )

    call.h = h
    return call


def write(folder: Path, rel: str, data) -> str:
    path = folder / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, bytes):
        path.write_bytes(data)
    else:
        path.write_text(json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data)
    return rel


EVIDENCE = [
    {
        "id": "ev1",
        "label": "Bảng giá",
        "sourceId": "warehouse",
        "projectIds": ["MAS"],
        "snapshotId": "SNAP-20260630-01",
        "dataThrough": "2026-06-30T00:00:00+07:00",
        "limitation": "Chưa có giá chiết khấu",
    }
]


async def start(c, **kw):
    body = {
        "title": "Vì sao MAS-U03832 bán chậm",
        "type": "unit-analysis",
        "projects": ["MAS"],
        **kw,
    }
    r = await c.post("/internal/v1/reports/start", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def test_start_numbers_reports_per_user(conn, team, internal):
    async with internal(team.data) as c:
        first = await start(c)
        await c.post(
            "/internal/v1/reports/fail", json={"attempt_id": first["attempt_id"], "reason": "x"}
        )
        second = await start(c, title="Khác")
    assert (first["report_id"], second["report_id"]) == ("R1", "R2")
    report = (await conn.execute(select(t.reports).where(t.reports.c.code == "R1"))).one()
    assert (report.title, report.type, report.project_ids, report.agent_id) == (
        "Vì sao MAS-U03832 bán chậm",
        "unit-analysis",
        ["MAS"],
        team.data.id,
    )


async def test_start_records_the_running_task_and_reuses_a_report(conn, rows, team, internal):
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    async with internal(team.data, task_id=task) as c:
        first = await start(c)
        r = await c.post(
            "/internal/v1/reports/start",
            json={"title": "x", "type": "unit-analysis", "report_id": first["report_id"]},
        )
        assert (r.status_code, r.json()["error"]) == (409, "job_running")
    attempt = (await conn.execute(select(t.report_attempts))).one()
    assert (attempt.state, attempt.task_id) == ("running", task)


async def test_publish_without_a_source_keeps_the_version_readable(conn, team, internal):
    """The default `source` must not land after the version's own instant.

    `decodeReportVersion` (frontend) rejects a version whose `source.dataThrough` or
    `source.updatedAt` is newer than `completedAt`, and the reports list decodes every row at
    once, so one such version blanks the whole library with "Chưa đọc được báo cáo".
    """
    h = internal.h
    folder = h.folder(team.data)
    async with internal(team.data) as c:
        s = await start(c)
        write(folder, "files/report.json", MINIMAL)
        r = await c.post(
            "/internal/v1/reports/publish",
            json={
                "attempt_id": s["attempt_id"],
                "schema_path": "files/report.json",
                "artifacts": [],
                "evidence": EVIDENCE,
            },
        )
    assert r.status_code == 200, r.text
    version = (await conn.execute(select(t.report_versions))).one()
    source = version.source
    assert source["id"] == "agent:data" and source["completeness"] == "partial"
    assert datetime.fromisoformat(source["dataThrough"]) <= version.completed_at
    # the reader echoes `updatedAt` from `completed_at`; both must stay inside the version.
    assert source["dataThrough"] <= version.completed_at.isoformat()


async def test_publish_stores_an_immutable_version(conn, team, internal):
    h = internal.h
    folder = h.folder(team.data)
    events = h.bus.subscribe(team.user)
    async with internal(team.data) as c:
        s = await start(c)
        write(folder, "files/report.json", MINIMAL)
        write(folder, "files/report.pdf", b"%PDF-1.7 report")
        write(folder, "files/data.csv", "a,b\n1,2\n")
        r = await c.post(
            "/internal/v1/reports/publish",
            json={
                "attempt_id": s["attempt_id"],
                "schema_path": "files/report.json",
                "artifacts": ["files/report.pdf", "files/data.csv"],
                "evidence": EVIDENCE,
                "source": {
                    "id": "warehouse",
                    "label": "Kho cdw",
                    "dataThrough": "2026-06-30T00:00:00+07:00",
                    "completeness": "full",
                },
            },
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"version_id": "R1-v1"}
    version = (await conn.execute(select(t.report_versions))).one()
    assert version.sequence == 1 and version.schema["reportId"] == "R1"
    assert version.schema["versionId"] == "R1-v1" and version.trace_id == "b" * 32
    assert version.source["completeness"] == "full"
    # The reader echoes `source` and `completed_at` straight to the UI, whose decoder rejects a
    # version whose source is *newer* than the version itself. Publish stamps one instant for both.
    assert version.completed_at is not None
    assert datetime.fromisoformat(version.source["dataThrough"]) <= version.completed_at
    attempt = (await conn.execute(select(t.report_attempts))).one()
    assert (attempt.state, attempt.version_id) == ("succeeded", version.id)
    arts = {a.filename: a for a in (await conn.execute(select(t.report_artifacts))).all()}
    assert set(arts) == {"report.pdf", "data.csv"}
    pdf = arts["report.pdf"]
    assert pdf.mime == "application/pdf"
    assert Path(pdf.path) == Path(h.settings.REPORTS_DIR) / str(version.id) / "report.pdf"
    assert pdf.sha256 == hashlib.sha256(b"%PDF-1.7 report").hexdigest()
    ev = (await conn.execute(select(t.report_evidence))).one()
    assert (ev.id, ev.snapshot_id, ev.project_ids) == ("ev1", "SNAP-20260630-01", ["MAS"])
    note = (
        await conn.execute(
            select(t.user_notifications).where(t.user_notifications.c.kind == "report-ready")
        )
    ).one()
    assert note.target == {"kind": "report", "reportId": "R1", "versionId": "R1-v1"}
    types = []
    while not events.empty():
        types.append(events.get_nowait())
    assert {
        "type": "report.updated",
        "data": {"reportId": "R1", "status": "completed", "versionId": "R1-v1"},
    } in types
    assert any(e["type"] == "notification.created" for e in types)
    # immutable afterwards (invariant 8)
    from sqlalchemy.exc import DBAPIError

    with pytest.raises(DBAPIError):
        async with conn.begin_nested():
            await conn.execute(update(t.report_versions).values(policy_version="x"))


async def test_a_second_publish_is_a_new_version(conn, team, internal):
    folder = internal.h.folder(team.data)
    write(folder, "files/report.json", MINIMAL)
    async with internal(team.data) as c:
        s1 = await start(c)
        await c.post(
            "/internal/v1/reports/publish",
            json={"attempt_id": s1["attempt_id"], "schema_path": "files/report.json"},
        )
        s2 = await start(c, report_id="R1")
        r = await c.post(
            "/internal/v1/reports/publish",
            json={"attempt_id": s2["attempt_id"], "schema_path": "files/report.json"},
        )
    assert r.json() == {"version_id": "R1-v2"}
    assert await conn.scalar(select(func.count()).select_from(t.report_versions)) == 2


@pytest.mark.parametrize(
    "schema,artifacts,code",
    [
        ({**MINIMAL, "schemaVersion": 2}, [], "invalid_report"),
        (
            {
                **MINIMAL,
                "sections": [
                    {
                        "id": "x",
                        "kind": "text",
                        "title": "t",
                        "evidenceIds": ["missing"],
                        "markdown": "m",
                    }
                ],
            },
            [],
            "invalid_report",
        ),
        (MINIMAL, ["files/run.sh"], "invalid_report"),
        (MINIMAL, ["files/nope.pdf"], "invalid_file"),
    ],
)
async def test_invalid_publish_keeps_the_attempt_running(
    conn, team, internal, schema, artifacts, code
):
    folder = internal.h.folder(team.data)
    write(folder, "files/report.json", schema)
    write(folder, "files/run.sh", "echo")
    async with internal(team.data) as c:
        s = await start(c)
        r = await c.post(
            "/internal/v1/reports/publish",
            json={
                "attempt_id": s["attempt_id"],
                "schema_path": "files/report.json",
                "artifacts": artifacts,
            },
        )
    assert (r.status_code, r.json()["error"]) == (400, code), r.text
    assert await conn.scalar(select(t.report_attempts.c.state)) == "running"
    assert await conn.scalar(select(func.count()).select_from(t.report_versions)) == 0


async def test_evidence_from_the_future_is_refused(team, internal):
    folder = internal.h.folder(team.data)
    write(folder, "files/report.json", MINIMAL)
    future = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    async with internal(team.data) as c:
        s = await start(c)
        r = await c.post(
            "/internal/v1/reports/publish",
            json={
                "attempt_id": s["attempt_id"],
                "schema_path": "files/report.json",
                "evidence": [{**EVIDENCE[0], "dataThrough": future}],
            },
        )
    assert r.json()["error"] == "invalid_report" and "dataThrough" in r.json()["message"]


async def test_fail_report_notifies(conn, team, internal):
    async with internal(team.data) as c:
        s = await start(c)
        r = await c.post(
            "/internal/v1/reports/fail",
            json={"attempt_id": s["attempt_id"], "reason": "thiếu dữ liệu"},
        )
        assert r.status_code == 204
        r = await c.post(
            "/internal/v1/reports/fail", json={"attempt_id": s["attempt_id"], "reason": "again"}
        )
        assert (r.status_code, r.json()["error"]) == (409, "attempt_ended")
    attempt = (await conn.execute(select(t.report_attempts))).one()
    assert (attempt.state, attempt.reason) == ("failed", "thiếu dữ liệu")
    note = (await conn.execute(select(t.user_notifications))).one()
    assert note.kind == "task-failed" and note.target == {"kind": "report", "reportId": "R1"}


async def test_other_users_attempts_are_404(rows, team, internal):
    other = await rows.user(username="bob")
    other_agent = await rows.agent(other, slug="data")
    report = await rows.insert(
        t.reports, user_id=other, code="R1", title="x", type="x", agent_id=other_agent
    )
    attempt = await rows.insert(
        t.report_attempts, report_id=report, agent_id=other_agent, state="running"
    )
    async with internal(team.data) as c:
        r = await c.post(
            "/internal/v1/reports/fail", json={"attempt_id": str(attempt), "reason": "x"}
        )
        assert r.status_code == 404
        r = await c.post(
            "/internal/v1/reports/start", json={"title": "x", "type": "x", "report_id": "R1"}
        )
        assert r.status_code == 404


async def test_attempts_end_with_their_task_or_time_out(conn, rows, team, internal):
    from backend.harness.queue import end_by
    from backend.reports.service import fail_stale_attempts

    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    async with internal(team.data, task_id=task) as c:
        await start(c)
    async with internal(team.data) as c:
        await start(c, title="ngoài task")
    h = internal.h
    async with h.db() as c:
        row = (await c.execute(select(t.global_tasks).where(t.global_tasks.c.id == task))).one()
        await end_by(
            h,
            c,
            row,
            status="done",
            ended_by="lead",
            outcome="ok",
            notice_kind=None,
            notice_text=None,
        )
    states = dict(
        (await conn.execute(select(t.report_attempts.c.task_id, t.report_attempts.c.reason))).all()
    )
    assert states[task] == "task_ended"
    assert states[None] is None
    await conn.execute(
        update(t.report_attempts)
        .where(t.report_attempts.c.task_id.is_(None))
        .values(created_at=datetime.now(UTC) - timedelta(hours=2))
    )
    h.settings.TASK_MAX_S = 3600
    await fail_stale_attempts(h)
    reasons = (await conn.execute(select(t.report_attempts.c.reason))).scalars().all()
    assert sorted(reasons) == ["task_ended", "timeout"]
