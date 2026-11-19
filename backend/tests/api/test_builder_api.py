"""The builder (doc 05) and its jobs: `/api/agents` create/reset, prompt, skills, packages,
routines, credentials, `/api/jobs/{id}`."""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import tomllib
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from sqlalchemy import func, select

from backend.catalog import seeds
from backend.db import tables as t
from backend.execd_client import ExecResult
from backend.harness.runtime import Harness

REPO = Path(__file__).resolve().parents[3]


def git(folder, *args):
    return subprocess.run(
        ["git", *args], cwd=folder, capture_output=True, text=True, check=True
    ).stdout.strip()


class FakeExecd:
    """Pretends to be uv and contoso.skills, then snapshots like execd."""

    def __init__(self):
        self.calls = []
        self.fail = False

    async def exec(
        self, *, folder, exec_id, timeout_s, author, code=None, argv=None, env_extra=None
    ):
        self.calls.append({"argv": argv, "author": author, "env_extra": env_extra or {}})
        path = Path(folder)
        stdout, exit_code = "", 0
        if self.fail:
            return ExecResult(
                exit_code=1,
                stdout="",
                stderr="error: resolution failed\n" * 3,
                duration_ms=1,
                timed_out=False,
                truncated=False,
                head=None,
                changed=[],
                snapshot_error=None,
            )
        pyproject = path / "pyproject.toml"
        if argv[:2] == ["uv", "add"]:
            data = tomllib.loads(pyproject.read_text())
            deps = data["project"]["dependencies"] + argv[2:]
            pyproject.write_text(_pyproject(deps))
        elif argv[:2] == ["uv", "remove"]:
            data = tomllib.loads(pyproject.read_text())
            deps = [
                d
                for d in data["project"]["dependencies"]
                if re.split(r"[<>=!~\[ ;]", d)[0] != argv[2]
            ]
            pyproject.write_text(_pyproject(deps))
        elif argv[:3] == ["python", "-m", "contoso.skills"]:
            name = argv[argv.index("--name") + 1] if "--name" in argv else argv[5].split("/")[-1]
            d = path / "skills" / name
            d.mkdir(parents=True, exist_ok=True)
            (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Kỹ năng {name}\n---\n")
            stdout = json.dumps({"installed": f"skills/{name}", "files": 1, "has_code": False})
        git(path, "add", "-A")
        if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=path).returncode:
            git(
                path,
                "-c",
                f"user.name={author}",
                "-c",
                f"user.email={author}@contoso.local",
                "commit",
                "-q",
                "-m",
                f"exec {exec_id}",
            )
        return ExecResult(
            exit_code=exit_code,
            stdout=stdout,
            stderr="",
            duration_ms=1,
            timed_out=False,
            truncated=False,
            head=git(path, "rev-parse", "HEAD"),
            changed=[],
            snapshot_error=None,
        )


def _pyproject(deps):
    lines = ",\n".join(f'    "{d}"' for d in deps)
    return (
        '[project]\nname = "agent"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n'
        f"dependencies = [\n{lines}\n]\n\n[tool.uv]\npackage = false\n"
    )


class FakeSupervisor:
    def __init__(self):
        self.started = []

    def start_agent(self, agent_id, user_id=None):
        self.started.append(agent_id)

    def wake(self, agent_id):
        pass

    async def stop_agent(self, agent_id):
        pass


@pytest.fixture
def domains(tmp_path):
    root = tmp_path / "domains" / "fabrikam"
    cred = root / "credentials"
    cred.mkdir(parents=True)
    (cred / "warehouse.env.example").write_text("# description: Kho\nWAREHOUSE_DSN=\n")
    (cred / "warehouse.env").write_text("WAREHOUSE_DSN=postgres://secret\n")
    (cred / "web-search.env.example").write_text("TAVILY_API_KEY=\n")
    (cred / "web-search.env").write_text("TAVILY_API_KEY=test-search-key\n")
    starter = root / "starters" / "data"
    starter.mkdir(parents=True)
    (starter / "agent.yaml").write_text(
        'display_name: Data\navatar: {emoji: "🗄️", color: "#2563EB"}\ndescription: Số liệu\n'
        "presets: [data]\ncredentials: [warehouse]\n"
    )
    (starter / "prompt.md").write_text("Bạn là Data.\n")
    return tmp_path / "domains"


