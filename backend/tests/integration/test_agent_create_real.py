"""Creating and resetting an agent against the real `workspace` (doc 04 steps 1-7)."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.agents import folders
from backend.execd_client import ExecdClient
from backend.settings import Settings
from backend.tests.db.conftest import rows  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("CONTOSO_TEST_EXECD") != "1", reason="needs the workspace service"
)
REPO = Path(__file__).resolve().parents[3]


@pytest.fixture
async def execd():
    s = Settings()
    client = ExecdClient(s.EXECD_URL, s.EXECD_TOKEN.get_secret_value())
    yield client
    await client.aclose()


async def test_create_runs_uv_sync_in_the_workspace_and_reset_restores(
    conn,
    rows,  # noqa: F811
    execd,
    tmp_path,
):
    domain = await rows.domain("fabrikam")
    user = await rows.user(username="itest", domain_id=domain)
    settings = Settings(
        FOLDERS_DIR="/data/folders", PLATFORM_DIR=str(REPO / "platform"), DOMAINS_DIR=str(tmp_path)
    )
    try:
        agent = await folders.create_agent(
            conn,
            settings=settings,
            execd=execd,
            user_id=user,
            domain_id=domain,
            slug="data",
            display_name="Data",
            avatar={"emoji": "📊", "color": "#16A34A"},
            origin="custom",
            prompt="Bạn là Data.\n",
        )
        folder = folders.folder_of(settings, agent)
        assert (folder / ".venv" / "bin" / "python").exists()  # made by uv in the workspace
        log = subprocess.run(
            ["git", "log", "--format=%an|%s"],
            cwd=folder,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.splitlines()
        assert log[-1] == "contoso-harness|create data"
        assert (
            agent.baseline_commit
            == subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=folder, capture_output=True, text=True, check=True
            ).stdout.strip()
        )

        (folder / "memory" / "index.md").write_text("# Memory\n- changed\n")
        await folders.reset_agent(conn, settings=settings, execd=execd, agent=agent)
        assert (folder / "memory" / "index.md").read_text() == "# Memory\n\n(no notes yet)\n"
    finally:
        shutil.rmtree(Path("/data/folders") / str(user), ignore_errors=True)
