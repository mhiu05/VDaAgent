"""Provisioning a user (doc 12 "Provisioning a user") and the demo users of `make up` (doc 16)."""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import func, select

from backend.db import tables as t
from backend.tests.api.test_builder_api import app, domains  # noqa: F401 (fixtures)


def add_starter(domains_dir: Path, slug: str, presets="[]", creds="[]") -> None:
    d = domains_dir / "fabrikam" / "starters" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "agent.yaml").write_text(
        f'display_name: {slug.title()}\navatar: {{emoji: "x", color: "#000"}}\n'
        f"description: {slug}\npresets: {presets}\ncredentials: {creds}\n"
    )
    (d / "prompt.md").write_text(f"Bạn là {slug}.\n")


async def provision(app, accounts, username="alice"):  # noqa: F811
    from backend.catalog import seeds

    admin = await accounts.admin()
    async with await accounts.login("admin") as c:
        r = await c.post(
            "/api/admin/users",
            json={"username": username, "password": "mật-khẩu-1", "domain_id": "fabrikam"},
        )
        assert r.status_code == 202, r.text
    await seeds.upsert_catalogs(accounts.conn, app.state.settings, available=[])
    await app.state.harness.jobs.run_pending()
    return admin, r.json()


async def test_a_new_user_gets_the_lead_and_every_starter(app, accounts, conn, domains):  # noqa: F811
    add_starter(domains, "chart", presets="[charts]")
    (domains / "fabrikam" / "starters" / "lead").mkdir(parents=True)
    (domains / "fabrikam" / "starters" / "lead" / "prompt.md").write_text("Lead Fabrikam.\n")
    await accounts.rows.domain("fabrikam")
    await provision(app, accounts)
    user = await conn.scalar(select(t.users.c.id).where(t.users.c.username == "alice"))
    status = await conn.scalar(select(t.users.c.status).where(t.users.c.id == user))
    assert status == "active"
    agents = (
        await conn.execute(
            select(t.agents)
            .where(t.agents.c.user_id == user)
            .order_by(t.agents.c.is_lead.desc(), t.agents.c.slug)
        )
    ).all()
    assert [a.slug for a in agents] == ["lead", "chart", "data"]
    lead = agents[0]
    assert (lead.is_lead, lead.origin, lead.display_name) == (True, "lead", "Điều phối")
    assert all(a.origin == "starter" for a in agents[1:])
    folders = Path(app.state.settings.FOLDERS_DIR) / str(user)
    assert (folders / "lead" / "prompts" / "system.md").read_text() == "Lead Fabrikam.\n"
    assert (folders / "data" / ".env.d" / "warehouse.env").is_file()
    assert not (folders / "chart" / ".env.d").exists()
    assert all(a.baseline_commit for a in agents)
    threads = await conn.scalar(
        select(func.count())
        .select_from(t.threads)
        .where(t.threads.c.user_id == user, t.threads.c.kind == "direct")
    )
    assert threads == 3
    job = (await conn.execute(select(t.jobs).where(t.jobs.c.kind == "user_provision"))).one()
    assert job.status == "done"
    assert job.output == "created lead, chart, data"  # the lead first, then slug order
    assert sorted(app.state.harness.supervisor.started) == sorted(a.id for a in agents)


async def test_lead_falls_back_to_the_platform_prompt(app, accounts, conn):  # noqa: F811
    await accounts.rows.domain("fabrikam")
    await provision(app, accounts)
    user = await conn.scalar(select(t.users.c.id).where(t.users.c.username == "alice"))
    prompt = (
        Path(app.state.settings.FOLDERS_DIR) / str(user) / "lead" / "prompts" / "system.md"
    ).read_text()
    platform = Path(app.state.settings.PLATFORM_DIR) / "lead" / "prompt.md"
    assert prompt == platform.read_text()


