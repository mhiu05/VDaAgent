"""Phase 3: existing user_provision worker with a group technical owner."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.catalog import seeds
from backend.db import tables as t
from backend.tests.api.test_builder_api import app, domains  # noqa: F401 (fixtures)

URL = "/api/groups"
SLUGS = {"lead", "data", "insight", "compare", "chart", "report"}


async def _seed_fabrikam(conn) -> None:
    """Fabrikam as the DB-backed domain model stores it: the domain row and its five starters
    (lead + 5 = the six-agent team). No credential sets: provisioning needs none here."""
    await conn.execute(
        pg_insert(t.domains)
        .values(id="fabrikam", name="Domain fabrikam", status="available")
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await conn.execute(
        t.domain_starters.insert(),
        [
            {
                "domain_id": "fabrikam",
                "slug": slug,
                "display_name": slug.title(),
                "prompt": f"You are {slug}.\n",
            }
            for slug in sorted(SLUGS - {"lead"})
        ],
    )


async def _create(accounts):
    await accounts.user("alice")
    async with await accounts.login("alice") as c:
        response = await c.post(URL, json={"name": "Sales Team"})
    assert response.status_code == 202, response.text
    return response.json()


async def _agents(conn, owner_id):
    return (await conn.execute(select(t.agents).where(t.agents.c.user_id == owner_id))).all()


async def test_group_worker_creates_six_owner_agents_and_attaches_only_lead(
    app,  # noqa: F811
    accounts,
    conn,
    domains,  # noqa: F811
):
    await _seed_fabrikam(conn)
    await seeds.upsert_catalogs(conn, app.state.settings, available=[])
    created = await _create(accounts)
    group = created["group"]
    owner_id = await conn.scalar(
        select(t.groups.c.technical_owner_id).where(t.groups.c.id == group["id"])
    )
    job = (await conn.execute(select(t.jobs))).one()
    assert (str(job.id), job.user_id, job.kind, job.status) == (
        created["job_id"],
        owner_id,
        "user_provision",
        "queued",
    )
    assert group["ai_available"] is False
    async with await accounts.login("alice") as c:
        before = (await c.get(f"{URL}/{group['id']}/provisioning")).json()
        assert (before["job_status"], before["done"], before["total"]) == ("queued", 0, 6)
        assert len(before["agents"]) == 6
        assert {a["state"] for a in before["agents"]} == {"pending"}
    assert await app.state.harness.jobs.run_pending() == 1
    agents = await _agents(conn, owner_id)
    assert len(agents) == 6 and {a.slug for a in agents} == SLUGS
    assert await conn.scalar(select(t.users.c.status).where(t.users.c.id == owner_id)) == "active"
    assert (
        await conn.scalar(
            select(func.count()).select_from(t.agents).where(t.agents.c.user_id != owner_id)
        )
        == 0
    )
    folders = Path(app.state.settings.FOLDERS_DIR) / str(owner_id)
    assert all((folders / slug).is_dir() for slug in SLUGS)
    agent_members = (
        (
            await conn.execute(
                select(t.thread_members.c.member_id).where(
                    t.thread_members.c.thread_id == group["room_thread_id"],
                    t.thread_members.c.member_type == "agent",
                )
            )
        )
        .scalars()
        .all()
    )
    assert agent_members == [next(a.id for a in agents if a.slug == "lead")]
    async with await accounts.login("alice") as c:
        detail = (await c.get(f"{URL}/{group['id']}")).json()
        progress = (await c.get(f"{URL}/{group['id']}/provisioning")).json()
        assert detail["ai_available"] is True
        assert (progress["status"], progress["done"], progress["total"]) == ("active", 6, 6)
        assert {a["state"] for a in progress["agents"]} == {"ready"}
    await conn.execute(
        t.thread_members.delete().where(
            t.thread_members.c.thread_id == group["room_thread_id"],
            t.thread_members.c.member_type == "agent",
        )
    )
    async with await accounts.login("alice") as c:
        assert (await c.get(f"{URL}/{group['id']}")).json()["ai_available"] is False


async def test_failed_partial_group_retry_reuses_owner_room_and_agents(
    app,  # noqa: F811
    accounts,
    conn,
    domains,  # noqa: F811
):
    await _seed_fabrikam(conn)
    await seeds.upsert_catalogs(conn, app.state.settings, available=[])
    created = await _create(accounts)
    group = created["group"]
    owner_id = await conn.scalar(
        select(t.groups.c.technical_owner_id).where(t.groups.c.id == group["id"])
    )
    h = app.state.harness
    original = h.execd.exec

    async def flaky(**kw):
        if Path(kw["folder"]).name == "insight" and kw["argv"][:2] == ["uv", "sync"]:
            h.execd.fail = True
            try:
                return await original(**kw)
            finally:
                h.execd.fail = False
        return await original(**kw)

    h.execd.exec = flaky
    assert await h.jobs.run_pending() == 1
    h.execd.exec = original
    assert await conn.scalar(select(t.users.c.status).where(t.users.c.id == owner_id)) == "failed"
    partial = await _agents(conn, owner_id)
    assert 0 < len(partial) < 6
    async with await accounts.login("alice") as c:
        failed = (await c.get(f"{URL}/{group['id']}/provisioning")).json()
        assert failed["status"] == "failed"
        assert "uv" not in str(failed) and "secret" not in str(failed)
        retry = await c.post(f"{URL}/{group['id']}/provisioning/retry")
        assert retry.status_code == 202
        duplicate = await c.post(f"{URL}/{group['id']}/provisioning/retry")
        assert (duplicate.status_code, duplicate.json()["error"]) == (409, "job_running")
        await conn.execute(
            update(t.jobs).where(t.jobs.c.id == retry.json()["job_id"]).values(status="running")
        )
        running = (await c.get(f"{URL}/{group['id']}/provisioning")).json()
        assert running["done"] == len(partial) and running["total"] == 6
        assert sum(a["state"] == "installing" for a in running["agents"]) == 1
        await conn.execute(
            update(t.jobs).where(t.jobs.c.id == retry.json()["job_id"]).values(status="queued")
        )
    assert await h.jobs.run_pending() == 1
    agents = await _agents(conn, owner_id)
    assert len(agents) == 6 and {a.slug for a in agents} == SLUGS
    assert await conn.scalar(select(t.users.c.status).where(t.users.c.id == owner_id)) == "active"
    assert (
        await conn.scalar(
            select(func.count()).select_from(t.users).where(t.users.c.account_type == "service")
        )
        == 1
    )
    assert await conn.scalar(select(func.count()).select_from(t.groups)) == 1
    assert (
        await conn.scalar(
            select(func.count()).select_from(t.threads).where(t.threads.c.kind == "group")
        )
        == 1
    )
    assert (
        await conn.scalar(
            select(func.count())
            .select_from(t.thread_members)
            .where(
                t.thread_members.c.thread_id == group["room_thread_id"],
                t.thread_members.c.member_type == "agent",
            )
        )
        == 1
    )
    async with await accounts.login("alice") as c:
        assert (await c.get(f"{URL}/{group['id']}")).json()["ai_available"] is True
        again = await c.post(f"{URL}/{group['id']}/provisioning/retry")
        assert (again.status_code, again.json()["error"]) == (409, "invalid_state")


async def test_stale_group_job_becomes_failed_and_retryable(app, accounts, conn, domains):  # noqa: F811
    created = await _create(accounts)
    owner_id = await conn.scalar(
        select(t.groups.c.technical_owner_id).where(t.groups.c.id == created["group"]["id"])
    )
    assert await app.state.harness.jobs.fail_stale() == 1
    assert await conn.scalar(select(t.users.c.status).where(t.users.c.id == owner_id)) == "failed"
    async with await accounts.login("alice") as c:
        assert (
            await c.post(f"{URL}/{created['group']['id']}/provisioning/retry")
        ).status_code == 202


async def test_nonmember_cannot_read_progress_or_retry(app, accounts, domains):  # noqa: F811
    created = await _create(accounts)
    await accounts.user("bobby")
    gid = created["group"]["id"]
    async with await accounts.login("bobby") as c:
        for method, path in (
            (c.get, f"{URL}/{gid}/provisioning"),
            (c.post, f"{URL}/{gid}/provisioning/retry"),
        ):
            response = await method(path)
            assert (response.status_code, response.json()["error"]) == (404, "not_found")
