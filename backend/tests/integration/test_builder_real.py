"""Builder and provisioning against the real `workspace` (doc 17 integration #7 and #8).

#7: apply a preset (`uv add` from the warm cache), install a skill from the `fixtures` server,
edit the prompt. Each makes a `user:<name>` commit and a notice; the prompt edit makes
compaction pending.
#8: creating a `fabrikam` user makes the lead plus five starters, each with its materialized
`.env.d` credentials and key sidecars, a `baseline_commit` and a direct thread.
"""

from __future__ import annotations

import asyncio
import io
import os
import shutil
import subprocess
import tarfile
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from dotenv import dotenv_values
from sqlalchemy import select

from backend.agents import builder, jobs
from backend.catalog import seeds
from backend.db import tables as t
from backend.domains.import_from_files import run as import_domains
from backend.domains.loader import load_domain
from backend.domains.materialize import materialize
from backend.execd_client import ExecdClient
from backend.harness.runtime import Harness
from backend.settings import Settings
from backend.tests.db.conftest import rows  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("CONTOSO_TEST_EXECD") != "1" or not os.environ.get("CONTOSO_TEST_FIXTURES_URL"),
    reason="needs the workspace and fixtures services",
)
REPO = Path(__file__).resolve().parents[3]
SHA = "0123456789abcdef0123456789abcdef01234567"


class NoSupervisor:
    def start_agent(self, *a, **kw):
        pass

    def wake(self, *a):
        pass


@pytest.fixture
async def harness(conn, tmp_path):
    # the real environment of the test container (EXECD_TOKEN, EXECD_URL), not platform_env
    domains_dir = tmp_path / "domains"
    source = REPO / "domains/fabrikam"
    domain_dir = domains_dir / "fabrikam"
    # Copy only public templates; never read local .env files or use live credentials.
    templates = [source / "domain.yaml"]
    templates.extend(source.glob("starters/*/agent.yaml"))
    templates.extend(source.glob("starters/*/prompt.md"))
    templates.extend(source.glob("seeds/*.yaml"))
    templates.extend(source.glob("credentials/*.env.example"))
    for template in templates:
        destination = domain_dir / template.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(template, destination)
        if template.name.endswith(".env.example"):
            values = dotenv_values(template)
            destination.with_suffix("").write_text(
                "".join(f"{key}=integration-{key.lower()}\n" for key in values), encoding="utf-8"
            )
    settings = Settings(
        FOLDERS_DIR="/data/folders",
        PLATFORM_DIR=str(REPO / "platform"),
        DOMAINS_DIR=str(domains_dir),
        CREDENTIAL_ENCRYPTION_KEY=Fernet.generate_key().decode(),
        SKILLS_CODELOAD_URL=os.environ["CONTOSO_TEST_FIXTURES_URL"],
    )
    lock = asyncio.Lock()

    @asynccontextmanager
    async def provider():
        async with lock, conn.begin_nested():
            yield conn

    execd = ExecdClient(settings.EXECD_URL, settings.EXECD_TOKEN.get_secret_value())
    h = Harness(settings, db=provider, execd=execd, model=None)
    h.supervisor = NoSupervisor()
    h.wake = lambda a: None
    await import_domains(domains_dir, settings, conn)
    await seeds.upsert_catalogs(conn, settings, available=["fabrikam"])
    yield h
    await execd.aclose()


@pytest.fixture
async def user(conn, rows):  # noqa: F811
    domain = await conn.scalar(select(t.domains.c.id).where(t.domains.c.id == "fabrikam"))
    if domain is None:
        await rows.domain("fabrikam")
    uid = await rows.user(username="ibuilder", domain_id="fabrikam", status="provisioning")
    yield uid
    shutil.rmtree(Path("/data/folders") / str(uid), ignore_errors=True)


def git(folder, *args):
    return subprocess.run(
        ["git", *args], cwd=folder, capture_output=True, text=True, check=True
    ).stdout.strip()


async def run_job(h, conn, user_id, kind, request, agent_id=None):
    job_id = await jobs.enqueue(
        None, conn, user_id=user_id, kind=kind, request=request, agent_id=agent_id
    )
    await h.jobs.run_pending()
    return (await conn.execute(select(t.jobs).where(t.jobs.c.id == job_id))).one()


async def notices(conn, agent_id):
    return [
        r.notice["text"]
        for r in (
            await conn.execute(
                select(t.deliveries)
                .where(t.deliveries.c.agent_id == agent_id)
                .order_by(t.deliveries.c.id)
            )
        ).all()
    ]


def publish_skill_tarball() -> None:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in {
            "skills/xlsx/SKILL.md": b"---\nname: xlsx\ndescription: Excel\n---\n",
            "skills/xlsx/notes.md": b"notes",
        }.items():
            info = tarfile.TarInfo(f"skills-{SHA}/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    path = Path("/fixtures") / "o" / "skills" / "tar.gz" / SHA
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.getvalue())