async def test_failure_names_the_step_and_retry_continues(app, accounts, conn, domains):  # noqa: F811
    await accounts.rows.domain("fabrikam")
    h = app.state.harness
    calls = 0
    original = h.execd.exec

    async def flaky(**kw):
        nonlocal calls
        if kw["argv"][:2] == ["uv", "add"]:
            calls += 1
            if calls == 1:
                from backend.execd_client import ExecResult

                return ExecResult(
                    exit_code=1,
                    stdout="",
                    stderr="index unreachable",
                    duration_ms=1,
                    timed_out=False,
                    truncated=False,
                    head=None,
                    changed=[],
                    snapshot_error=None,
                )
        return await original(**kw)

    h.execd.exec = flaky
    await provision(app, accounts)
    user = (await conn.execute(select(t.users).where(t.users.c.username == "alice"))).one()
    assert user.status == "failed" and "data" in user.status_detail
    slugs = (
        (await conn.execute(select(t.agents.c.slug).where(t.agents.c.user_id == user.id)))
        .scalars()
        .all()
    )
    assert slugs == ["lead"]
    async with await accounts.login("admin") as c:
        r = await c.post(f"/api/admin/users/{user.id}/retry")
        assert r.status_code == 202 and r.json()["job_id"]
        assert (await c.post(f"/api/admin/users/{user.id}/retry")).status_code == 409
    await h.jobs.run_pending()
    user = (await conn.execute(select(t.users).where(t.users.c.username == "alice"))).one()
    assert user.status == "active" and user.status_detail is None
    slugs = (
        (
            await conn.execute(
                select(t.agents.c.slug)
                .where(t.agents.c.user_id == user.id)
                .order_by(t.agents.c.slug)
            )
        )
        .scalars()
        .all()
    )
    assert slugs == ["data", "lead"]  # the lead wasn't made twice


async def test_retry_is_only_for_failed_users(app, accounts, conn):  # noqa: F811
    alice = await accounts.user("alice")
    await accounts.admin()
    async with await accounts.login("admin") as c:
        r = await c.post(f"/api/admin/users/{alice}/retry")
    assert (r.status_code, r.json()["error"]) == (409, "invalid_state")


async def test_seed_demo_creates_alice_and_bob_once(conn, rows, monkeypatch):
    from backend import seed_demo

    await rows.domain("fabrikam")
    created = await seed_demo.seed(conn, "mật-khẩu-demo")
    assert created == ["alice", "bob", "vre-demo"]
    users = {r.username: r for r in (await conn.execute(select(t.users))).all()}
    assert all(users[name].domain_id == "fabrikam" for name in created)
    assert users["alice"].status == "provisioning"
    assert await seed_demo.seed(conn, "mật-khẩu-demo") == []
    jobs = await conn.scalar(
        select(func.count()).select_from(t.jobs).where(t.jobs.c.kind == "user_provision")
    )
    assert jobs == 3
    monkeypatch.delenv("DEMO_PASSWORD", raising=False)
    assert os.environ.get("DEMO_PASSWORD") is None


async def test_seed_demo_creates_a_separate_admin_without_provisioning(conn, rows):
    from backend import seed_demo

    await rows.domain("fabrikam")
    assert await seed_demo.seed(conn, "public-demo", "private-demo-admin") == [
        "alice",
        "bob",
        "vre-demo",
        "admin-demo",
    ]
    admin = (await conn.execute(select(t.users).where(t.users.c.username == "admin-demo"))).one()
    assert admin.role == "admin" and admin.status == "active" and admin.domain_id is None
    assert await seed_demo.seed(conn, "public-demo", "private-demo-admin") == []


async def test_enabling_a_user_whose_provisioning_never_finished(app, accounts, conn):  # noqa: F811
    from sqlalchemy import update

    alice = await accounts.user("alice")
    await accounts.admin()
    await conn.execute(update(t.users).where(t.users.c.id == alice).values(status="disabled"))
    async with await accounts.login("admin") as c:
        r = await c.patch(f"/api/admin/users/{alice}", json={"disabled": False})
        assert r.status_code == 200
        assert r.json()["status"] == "failed"
        assert "retry" in r.json()["status_detail"]
        assert (await c.post(f"/api/admin/users/{alice}/retry")).status_code == 202


async def _login_as(app, username, password="mật-khẩu-1"):  # noqa: F811
    import httpx

    from backend.tests.api.conftest import _Reentrant

    c = _Reentrant(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Contoso-Client": "web"},
    )
    r = await c.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