@pytest.fixture
def app(make_app, conn, tmp_path, domains):
    app = make_app(
        FOLDERS_DIR=str(tmp_path / "folders"),
        DOMAINS_DIR=str(domains),
        PLATFORM_DIR=str(REPO / "platform"),
        ATTACHMENTS_DIR=str(tmp_path / "att"),
    )
    lock = asyncio.Lock()

    @asynccontextmanager
    async def provider():
        async with lock, conn.begin_nested():
            yield conn

    h = Harness(app.state.settings, db=provider, execd=FakeExecd(), model=None)
    h.supervisor = FakeSupervisor()
    h.woken = []
    h.wake = h.woken.append
    app.state.harness = h
    return app


@pytest.fixture
async def alice(accounts, conn, app):
    user = await accounts.user("alice", domain="fabrikam")
    await seeds.upsert_catalogs(conn, app.state.settings, available=[])
    seeds.STATUS.marketplace = True
    return user


async def create(c, app, **body):
    payload = {
        "slug": "data",
        "display_name": "Data",
        "avatar": {"emoji": "🗄️", "color": "#2563EB"},
        "description": "Số liệu",
        **body,
    }
    r = await c.post("/api/agents", json=payload)
    assert r.status_code == 202, r.text
    await app.state.harness.jobs.run_pending()
    job = (await c.get(f"/api/jobs/{r.json()['job_id']}")).json()
    return job


async def agent_id(conn, slug="data"):
    return await conn.scalar(select(t.agents.c.id).where(t.agents.c.slug == slug))


def folder_of(app, user, slug="data"):
    return Path(app.state.settings.FOLDERS_DIR) / str(user) / slug


async def notices(conn, agent):
    return [
        r.notice["text"]
        for r in (
            await conn.execute(
                select(t.deliveries)
                .where(t.deliveries.c.agent_id == agent)
                .order_by(t.deliveries.c.id)
            )
        ).all()
    ]


# --- creating -----------------------------------------------------------------------------


async def test_create_a_custom_agent(app, accounts, alice, conn):
    h = app.state.harness
    events = h.bus.subscribe(alice)
    async with await accounts.login("alice") as c:
        job = await create(c, app, presets=["data"], credentials=["warehouse"])
    assert job["status"] == "done" and job["kind"] == "agent_create", job
    aid = await agent_id(conn)
    row = (await conn.execute(select(t.agents).where(t.agents.c.id == aid))).one()
    assert (row.origin, row.display_name, row.description) == ("custom", "Data", "Số liệu")
    folder = folder_of(app, alice)
    assert (folder / ".env.d" / "warehouse.env").is_file()
    argvs = [c["argv"] for c in h.execd.calls]
    assert argvs[0] == ["uv", "sync"] and argvs[1][:2] == ["uv", "add"]
    assert "pandas>=2.2" in argvs[1]
    assert {c["author"] for c in h.execd.calls} == {"contoso-harness"}  # creation (doc 04)
    assert h.supervisor.started == [aid]
    statuses = []
    while not events.empty():
        e = events.get_nowait()
        if e["type"] == "builder.job":
            statuses.append(e["data"]["status"])
    assert statuses[-2:] == ["running", "done"]


async def test_create_from_a_starter(app, accounts, alice, conn):
    async with await accounts.login("alice") as c:
        job = await create(c, app, starter="data", slug="data2")
    assert job["status"] == "done", job
    row = (await conn.execute(select(t.agents).where(t.agents.c.slug == "data2"))).one()
    assert row.origin == "starter"
    folder = folder_of(app, alice, "data2")
    assert (folder / "prompts" / "system.md").read_text() == "Bạn là Data.\n"
    assert (folder / ".env.d" / "warehouse.env").is_file()


