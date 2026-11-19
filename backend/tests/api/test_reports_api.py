"""`/api/reports*` (doc 15 "Reports", doc 19 "Reading"): frontend contract shapes."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from backend.db import tables as t


def at(day: str, hour: int = 3) -> datetime:
    return datetime.fromisoformat(f"{day}T{hour:02d}:00:00+00:00")


@pytest.fixture
async def library(accounts, rows, conn, tmp_path):
    alice = await accounts.user("alice", display_name="Alice Nguyễn")
    data = await rows.agent(alice, slug="data")
    report = await rows.agent(alice, slug="report")

    async def make(
        code,
        title,
        *,
        agent,
        created,
        projects=(),
        versions=(),
        attempt=None,
        type_="unit-analysis",
    ):
        rid = await rows.insert(
            t.reports,
            user_id=alice,
            code=code,
            title=title,
            type=type_,
            project_ids=list(projects),
            market_ids=["hn"],
            agent_id=agent,
            created_at=at(created),
        )
        vids = []
        for seq, done in enumerate(versions, 1):
            vid = await rows.insert(
                t.report_versions,
                report_id=rid,
                sequence=seq,
                schema={
                    "schemaVersion": 1,
                    "reportId": code,
                    "versionId": f"{code}-v{seq}",
                    "reportTypeId": type_,
                    "title": title,
                    "limitations": [],
                    "dashboard": [],
                    "sections": [],
                    "diagnostics": [],
                },
                source={
                    "id": "warehouse",
                    "label": "Kho",
                    "dataThrough": "2026-06-30T00:00:00Z",
                    "completeness": "full",
                },
                policy_version="p1",
                content_revision="c1",
                trace_id="0" * 32,
                completed_at=at(done),
            )
            vids.append(vid)
        if attempt:
            await rows.insert(
                t.report_attempts,
                report_id=rid,
                agent_id=agent,
                state=attempt,
                created_at=at(created, 5),
            )
        return rid, vids

    _r1, (_v1, v2) = await make(
        "R1",
        "Phân tích căn MAS-U03832",
        agent=report,
        created="2026-08-01",
        projects=["MAS"],
        versions=["2026-08-10", "2026-09-05"],
        attempt="succeeded",
    )
    await make(
        "R2",
        "Báo cáo tuần",
        agent=report,
        created="2026-09-10",
        attempt="running",
        projects=["OCP"],
    )
    await make("R3", "So sánh giá", agent=data, created="2026-09-12", attempt="failed")
    await make("R4", "Nháp", agent=data, created="2026-09-15", type_="draft-note")
    art = tmp_path / "r1.pdf"
    art.write_bytes(b"%PDF")
    aid = await rows.insert(
        t.report_artifacts,
        version_id=v2,
        filename="r1.pdf",
        mime="application/pdf",
        size=4,
        sha256="a" * 64,
        path=str(art),
    )
    await rows.insert(
        t.report_evidence,
        version_id=v2,
        id="ev1",
        label="Bảng giá",
        source_id="warehouse",
        project_ids=["MAS"],
        snapshot_id="S1",
        data_through=at("2026-06-30"),
        limitation="",
    )
    return {"alice": alice, "artifact": aid}


async def get(accounts, path, **params):
    async with await accounts.login("alice") as c:
        r = await c.get(path, params=params)
    return r


async def test_list_shapes_and_status(accounts, library):
    r = await get(accounts, "/api/reports")
    assert r.status_code == 200, r.text
    page = r.json()
    assert (page["totalRows"], page["page"], page["pageSize"], page["pageCount"]) == (4, 1, 25, 1)
    codes = [row["record"]["code"] for row in page["rows"]]
    assert codes == ["R4", "R3", "R2", "R1"]  # createdAt desc
    status = {row["record"]["id"]: row["status"] for row in page["rows"]}
    assert status == {"R1": "completed", "R2": "generating", "R3": "failed", "R4": "draft"}
    r1 = page["rows"][-1]
    rec = r1["record"]
    assert rec["versionIds"] == ["R1-v2", "R1-v1"] and rec["agent"] == "report"
    assert rec["author"] == {"id": str(library["alice"]), "name": "Alice Nguyễn"}
    assert rec["projectIds"] == ["MAS"] and rec["marketIds"] == ["hn"]
    v = r1["latestVersion"]
    assert v["id"] == "R1-v2" and v["reportId"] == "R1" and v["sequence"] == 2
    assert v["sections"] == [] and v["schema"]["versionId"] == "R1-v2"
    assert v["source"]["mode"] == "api" and v["source"]["updatedAt"] == v["completedAt"]
    assert v["evidenceIds"] == ["ev1"] and len(v["artifactIds"]) == 1
    assert r1["latestAttempt"]["state"] == "succeeded"


async def test_search_filters_sort_and_pages(accounts, library):
    q = lambda **p: get(accounts, "/api/reports", **p)  # noqa: E731
    assert [x["record"]["code"] for x in (await q(q="PHÂN TICH CĂN")).json()["rows"]] == [
        "R1"
    ]  # accents and case ignored
    async with await accounts.login("alice") as c:
        r = await c.get("/api/reports", params=[("status", "failed"), ("status", "draft")])
        assert {x["record"]["code"] for x in r.json()["rows"]} == {"R3", "R4"}
        r = await c.get("/api/reports", params=[("agent", "data")])
        assert {x["record"]["code"] for x in r.json()["rows"]} == {"R3", "R4"}
    assert [x["record"]["code"] for x in (await q(project="OCP")).json()["rows"]] == ["R2"]
    r = await q(
        dateField="completedAt",
        **{"from": "2026-08-01", "to": "2026-09-01", "timezone": "Asia/Ho_Chi_Minh"},
    )
    rows = r.json()["rows"]
    assert [x["record"]["code"] for x in rows] == ["R1"]
    assert rows[0]["matchedVersion"]["id"] == "R1-v1"  # the version completed in the period
    titles = [x["record"]["title"] for x in (await q(sort="title", direction="asc")).json()["rows"]]
    assert titles == ["Báo cáo tuần", "Nháp", "Phân tích căn MAS-U03832", "So sánh giá"]
    assert (await q(pageSize=30)).status_code == 400
    assert (await q(timezone="Mars/Base")).status_code == 400
    assert (await q(q="x" * 501)).status_code == 400
    assert (await q(page=9)).json()["page"] == 1  # clamped like the mock


async def test_detail_versions_evidence_and_artifacts(accounts, library):
    r = await get(accounts, "/api/reports/R1")
    body = r.json()
    assert body["version"]["id"] == "R1-v2"
    assert [v["id"] for v in body["versions"]] == ["R1-v2", "R1-v1"]
    assert body["evidence"] == [
        {
            "id": "ev1",
            "sourceId": "warehouse",
            "label": "Bảng giá",
            "projectIds": ["MAS"],
            "snapshotId": "S1",
            "dataThrough": "2026-06-30T03:00:00+00:00",
            "limitation": "",
        }
    ]
    assert body["artifacts"] == [
        {
            "id": str(library["artifact"]),
            "versionId": "R1-v2",
            "filename": "r1.pdf",
            "mediaType": "application/pdf",
        }
    ]
    assert body["summary"]["status"] == "completed"
    old = (await get(accounts, "/api/reports/R1", version="R1-v1")).json()
    assert old["version"]["id"] == "R1-v1" and old["artifacts"] == [] and old["evidence"] == []
    assert (await get(accounts, "/api/reports/R1", version="R1-v9")).status_code == 404
    assert (await get(accounts, "/api/reports/R9")).status_code == 404
    draft = (await get(accounts, "/api/reports/R4")).json()
    assert draft["version"] is None and draft["versions"] == []
    r = await get(accounts, f"/api/reports/R1/versions/R1-v2/artifacts/{library['artifact']}")
    assert r.status_code == 200 and r.content == b"%PDF"
    assert "attachment" in r.headers["content-disposition"]
    r = await get(accounts, f"/api/reports/R1/versions/R1-v1/artifacts/{library['artifact']}")
    assert r.status_code == 404


async def test_summary_recent_and_catalog(accounts, library):
    scope = {"from": "2026-08-01", "to": "2026-10-01", "timezone": "Asia/Ho_Chi_Minh"}
    s = (await get(accounts, "/api/reports/summary", **scope)).json()
    assert (s["distinctReports"], s["completedVersions"]) == (1, 2)
    assert s["source"]["mode"] == "api"
    recent = (await get(accounts, "/api/reports/recent", limit=5, **scope)).json()
    assert [x["record"]["code"] for x in recent] == ["R1"]
    assert (await get(accounts, "/api/reports/recent", limit=21, **scope)).status_code == 400
    cat = (await get(accounts, "/api/reports/catalog")).json()
    assert {x["id"] for x in cat["reportTypes"]} == {"unit-analysis", "draft-note"}
    assert {p["id"] for p in cat["projects"]} == {"MAS", "OCP"}
    assert cat["authors"] == [{"id": str(library["alice"]), "name": "Alice Nguyễn"}]
    assert cat["agents"] == ["data", "report"]
    scope = cat["defaultScope"]
    assert scope["timezone"] == "Asia/Ho_Chi_Minh" and scope["from"] < scope["to"]


async def test_reports_are_owner_scoped(accounts, library):
    await accounts.user("bob")
    async with await accounts.login("bob") as c:
        assert (await c.get("/api/reports")).json()["totalRows"] == 0
        assert (await c.get("/api/reports/R1")).status_code == 404
    await accounts.admin()
    async with await accounts.login("admin") as c:
        assert (await c.get("/api/reports")).status_code == 403


def test_fold_matches_the_frontend():
    from backend.reports.read import fold

    assert fold("  Phân   TÍCH Đất ") == "phan tich dat"
    assert Path  # keep the import used
    assert datetime.now(UTC)


# --- deleting an unpublished report (merged from Agent-A-ThanhTung) -------------------------


async def _delete(accounts, user, code):
    async with await accounts.login(user) as c:
        return await c.delete(f"/api/reports/{code}")


async def _codes(conn):
    from sqlalchemy import select

    return set((await conn.execute(select(t.reports.c.code))).scalars().all())


async def test_unpublished_reports_can_be_deleted(accounts, library, conn):
    assert (await _delete(accounts, "alice", "R3")).status_code == 204  # failed attempt
    assert (await _delete(accounts, "alice", "R4")).status_code == 204  # never started
    assert await _codes(conn) == {"R1", "R2"}


async def test_published_or_running_reports_are_kept(accounts, library, conn):
    r = await _delete(accounts, "alice", "R1")
    assert (r.status_code, r.json()["error"]) == (409, "has_published_version")
    r = await _delete(accounts, "alice", "R2")
    assert (r.status_code, r.json()["error"]) == (409, "job_running")
    assert await _codes(conn) == {"R1", "R2", "R3", "R4"}


async def test_another_users_report_cannot_be_deleted(accounts, library, conn):
    await accounts.user("bob")
    assert (await _delete(accounts, "bob", "R3")).status_code == 404
    assert "R3" in await _codes(conn)