async def test_restart_during_provisioning_leaves_the_user_failed_and_retryable(
    app,  # noqa: F811
    accounts,
    conn,
):
    from backend.catalog import seeds

    await accounts.rows.domain("fabrikam")
    await accounts.admin()
    async with await accounts.login("admin") as c:
        r = await c.post(
            "/api/admin/users",
            json={"username": "vuong", "password": "mật-khẩu-1", "domain_id": "fabrikam"},
        )
    assert r.status_code == 202
    user_id = r.json()["user"]["id"]
    # the worker had picked the job up when the backend died
    await conn.execute(
        t.jobs.update().where(t.jobs.c.kind == "user_provision").values(status="running")
    )
    h = app.state.harness
    assert await h.jobs.fail_stale() == 1  # boot step 6 of the next start
    user = (await conn.execute(select(t.users).where(t.users.c.id == user_id))).one()
    assert (user.status, user.status_detail) == (
        "failed",
        "provisioning interrupted by restart; retry",
    )
    job = (await conn.execute(select(t.jobs).where(t.jobs.c.user_id == user_id))).one()
    assert (job.status, job.output) == ("failed", "interrupted by restart")
    # the application's recovery path: the admin's retry continues it to `active`
    async with await accounts.login("admin") as c:
        assert (await c.post(f"/api/admin/users/{user_id}/retry")).status_code == 202
    await seeds.upsert_catalogs(accounts.conn, app.state.settings, available=[])
    await h.jobs.run_pending()
    user = (await conn.execute(select(t.users).where(t.users.c.id == user_id))).one()
    assert (user.status, user.status_detail) == ("active", None)


async def test_fail_stale_leaves_finished_users_alone(app, accounts, conn):  # noqa: F811
    await accounts.rows.domain("fabrikam")
    await provision(app, accounts)
    assert await app.state.harness.jobs.fail_stale() == 0
    status = await conn.scalar(select(t.users.c.status).where(t.users.c.username == "alice"))
    assert status == "active"


async def test_an_active_user_logs_in_and_sees_agents_and_threads(app, accounts, conn):  # noqa: F811
    await accounts.rows.domain("fabrikam")
    await provision(app, accounts)
    async with await _login_as(app, "alice") as c:
        me = await c.get("/api/auth/me")
        agents = (await c.get("/api/agents")).json()
        threads = (await c.get("/api/threads")).json()
    assert me.status_code == 200 and me.json()["username"] == "alice"
    assert me.json()["status"] == "active"
    assert [a["slug"] for a in agents if a["is_lead"]] == ["lead"] and len(agents) >= 2
    direct = [th for th in threads if th["kind"] == "direct"]
    assert len(direct) == len(agents)


async def test_a_provisioning_user_can_log_in_and_has_no_agents_yet(app, accounts, conn):  # noqa: F811
    """Current policy (doc 12 gates only `disabled`): login works, the lists are empty until
    the provisioning job sets `active`."""
    await accounts.rows.domain("fabrikam")
    await accounts.admin()
    async with await accounts.login("admin") as c:
        r = await c.post(
            "/api/admin/users",
            json={"username": "vuong", "password": "mật-khẩu-1", "domain_id": "fabrikam"},
        )
    assert r.status_code == 202 and r.json()["user"]["status"] == "provisioning"
    async with await _login_as(app, "vuong") as c:
        me = await c.get("/api/auth/me")
        assert me.status_code == 200 and me.json()["status"] == "provisioning"
        assert (await c.get("/api/agents")).json() == []
        assert (await c.get("/api/threads")).json() == []


async def test_package_installs_get_their_own_timeout(app, accounts, conn, domains):  # noqa: F811
    from backend.agents.folders import SYSTEM_EXEC_TIMEOUT_S

    add_starter(domains, "chart", presets="[charts]")
    await accounts.rows.domain("fabrikam")
    h = app.state.harness
    seen = []
    original = h.execd.exec

    async def record(**kw):
        seen.append((tuple(kw["argv"][:2]) if kw.get("argv") else None, kw["timeout_s"]))
        return await original(**kw)

    h.execd.exec = record
    await provision(app, accounts)
    install = app.state.settings.AGENT_PACKAGE_INSTALL_TIMEOUT_S
    assert install == 1200 and SYSTEM_EXEC_TIMEOUT_S == 600
    assert ("uv", "add") in {argv for argv, _ in seen}
    for argv, timeout_s in seen:
        assert timeout_s == (install if argv in (("uv", "add"), ("uv", "sync")) else 600), argv