async def test_create_validation(app, accounts, alice, rows):
    async with await accounts.login("alice") as c:
        r = await c.post(
            "/api/agents",
            json={"slug": "Bad!", "display_name": "x", "avatar": {"emoji": "x", "color": "#000"}},
        )
        assert (r.status_code, r.json()["error"]) == (400, "invalid_slug")
        await rows.agent(alice, slug="taken")
        r = await c.post(
            "/api/agents",
            json={"slug": "taken", "display_name": "x", "avatar": {"emoji": "x", "color": "#000"}},
        )
        assert (r.status_code, r.json()["error"]) == (409, "slug_taken")
        ok = {"slug": "fresh", "display_name": "x", "avatar": {"emoji": "x", "color": "#000"}}
        assert (await c.post("/api/agents", json=ok)).status_code == 202
        r = await c.post("/api/agents", json=ok)
        assert (r.status_code, r.json()["error"]) == (409, "job_running")
        r = await c.post("/api/agents", json={**ok, "slug": "other", "starter": "nope"})
        assert r.status_code == 400
        r = await c.post("/api/agents", json={**ok, "slug": "other2", "presets": ["nope"]})
        assert r.status_code == 400


async def test_a_failed_job_keeps_the_last_output(app, accounts, alice, conn):
    app.state.harness.execd.fail = True
    async with await accounts.login("alice") as c:
        job = await create(c, app)
    assert job["status"] == "failed" and "resolution failed" in job["output"]
    assert len(job["output"]) <= 4096 and job["finished_at"]
    assert await agent_id(conn) is None


# --- prompt -------------------------------------------------------------------------------


async def test_prompt_edit_commits_notifies_and_makes_compaction_pending(
    app, accounts, alice, conn
):
    async with await accounts.login("alice") as c:
        await create(c, app)
        aid = await agent_id(conn)
        r = await c.put(f"/api/agents/{aid}/prompt", json={"text": "Bạn là Data mới.\n"})
        assert r.status_code == 200
        assert r.json()["text"] == "Bạn là Data mới.\n" and len(r.json()["commit"]) == 40
        assert (await c.get(f"/api/agents/{aid}/prompt")).json()["text"] == "Bạn là Data mới.\n"
    folder = folder_of(app, alice)
    assert git(folder, "log", "-1", "--format=%an") == "user:alice"
    texts = await notices(conn, aid)
    assert texts[-1].startswith("Người dùng đã cập nhật vai trò của bạn:\n")
    assert "+Bạn là Data mới." in texts[-1]
    assert (
        await conn.scalar(select(t.agents.c.compaction_pending).where(t.agents.c.id == aid)) is True
    )
    assert aid in app.state.harness.woken


# --- skills -------------------------------------------------------------------------------


async def test_install_and_remove_a_catalog_skill(app, accounts, alice, conn):
    h = app.state.harness
    async with await accounts.login("alice") as c:
        await create(c, app)
        aid = await agent_id(conn)
        r = await c.post(f"/api/agents/{aid}/skills", json={"catalog_id": "xlsx"})
        assert r.status_code == 202
        await h.jobs.run_pending()
        call = h.execd.calls[-1]
        assert call["argv"][:5] == [
            "python",
            "-m",
            "contoso.skills",
            "install",
            "anthropics/skills",
        ]
        assert call["argv"][-2:] == ["--name", "xlsx"] and call["author"] == "user:alice"
        assert call["env_extra"]["CONTOSO_SKILLS_CODELOAD_URL"] == h.settings.SKILLS_CODELOAD_URL
        skills = (await c.get(f"/api/agents/{aid}/skills")).json()
        assert skills == [
            {
                "name": "xlsx",
                "description": "Kỹ năng xlsx",
                "catalog_id": "xlsx",
                "commit_author": "user:alice",
            }
        ]
        r = await c.delete(f"/api/agents/{aid}/skills/xlsx")
        assert r.status_code == 202
        await h.jobs.run_pending()
        assert (await c.get(f"/api/agents/{aid}/skills")).json() == []
    texts = await notices(conn, aid)
    assert "Kỹ năng mới: xlsx — đọc skills/xlsx/SKILL.md" in texts
    assert "Đã gỡ kỹ năng: xlsx" in texts
    assert git(folder_of(app, alice), "log", "-1", "--format=%an") == "user:alice"


