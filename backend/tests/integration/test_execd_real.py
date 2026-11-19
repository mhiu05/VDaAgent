"""`ExecdClient` against the real `workspace` service (compose.test.yaml)."""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from backend.execd_client import ExecdClient
from backend.settings import Settings

pytestmark = pytest.mark.skipif(
    os.environ.get("CONTOSO_TEST_EXECD") != "1", reason="needs the workspace service"
)


@pytest.fixture
def shared_folder():
    """A git folder on the shared `folders` volume, created from the api side."""
    path = Path("/data/folders") / f"itest-{uuid.uuid4().hex[:10]}"
    path.mkdir(parents=True)
    run = lambda *a: subprocess.run(["git", *a], cwd=path, check=True, capture_output=True)  # noqa: E731
    run("init", "-q", "-b", "main")
    (path / "prompt.md").write_text("x\n")
    run("add", "-A")
    run(
        "-c",
        "user.name=contoso-harness",
        "-c",
        "user.email=contoso-harness@contoso.local",
        "commit",
        "-q",
        "-m",
        "init",
    )
    yield path
    shutil.rmtree(path, ignore_errors=True)


async def test_exec_round_trip_and_snapshot(shared_folder):
    s = Settings()
    client = ExecdClient(s.EXECD_URL, s.EXECD_TOKEN.get_secret_value())
    try:
        res = await client.exec(
            folder=str(shared_folder),
            exec_id="x_itest",
            timeout_s=30,
            author="agent:data",
            code="open('files.txt','w').write('ok'); print('hi')",
        )
    finally:
        await client.aclose()
    assert res.exit_code == 0
    assert res.stdout == "hi\n"
    assert res.changed == [{"path": "files.txt", "status": "A"}]
    # api sees the file and the commit on the shared volume
    assert (shared_folder / "files.txt").read_text() == "ok"
    log = subprocess.run(
        ["git", "log", "-1", "--format=%an|%s"],
        cwd=shared_folder,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert log == "agent:data|exec x_itest"