async def test_a_failed_user_sees_failed_without_the_raw_detail(app, accounts, conn):  # noqa: F811
    """`Me.status` tells the client the provisioning failed; `status_detail` (raw exec output)
    stays in the admin API."""
    uid = await accounts.user("vuong")
    await conn.execute(
        t.users.update()
        .where(t.users.c.id == uid)
        .values(status="failed", status_detail="starter chart: uv add exited 1: secret-ish output")
    )
    async with await accounts.login("vuong") as c:
        me = (await c.get("/api/auth/me")).json()
    assert me["status"] == "failed"
    assert "status_detail" not in me and "secret-ish" not in str(me)


async def test_admin_list_shows_provisioning_progress(app, accounts, conn, domains, rows):  # noqa: F811
    add_starter(domains, "chart")
    await accounts.rows.domain("fabrikam")
    await accounts.admin()
    async with await accounts.login("admin") as c:
        r = await c.post(
            "/api/admin/users",
            json={"username": "vuong", "password": "mật-khẩu-1", "domain_id": "fabrikam"},
        )
        user_id = r.json()["user"]["id"]
        listed = {u["username"]: u for u in (await c.get("/api/admin/users")).json()}
        # starters in loader order: chart, data (the fixture domain's own starter)
        assert listed["vuong"]["provisioning"] == {
            "job_status": "queued",
            "step": "lead",
            "agent": "Điều phối",
            "done": 0,
            "total": 3,
        }
        # the job commits each agent when it is ready: with the lead in, chart is next
        await rows.agent(user_id, slug="lead", is_lead=True, origin="lead")
        await conn.execute(
            t.jobs.update().where(t.jobs.c.kind == "user_provision").values(status="running")
        )
        listed = {u["username"]: u for u in (await c.get("/api/admin/users")).json()}
        assert listed["vuong"]["provisioning"] == {
            "job_status": "running",
            "step": "starter chart",
            "agent": "Chart",
            "done": 1,
            "total": 3,
        }
        # no raw job output reaches the list
        assert "output" not in str(listed["vuong"]["provisioning"])
        # finished users carry no progress
        await accounts.set_status(user_id, "active")
        listed = {u["username"]: u for u in (await c.get("/api/admin/users")).json()}
        assert listed["vuong"]["provisioning"] is None


async def test_a_human_user_is_provisioned_from_db_starters_without_a_group_room(
    app,  # noqa: F811
    accounts,
    conn,
):
    """Domains live in Postgres: starters come from `domain_starters` (lead prompt from the
    `is_lead` row), and the group-room step is a no-op for a human account."""
    await accounts.rows.domain("fabrikam")
    await conn.execute(
        t.domain_starters.insert(),
        [
            {
                "domain_id": "fabrikam",
                "slug": slug,
                "display_name": name,
                "is_lead": lead,
                "prompt": prompt,
            }
            for slug, name, lead, prompt in (
                ("lead", "", True, "Lead DB.\n"),
                ("chart", "Chart", False, "C\n"),
                ("data", "Data", False, "D\n"),
            )
        ],
    )
    await provision(app, accounts)
    user = await conn.scalar(select(t.users.c.id).where(t.users.c.username == "alice"))
    assert await conn.scalar(select(t.users.c.status).where(t.users.c.id == user)) == "active"
    slugs = (
        (
            await conn.execute(
                select(t.agents.c.slug)
                .where(t.agents.c.user_id == user)
                .order_by(t.agents.c.is_lead.desc(), t.agents.c.slug)
            )
        )
        .scalars()
        .all()
    )
    assert slugs == ["lead", "chart", "data"]
    folders = Path(app.state.settings.FOLDERS_DIR) / str(user)
    assert (folders / "lead" / "prompts" / "system.md").read_text() == "Lead DB.\n"
    assert await conn.scalar(select(func.count()).select_from(t.groups)) == 0
    assert (
        await conn.scalar(
            select(func.count()).select_from(t.threads).where(t.threads.c.kind == "group")
        )
        == 0
    )