async def test_install_from_a_github_link(app, accounts, alice, conn):
    h = app.state.harness
    sha = "a" * 40
    async with await accounts.login("alice") as c:
        await create(c, app)
        aid = await agent_id(conn)
        r = await c.post(
            f"/api/agents/{aid}/skills",
            json={"url": f"https://github.com/o/r/tree/{sha}/skills/foo"},
        )
        assert r.status_code == 202
        await h.jobs.run_pending()
        assert h.execd.calls[-1]["argv"] == [
            "python",
            "-m",
            "contoso.skills",
            "install",
            "o/r",
            "skills/foo",
            "--ref",
            sha,
        ]
        r = await c.post(f"/api/agents/{aid}/skills", json={"url": "https://example.com/x"})
        assert (r.status_code, r.json()["error"]) == (400, "invalid_request")
        r = await c.post(f"/api/agents/{aid}/skills", json={"catalog_id": "nope"})
        assert r.status_code == 404


# --- packages -----------------------------------------------------------------------------


async def test_presets_and_packages(app, accounts, alice, conn):
    h = app.state.harness
    async with await accounts.login("alice") as c:
        await create(c, app)
        aid = await agent_id(conn)
        assert (
            await c.post(f"/api/agents/{aid}/packages", json={"preset_id": "charts"})
        ).status_code == 202
        await h.jobs.run_pending()
        assert (
            await c.post(f"/api/agents/{aid}/packages", json={"package": "httpx>=0.27"})
        ).status_code == 202
        await h.jobs.run_pending()
        r = await c.post(f"/api/agents/{aid}/packages", json={"package": "not a spec!!"})
        assert (r.status_code, r.json()["error"]) == (400, "invalid_package")
        packages = (await c.get(f"/api/agents/{aid}/packages")).json()
        assert {"name": "httpx", "spec": "httpx>=0.27"} in packages
        assert {p["name"] for p in packages} == {"matplotlib", "seaborn", "httpx"}
        assert (await c.delete(f"/api/agents/{aid}/packages/seaborn")).status_code == 202
        await h.jobs.run_pending()
        assert {p["name"] for p in (await c.get(f"/api/agents/{aid}/packages")).json()} == {
            "matplotlib",
            "httpx",
        }
    texts = await notices(conn, aid)
    assert "Thư viện đã thay đổi: +matplotlib, +seaborn" in texts
    assert "Thư viện đã thay đổi: +httpx" in texts
    assert "Thư viện đã thay đổi: -seaborn" in texts
    assert h.execd.calls[-1]["argv"] == ["uv", "remove", "seaborn"]


# --- routines -----------------------------------------------------------------------------


