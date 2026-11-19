"""Create, reset and delete an agent (doc 04 "Creating an agent", "Reset", "Delete")."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select

from backend.agents import folders
from backend.agents.folders import AgentError
from backend.db import tables as t
from backend.tests.agents.conftest import REPO, git


@pytest.fixture
async def user(rows):
    domain = await rows.domain("fabrikam")
    return await rows.user(username="alice", domain_id=domain)


async def create(conn, settings, execd, user_id, slug="data", **kw):
    from backend.domains.import_from_files import _import_one

    await _import_one(conn, settings, Path(settings.DOMAINS_DIR) / "fabrikam")
    params = {
        "domain_id": "fabrikam",
        "display_name": kw.pop("display_name", "Data"),
        "avatar": {"emoji": "📊", "color": "#16A34A"},
        "description": "Lấy số liệu",
        "origin": "starter",
        "prompt": "Bạn là Data.\n",
    }
    params.update(kw)
    return await folders.create_agent(
        conn, settings=settings, execd=execd, user_id=user_id, slug=slug, **params
    )


# --- create ---------------------------------------------------------------------------------


async def test_create_builds_the_folder_row_epoch_and_thread(conn, settings, fake_execd, user):
    agent = await create(
        conn,
        settings,
        fake_execd,
        user,
        presets=[["pandas", "pyarrow"], ["psycopg[binary]"]],
        credential_sets=["warehouse"],
    )
    folder = Path(settings.FOLDERS_DIR) / str(user) / "data"
    assert agent.slug == "data" and agent.state == "active" and agent.status == "idle"
    assert agent.origin == "starter" and agent.is_lead is False
    # skeleton copy + prompt
    assert (folder / "prompts" / "system.md").read_text() == "Bạn là Data.\n"
    assert (folder / "memory" / "index.md").exists()
    # DB credentials are materialized privately, with a key-name sidecar.
    link = folder / ".env.d" / "warehouse.env"
    assert link.is_file() and not link.is_symlink()
    assert "WAREHOUSE_DSN=postgres://secret" in link.read_text()
    assert "WAREHOUSE_DSN" in link.with_suffix(".env.keys").read_text()
    # first commit by the harness
    first = git(folder, "log", "--reverse", "--format=%an|%s").splitlines()[0]
    assert first == "contoso-harness|create data"
    assert git(folder, "branch", "--show-current") == "main"
    # system execs: uv sync, then one uv add per preset, as contoso-harness
    assert [c["argv"] for c in fake_execd.calls] == [
        ["uv", "sync"],
        ["uv", "add", "pandas", "pyarrow"],
        ["uv", "add", "psycopg[binary]"],
    ]
    assert {c["author"] for c in fake_execd.calls} == {"contoso-harness"}
    # package installs get AGENT_PACKAGE_INSTALL_TIMEOUT_S, not the 600 s system-exec limit
    install = settings.AGENT_PACKAGE_INSTALL_TIMEOUT_S
    assert all(c["exec_id"].startswith("x_") for c in fake_execd.calls)
    assert all(c["timeout_s"] == install for c in fake_execd.calls)
    # baseline = HEAD after the presets
    assert agent.baseline_commit == git(folder, "rev-parse", "HEAD")
    epoch = (
        await conn.execute(select(t.agent_epochs).where(t.agent_epochs.c.agent_id == agent.id))
    ).one()
    assert (epoch.epoch, epoch.start_seq, epoch.reason, epoch.summary) == (0, 0, "initial", "")
    assert "Bạn là Data." in epoch.system_prompt
    assert "WAREHOUSE_DSN" in epoch.system_prompt and "secret" not in epoch.system_prompt
    thread = (
        await conn.execute(
            select(t.threads).where(t.threads.c.user_id == user, t.threads.c.kind == "direct")
        )
    ).one()
    assert thread.member_key == "data" and thread.read_only is False
    members = (
        await conn.execute(
            select(t.thread_members.c.member_type, t.thread_members.c.member_id).where(
                t.thread_members.c.thread_id == thread.id
            )
        )
    ).all()
    assert sorted(members) == sorted([("user", user), ("agent", agent.id)])


async def test_lead_uses_the_lead_flag(conn, settings, fake_execd, user):
    agent = await create(
        conn,
        settings,
        fake_execd,
        user,
        slug="lead",
        origin="lead",
        is_lead=True,
        display_name="Điều phối",
    )
    assert agent.is_lead is True
    prompt = await conn.scalar(
        select(t.agent_epochs.c.system_prompt).where(t.agent_epochs.c.agent_id == agent.id)
    )
    assert "## Lead duties" in prompt


@pytest.mark.parametrize("slug", ["A", "x", "-ab", "ab_c", "a" * 33, "lead!"])
async def test_invalid_slug(conn, settings, fake_execd, user, slug):
    with pytest.raises(AgentError) as e:
        await create(conn, settings, fake_execd, user, slug=slug)
    assert (e.value.status, e.value.code) == (400, "invalid_slug")
    assert fake_execd.calls == []


async def test_slug_must_be_unique_including_deleted(conn, settings, fake_execd, user, rows):
    await rows.agent(user, slug="data", state="deleted")
    with pytest.raises(AgentError) as e:
        await create(conn, settings, fake_execd, user, slug="data")
    assert (e.value.status, e.value.code) == (409, "slug_taken")


async def test_agent_limit(conn, settings, fake_execd, user, rows):
    settings.MAX_AGENTS_PER_USER = 2
    await rows.agent(user, slug="a1")
    await rows.agent(user, slug="a2")
    await rows.agent(user, slug="gone", state="deleted")  # deleted agents don't count
    with pytest.raises(AgentError) as e:
        await create(conn, settings, fake_execd, user, slug="data")
    assert (e.value.status, e.value.code) == (409, "agent_limit")


async def test_credential_set_must_exist_in_the_domain(conn, settings, fake_execd, user):
    with pytest.raises(AgentError) as e:
        await create(conn, settings, fake_execd, user, credential_sets=["nope"])
    assert (e.value.status, e.value.code) == (400, "unknown_credential_set")


async def test_failed_step_moves_the_folder_to_trash(conn, settings, fake_execd, user):
    fake_execd.fail_on = "uv add"
    with pytest.raises(AgentError) as e:
        await create(conn, settings, fake_execd, user, presets=[["pandas"]])
    assert e.value.code == "create_failed"
    root = Path(settings.FOLDERS_DIR)
    assert not (root / str(user) / "data").exists()
    trashed = list((root / ".trash").iterdir())
    assert len(trashed) == 1 and trashed[0].name.startswith(f"{user}-data-")
    count = await conn.scalar(
        select(func.count()).select_from(t.agents).where(t.agents.c.user_id == user)
    )
    assert count == 0


async def test_a_leftover_folder_without_a_row_is_trashed_first(conn, settings, fake_execd, user):
    stale = Path(settings.FOLDERS_DIR) / str(user) / "data"
    stale.mkdir(parents=True)
    (stale / "junk").write_text("x")
    agent = await create(conn, settings, fake_execd, user)
    assert not (stale / "junk").exists()
    assert agent.slug == "data"
    assert len(list((Path(settings.FOLDERS_DIR) / ".trash").iterdir())) == 1


# --- reset ----------------------------------------------------------------------------------


async def test_reset_restores_the_baseline(conn, settings, fake_execd, user, rows):
    agent = await create(
        conn, settings, fake_execd, user, presets=[["pandas"]], credential_sets=["warehouse"]
    )
    folder = folders.folder_of(settings, agent)
    # the agent learns things: edits, new tracked file, untracked file, outputs
    (folder / "memory" / "index.md").write_text("# Memory\n- learned\n")
    (folder / "helpers" / "peers.py").write_text("X = 1\n")
    git(folder, "add", "-A")
    git(
        folder,
        "-c",
        "user.name=agent:data",
        "-c",
        "user.email=a@contoso.local",
        "commit",
        "-qm",
        "e",
    )
    (folder / "files" / "scratch.csv").write_text("a\n")
    (folder / ".contoso" / "outputs").mkdir(parents=True)
    (folder / ".contoso" / "outputs" / "x_1.txt").write_text("big")
    await rows.event(agent.id, 1)
    await rows.event(agent.id, 2)
    fake_execd.calls.clear()

    await folders.reset_agent(conn, settings=settings, execd=fake_execd, agent=agent)

    assert (folder / "memory" / "index.md").read_text() == "# Memory\n\n(no notes yet)\n"
    assert not (folder / "helpers" / "peers.py").exists()
    assert not (folder / "files" / "scratch.csv").exists()
    assert (folder / ".env.d" / "warehouse.env").is_file()  # ignored, kept
    assert (folder / ".contoso" / "outputs" / "x_1.txt").exists()  # kept
    assert git(folder, "diff", "--stat", agent.baseline_commit, "HEAD") == ""
    assert git(folder, "log", "-1", "--format=%an|%s") == "contoso-harness|reset"
    assert [c["argv"] for c in fake_execd.calls] == [["uv", "sync"]]
    epochs = (
        await conn.execute(
            select(t.agent_epochs)
            .where(t.agent_epochs.c.agent_id == agent.id)
            .order_by(t.agent_epochs.c.epoch)
        )
    ).all()
    assert [(e.epoch, e.reason, e.start_seq, e.summary) for e in epochs] == [
        (0, "initial", 0, ""),
        (1, "reset", 2, ""),
    ]


async def test_reset_brings_a_starter_onto_the_current_template(conn, settings, fake_execd, user):
    """A starter prompt fixed after the agent was created (the Report publish schema) reaches
    the existing agent on reset; credentials, presets and identity stay."""
    import json
    import re

    from backend.reports.schema import validate_schema

    starter = Path(settings.DOMAINS_DIR) / "fabrikam" / "starters" / "report"
    starter.mkdir(parents=True)
    (starter / "agent.yaml").write_text("display_name: Report\npresets: []\ncredentials: []\n")
    old = "# Report\n\nPublish a report schema v1 JSON file (see your skills).\n"
    (starter / "prompt.md").write_text(old)
    agent = await create(
        conn, settings, fake_execd, user, slug="report", prompt=old, credential_sets=["warehouse"]
    )
    folder = folders.folder_of(settings, agent)
    current = (REPO / "domains/fabrikam/starters/report/prompt.md").read_text(encoding="utf-8")
    (starter / "prompt.md").write_text(current)  # the template is fixed later

    from backend.domains.import_from_files import _import_one

    await _import_one(conn, settings, Path(settings.DOMAINS_DIR) / "fabrikam")

    await folders.reset_agent(conn, settings=settings, execd=fake_execd, agent=agent)

    assert (folder / "prompts" / "system.md").read_text(encoding="utf-8") == current
    assert git(folder, "log", "-1", "--format=%an|%s") == "contoso-harness|reset"
    assert (folder / ".env.d" / "warehouse.env").is_file()
    epoch = (
        await conn.execute(
            select(t.agent_epochs.c.system_prompt).where(
                t.agent_epochs.c.agent_id == agent.id, t.agent_epochs.c.reason == "reset"
            )
        )
    ).scalar_one()
    assert '"schemaVersion": 1' in epoch and "see your skills" not in epoch
    example = re.search(r"```json\n(.*?)```", epoch, re.S).group(1)
    validate_schema(json.loads(example), report_id="R1", version_id="R1-v1", evidence_ids=[])


async def test_reset_keeps_a_custom_agents_own_prompt(conn, settings, fake_execd, user):
    agent = await create(
        conn,
        settings,
        fake_execd,
        user,
        slug="mine",
        origin="custom",
        prompt="Bạn là trợ lý riêng.\n",
    )
    await folders.reset_agent(conn, settings=settings, execd=fake_execd, agent=agent)
    folder = folders.folder_of(settings, agent)
    assert (folder / "prompts" / "system.md").read_text() == "Bạn là trợ lý riêng.\n"


async def test_reset_refused_while_involved_in_a_running_task(
    conn, settings, fake_execd, user, rows
):
    agent = await create(conn, settings, fake_execd, user)
    task = await rows.insert(
        t.global_tasks, user_id=user, description="x", status="running", started_at=func.now()
    )
    await rows.insert(t.task_involvement, task_id=task, agent_id=agent.id)
    with pytest.raises(AgentError) as e:
        await folders.reset_agent(conn, settings=settings, execd=fake_execd, agent=agent)
    assert (e.value.status, e.value.code) == (409, "agent_busy_in_task")


# --- delete ---------------------------------------------------------------------------------


async def test_delete_marks_deleted_and_detaches(conn, settings, fake_execd, user, rows):
    agent = await create(conn, settings, fake_execd, user)
    other = await create(conn, settings, fake_execd, user, slug="chart")
    group = await rows.thread(user, kind="group", name="Nhóm báo cáo")
    for member in (agent.id, other.id):
        await rows.insert(t.thread_members, thread_id=group, member_type="agent", member_id=member)
    await folders.delete_agent(conn, settings=settings, agent=agent)
    row = (await conn.execute(select(t.agents).where(t.agents.c.id == agent.id))).one()
    assert row.state == "deleted"
    direct = (
        await conn.execute(
            select(t.threads).where(
                t.threads.c.kind == "direct",
                t.threads.c.member_key == "data",
                t.threads.c.user_id == user,
            )
        )
    ).one()
    assert direct.read_only is True
    group_members = (
        (
            await conn.execute(
                select(t.thread_members.c.member_id).where(t.thread_members.c.thread_id == group)
            )
        )
        .scalars()
        .all()
    )
    assert group_members == [other.id]
    assert folders.folder_of(settings, agent).exists()  # kept for the trace view


async def test_the_lead_cannot_be_deleted(conn, settings, fake_execd, user):
    lead = await create(conn, settings, fake_execd, user, slug="lead", origin="lead", is_lead=True)
    with pytest.raises(AgentError) as e:
        await folders.delete_agent(conn, settings=settings, agent=lead)
    assert (e.value.status, e.value.code) == (409, "lead_protected")


async def test_delete_refused_while_involved(conn, settings, fake_execd, user, rows):
    agent = await create(conn, settings, fake_execd, user)
    task = await rows.insert(
        t.global_tasks, user_id=user, description="x", status="running", started_at=func.now()
    )
    await rows.insert(t.task_involvement, task_id=task, agent_id=agent.id)
    with pytest.raises(AgentError) as e:
        await folders.delete_agent(conn, settings=settings, agent=agent)
    assert e.value.code == "agent_busy_in_task"
