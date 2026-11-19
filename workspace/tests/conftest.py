"""Fixtures for the execd and contoso tests (run inside the workspace test image)."""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TOKEN = "test-execd-token"
ROOT = Path(os.environ.get("EXECD_FOLDERS_ROOT", "/data/folders"))


def git(folder: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=folder, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture
def folder() -> Path:
    """A fresh agent folder under the folders root: a git repo with one commit."""
    path = ROOT / f"test-{uuid.uuid4().hex[:12]}" / "data"
    path.mkdir(parents=True)
    (path / ".gitignore").write_text(".venv/\n__pycache__/\noutputs/\n")
    (path / "prompt.md").write_text("hello\n")
    git(path, "init", "-q", "-b", "main")
    git(path, "add", "-A")
    git(
        path,
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
    shutil.rmtree(path.parent, ignore_errors=True)


@pytest.fixture
def client(monkeypatch) -> TestClient:
    monkeypatch.setenv("EXECD_TOKEN", TOKEN)
    monkeypatch.setenv("EXECD_FOLDERS_ROOT", str(ROOT))
    from execd.app import app

    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c


@pytest.fixture
def run(client, folder):
    """POST /exec for `folder` and return the JSON body (asserting 200)."""

    def _run(code: str | None = None, *, argv: list[str] | None = None, **extra) -> dict:
        body = {
            "folder": str(folder),
            "exec_id": f"x_{uuid.uuid4().hex}",
            "timeout_s": extra.pop("timeout_s", 30),
            "author": extra.pop("author", "agent:data"),
        }
        if code is not None:
            body["code"] = code
        if argv is not None:
            body["argv"] = argv
        body.update(extra)
        r = client.post("/exec", json=body)
        assert r.status_code == 200, r.text
        return r.json()

    return _run