async def test_routines(app, accounts, alice, conn):
    async with await accounts.login("alice") as c:
        await create(c, app)
        aid = await agent_id(conn)
        body = {"prompt": "Tóm tắt buổi sáng", "cron": "0 8 * * 1-5", "enabled": True}
        r = await c.put(f"/api/agents/{aid}/routines/bao-cao-sang", json=body)
        assert r.status_code == 200, r.text
        routine = r.json()
        assert (routine["name"], routine["cron"], routine["enabled"]) == (
            "bao-cao-sang",
            "0 8 * * 1-5",
            True,
        )
        assert len(routine["next_fires"]) == 3
        assert (
            await c.put(f"/api/agents/{aid}/routines/bao-cao-sang", json={**body, "cron": "bad"})
        ).json()["error"] == "invalid_cron"
        assert (await c.put(f"/api/agents/{aid}/routines/Bad_Name", json=body)).status_code == 400
        listing = (await c.get(f"/api/agents/{aid}/routines")).json()
        assert [x["name"] for x in listing] == ["bao-cao-sang"]
        assert listing[0]["last_started_at"] is None
        assert (await c.delete(f"/api/agents/{aid}/routines/bao-cao-sang")).status_code == 204
        assert (await c.get(f"/api/agents/{aid}/routines")).json() == []
    texts = await notices(conn, aid)
    assert 'Lịch "bao-cao-sang" đã được tạo: 0 8 * * 1-5' in texts
    assert 'Lịch "bao-cao-sang" đã được xóa: 0 8 * * 1-5' in texts
    assert await conn.scalar(select(func.count()).select_from(t.routine_state)) == 0
    folder = folder_of(app, alice)
    assert not (folder / "routines" / "bao-cao-sang.yaml").exists()
    assert git(folder, "log", "-1", "--format=%an") == "user:alice"


# --- credential sets ----------------------------------------------------------------------


async def test_credential_sets(app, accounts, alice, conn):
    async with await accounts.login("alice") as c:
        await create(c, app)
        aid = await agent_id(conn)
        r = await c.put(
            f"/api/agents/{aid}/credentials", json={"sets": ["warehouse", "web-search"]}
        )
        assert r.json() == [
            {"set": "warehouse", "keys": ["WAREHOUSE_DSN"]},
            {"set": "web-search", "keys": ["TAVILY_API_KEY"]},
        ]
        r = await c.put(f"/api/agents/{aid}/credentials", json={"sets": ["web-search"]})
        assert [s["set"] for s in r.json()] == ["web-search"]
        assert (
            await c.put(f"/api/agents/{aid}/credentials", json={"sets": ["nope"]})
        ).status_code == 400
        assert [s["set"] for s in (await c.get(f"/api/agents/{aid}/credentials")).json()] == [
            "web-search"
        ]
    folder = folder_of(app, alice)
    assert sorted(os.listdir(folder / ".env.d")) == ["web-search.env", "web-search.env.keys"]
    texts = await notices(conn, aid)
    assert (
        "Quyền dữ liệu thay đổi: +warehouse (WAREHOUSE_DSN), +web-search (TAVILY_API_KEY)" in texts
    )
    assert "Quyền dữ liệu thay đổi: -warehouse (WAREHOUSE_DSN)" in texts
    assert all("secret" not in x for x in texts)


# --- reset, ownership ---------------------------------------------------------------------


async def test_reset_job_and_its_guard(app, accounts, alice, conn, rows):
    h = app.state.harness
    async with await accounts.login("alice") as c:
        await create(c, app)
        aid = await agent_id(conn)
        folder = folder_of(app, alice)
        (folder / "memory" / "index.md").write_text("changed")
        r = await c.post(f"/api/agents/{aid}/reset")
        assert r.status_code == 202
        await h.jobs.run_pending()
        assert (folder / "memory" / "index.md").read_text() == "# Memory\n\n(no notes yet)\n"
        task = await rows.insert(
            t.global_tasks, user_id=alice, description="x", status="running", started_at=func.now()
        )
        await rows.insert(t.task_involvement, task_id=task, agent_id=aid)
        r = await c.post(f"/api/agents/{aid}/reset")
        assert (r.status_code, r.json()["error"]) == (409, "agent_busy_in_task")


async def test_other_users_and_admins(app, accounts, alice, conn):
    await accounts.user("bob", domain="fabrikam")
    await accounts.admin()
    async with await accounts.login("alice") as c:
        job = await create(c, app)
    aid = await agent_id(conn)
    async with await accounts.login("bob") as c:
        assert (await c.get(f"/api/agents/{aid}/prompt")).status_code == 404
        assert (await c.get(f"/api/jobs/{job['id']}")).status_code == 404
    async with await accounts.login("admin") as c:
        assert (await c.put(f"/api/agents/{aid}/prompt", json={"text": "x"})).status_code == 403
