"""Fixtures for agent-folder tests: temp folders/domains dirs, a fake execd, rows."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend.execd_client import ExecResult
from backend.settings import Settings
from backend.tests.db.conftest import rows  # noqa: F401  (shared row-factory fixture)

REPO = Path(__file__).resolve().parents[3]


def git(folder: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=folder, check=True, capture_output=True, text=True
    ).stdout.strip()


class FakeExecd:
    """Records system execs. Like execd, snapshots the folder after each one."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.fail_on: str | None = None  # first argv word that fails

    async def exec(
        self, *, folder, exec_id, timeout_s, author, code=None, argv=None, env_extra=None
    ) -> ExecResult:
        self.calls.append(
            {
                "folder": folder,
                "argv": argv,
                "code": code,
                "author": author,
                "timeout_s": timeout_s,
                "exec_id": exec_id,
            }
        )
        exit_code = 1 if argv and self.fail_on == " ".join(argv[:2]) else 0
        path = Path(folder)
        old = git(path, "rev-parse", "HEAD")
        if argv and argv[:2] == ["uv", "add"]:
            # pretend uv wrote the dependency
            (path / "uv.lock").write_text("\n".join(argv[2:]) + "\n")
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
        head = git(path, "rev-parse", "HEAD")
        return ExecResult(
            exit_code=exit_code,
            stdout="",
            stderr="boom" if exit_code else "",
            duration_ms=1,
            timed_out=False,
            truncated=False,
            head=head,
            changed=[] if head == old else [{"path": "uv.lock", "status": "A"}],
            snapshot_error=None,
        )


@pytest.fixture
def fake_execd() -> FakeExecd:
    return FakeExecd()


@pytest.fixture
def dirs(tmp_path) -> dict[str, Path]:
    folders = tmp_path / "folders"
    domains = tmp_path / "domains"
    folders.mkdir()
    cred = domains / "fabrikam" / "credentials"
    cred.mkdir(parents=True)
    (domains / "fabrikam" / "domain.yaml").write_text("id: fabrikam\nname: Fabrikam\n")
    (cred / "warehouse.env.example").write_text(
        "# description: Kho dữ liệu\nWAREHOUSE_DSN=\nWAREHOUSE_SNAPSHOT_ID=\n"
    )
    (cred / "warehouse.env").write_text(
        "WAREHOUSE_DSN=postgres://secret\nWAREHOUSE_SNAPSHOT_ID=S1\n"
    )
    (cred / "web-search.env.example").write_text("# description: Tìm kiếm web\nTAVILY_API_KEY=\n")
    (cred / "web-search.env").write_text("TAVILY_API_KEY=tvly-secret\n")
    return {"folders": folders, "domains": domains, "platform": REPO / "platform"}


@pytest.fixture
def settings(platform_env, dirs) -> Settings:
    return Settings(
        FOLDERS_DIR=str(dirs["folders"]),
        DOMAINS_DIR=str(dirs["domains"]),
        PLATFORM_DIR=str(dirs["platform"]),
    )