async def test_builder_changes_commit_and_notify(conn, harness, user):
    h = harness
    job = await run_job(
        h,
        conn,
        user,
        "agent_create",
        {
            "slug": "data",
            "display_name": "Data",
            "avatar": {"emoji": "x", "color": "#000"},
            "description": "",
            "presets": [],
            "credentials": [],
        },
    )
    assert job.status == "done", job.output
    agent = (await conn.execute(select(t.agents).where(t.agents.c.user_id == user))).one()
    folder = h.folder(agent)
    await conn.execute(t.users.update().where(t.users.c.id == user).values(username="alice2"))

    # preset from the warm cache
    (packages,) = await jobs.preset_packages(conn, ["data"], "fabrikam")
    job = await run_job(
        h,
        conn,
        user,
        "preset_apply",
        {"preset_id": "data", "argv": ["uv", "add", *packages]},
        agent.id,
    )
    assert job.status == "done", job.output
    assert {p["name"] for p in builder.list_packages(folder)} >= {"pandas", "numpy", "pyarrow"}
    assert git(folder, "log", "-1", "--format=%an") == "user:alice2"

    # skill from the fixtures server
    publish_skill_tarball()
    job = await run_job(
        h,
        conn,
        user,
        "skill_install",
        {
            "argv": [
                "python",
                "-m",
                "contoso.skills",
                "install",
                "o/skills",
                "skills/xlsx",
                "--ref",
                SHA,
                "--name",
                "xlsx",
            ]
        },
        agent.id,
    )
    assert job.status == "done", job.output
    assert (folder / "skills" / "xlsx" / "SKILL.md").is_file()
    assert git(folder, "log", "-1", "--format=%an") == "user:alice2"

    # prompt edit
    async with h.job_lock(agent.id):
        await builder.save_prompt(h, conn, agent, folder, "Vai trò mới\n", "alice2")
    assert git(folder, "log", "-1", "--format=%an|%s") == "user:alice2|edit prompt"
    texts = await notices(conn, agent.id)
    prefix = "Thư viện đã thay đổi: "
    assert texts[0].startswith(prefix)  # uv keeps pyproject sorted, so compare as a set
    assert set(texts[0].removeprefix(prefix).split(", ")) == {"+pandas", "+numpy", "+pyarrow"}
    assert texts[1] == "Kỹ năng mới: xlsx — đọc skills/xlsx/SKILL.md"
    assert texts[2].startswith("Người dùng đã cập nhật vai trò của bạn:")
    assert (
        await conn.scalar(select(t.agents.c.compaction_pending).where(t.agents.c.id == agent.id))
        is True
    )


async def test_provisioning_a_fabrikam_user(conn, harness, user):
    job = await run_job(harness, conn, user, "user_provision", {"domain_id": "fabrikam"})
    assert job.status == "done", job.output
    agents = {
        a.slug: a
        for a in (await conn.execute(select(t.agents).where(t.agents.c.user_id == user))).all()
    }
    assert set(agents) == {"lead", "data", "insight", "compare", "chart", "report"}
    assert agents["lead"].is_lead and agents["lead"].origin == "lead"
    root = Path("/data/folders") / str(user)
    links = {
        slug: sorted(p.name for p in (root / slug / ".env.d").glob("*.env"))
        if (root / slug / ".env.d").exists()
        else []
        for slug in agents
    }
    assert links == {
        "lead": [],
        "data": ["ops-db.env", "warehouse.env", "web-search.env"],  # ops-db: 70febb8
        "insight": [],
        "compare": ["warehouse.env"],
        "chart": [],
        "report": [],
    }
    expected_keys = {
        "ops-db.env": ["OPS_DB"],
        "warehouse.env": ["WAREHOUSE_DSN", "WAREHOUSE_SNAPSHOT_ID"],
        "web-search.env": ["TAVILY_API_KEY"],
    }
    for slug, filenames in links.items():
        for filename in filenames:
            env_file = root / slug / ".env.d" / filename
            assert env_file.is_file() and not env_file.is_symlink()
            assert sorted(dotenv_values(env_file)) == expected_keys[filename]
            assert (
                sorted(env_file.with_suffix(".env.keys").read_text().splitlines())
                == (expected_keys[filename])
            )
    for slug, agent in agents.items():
        assert agent.baseline_commit == git(root / slug, "rev-parse", "HEAD")
        assert (root / slug / ".venv").is_dir()
    deps = {p["name"] for p in builder.list_packages(root / "chart")}
    assert {"pandas", "matplotlib", "seaborn"} <= deps
    threads = (
        (
            await conn.execute(
                select(t.threads.c.member_key).where(
                    t.threads.c.user_id == user, t.threads.c.kind == "direct"
                )
            )
        )
        .scalars()
        .all()
    )
    assert sorted(threads) == sorted(agents)
    status = await conn.scalar(select(t.users.c.status).where(t.users.c.id == user))
    assert status == "active"


async def test_fabrikam_provisioning_source_has_roles_and_credentials(
    conn, harness, user, tmp_path
):
    """Catch an unimported DB domain before provisioning starts expensive package installs."""
    domain = await load_domain(conn, "fabrikam")
    assert [starter.slug for starter in domain.starters] == [
        "chart",
        "compare",
        "data",
        "insight",
        "report",
    ]
    assert domain.credential_sets == ["ops-db", "warehouse", "web-search"]
    expected = {
        "ops-db": {"OPS_DB": "integration-ops_db"},
        "warehouse": {
            "WAREHOUSE_DSN": "integration-warehouse_dsn",
            "WAREHOUSE_SNAPSHOT_ID": "integration-warehouse_snapshot_id",
        },
        "web-search": {"TAVILY_API_KEY": "integration-tavily_api_key"},
    }
    agent = tmp_path / "credential-probe"
    agent.mkdir()
    for name, values in expected.items():
        await materialize(conn, harness.settings, "fabrikam", name, agent / ".env.d")
        env_file = agent / ".env.d" / f"{name}.env"
        assert dotenv_values(env_file) == values
        assert sorted(env_file.with_suffix(".env.keys").read_text().splitlines()) == sorted(values)
