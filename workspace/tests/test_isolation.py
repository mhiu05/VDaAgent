"""Per-exec filesystem isolation (doc 11 "Isolation level"): an agent's code reaches its own
folder, the shared uv cache and the runtime, never another agent's or another user's folder."""

from __future__ import annotations

import json
import shutil
import uuid

import pytest
from conftest import ROOT, git
from execd import run as runner

pytestmark = pytest.mark.skipif(
    runner.isolation() != "landlock", reason="Landlock is unavailable on this kernel"
)

PROBE = """
import json, os
def try_(fn):
    try:
        fn()
        return "ok"
    except PermissionError:
        return "denied"
    except OSError as e:
        return type(e).__name__
"""


@pytest.fixture
def bob():
    """Another user's agent folder with a secret file."""
    path = ROOT / f"test-{uuid.uuid4().hex[:12]}" / "data"
    path.mkdir(parents=True)
    (path / "secret.txt").write_text("bob's data\n")
    yield path
    shutil.rmtree(path.parent, ignore_errors=True)


def probe(run, checks: dict[str, str]) -> dict[str, str]:
    pairs = ", ".join(f"{k!r}: try_(lambda: {v})" for k, v in checks.items())
    body = PROBE + f"print(json.dumps({{{pairs}}}))"
    out = run(body)
    assert out["exit_code"] == 0, out["stderr"]
    return json.loads(out["stdout"])


def test_health_reports_the_sandbox(client):
    assert client.get("/health").json() == {"ok": True, "fs_isolation": "landlock"}


def test_own_folder_is_readable_and_writable(run, folder):
    result = probe(
        run,
        {
            "write": "open('files.txt', 'w').write('x')",
            "read": "open('prompt.md').read()",
            "list": "os.listdir('.')",
            "mkdir": "os.makedirs('files/sub', exist_ok=True)",
            "tmp": "open('/tmp/contoso-probe', 'w').write('x')",
            "stdlib": "__import__('decimal')",
            "contoso": "__import__('contoso')",
        },
    )
    assert set(result.values()) == {"ok"}, result
    assert (folder / "files.txt").read_text() == "x"


def test_another_users_folder_is_out_of_reach(run, folder, bob):
    secret = bob / "secret.txt"
    rel = f"../../{bob.parent.name}/data/secret.txt"
    result = probe(
        run,
        {
            "list_root": f"os.listdir({str(ROOT)!r})",
            "list_bob": f"os.listdir({str(bob)!r})",
            "read_abs": f"open({str(secret)!r}).read()",
            "read_dotdot": f"open({rel!r}).read()",
            "write_abs": f"open({str(bob / 'planted.py')!r}, 'w').write('x')",
            "sibling_agent": f"os.listdir({str(folder.parent)!r})",
        },
    )
    assert set(result.values()) == {"denied"}, result
    assert not (bob / "planted.py").exists()


def test_service_group_agent_cannot_read_personal_or_another_group_folder(client):
    """The same path-agnostic Landlock policy applies to service-owned group agents."""
    names = [f"test-{uuid.uuid4().hex[:12]}" for _ in range(3)]
    group_agent = ROOT / names[0] / "lead"
    personal = ROOT / names[1] / "data"
    other_group = ROOT / names[2] / "lead"
    for path in (group_agent, personal, other_group):
        path.mkdir(parents=True)
        (path / "secret.txt").write_text("private\n")
    try:
        git(group_agent, "init", "-q", "-b", "main")
        git(group_agent, "add", "-A")
        git(
            group_agent,
            "-c",
            "user.name=contoso-harness",
            "-c",
            "user.email=contoso-harness@contoso.local",
            "commit",
            "-q",
            "-m",
            "init",
        )
        code = (
            PROBE + f"print(json.dumps({{\n"
            f"'personal': try_(lambda: open({str(personal / 'secret.txt')!r}).read()),\n"
            f"'other_group': try_(lambda: os.listdir({str(other_group)!r})),\n"
            f"'folders_root': try_(lambda: os.listdir({str(ROOT)!r}))\n"
            "}))"
        )
        response = client.post(
            "/exec",
            json={
                "folder": str(group_agent),
                "exec_id": f"x_{uuid.uuid4().hex}",
                "timeout_s": 30,
                "author": "agent:lead",
                "code": code,
            },
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["exit_code"] == 0, result["stderr"]
        assert json.loads(result["stdout"]) == {
            "personal": "denied",
            "other_group": "denied",
            "folders_root": "denied",
        }
    finally:
        for name in names:
            shutil.rmtree(ROOT / name, ignore_errors=True)


def test_a_symlink_does_not_escape(run, bob):
    out = run(
        PROBE
        + f"os.symlink({str(bob / 'secret.txt')!r}, 'link.txt')\n"
        + "print(try_(lambda: open('link.txt').read()))"
    )
    assert out["stdout"].strip() == "denied", out


def test_credentials_arrive_as_env_but_their_files_stay_closed(run, folder):
    creds = ROOT / f"test-creds-{uuid.uuid4().hex[:8]}"
    creds.mkdir()
    try:
        (creds / "warehouse.env").write_text("WAREHOUSE_DSN=postgres://x\n")
        (folder / ".env.d").mkdir()
        (folder / ".env.d" / "warehouse.env").symlink_to(creds / "warehouse.env")
        result = probe(
            run,
            {
                "env": "os.environ['WAREHOUSE_DSN']",
                "file": "open('.env.d/warehouse.env').read()",
                "domains": "os.listdir('/domains')",
            },
        )
        assert result == {"env": "ok", "file": "denied", "domains": "denied"}
    finally:
        shutil.rmtree(creds, ignore_errors=True)


def test_execd_environment_is_not_readable(run):
    # execd holds EXECD_TOKEN; Landlock also blocks ptrace-class access such as /proc/<pid>/environ
    result = probe(run, {"environ": "open(f'/proc/{os.getppid()}/environ').read()"})
    assert result == {"environ": "denied"}


def test_uv_uses_the_shared_cache_inside_the_sandbox(run, folder):
    (folder / "pyproject.toml").write_text(
        '[project]\nname = "agent"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n'
        "dependencies = []\n\n[tool.uv]\npackage = false\n"
    )
    git(folder, "add", "-A")
    out = run(argv=["uv", "sync"], timeout_s=120)
    assert out["exit_code"] == 0, out["stderr"]
    assert (folder / ".venv" / "bin" / "python").exists()
    out = run(argv=["uv", "add", "idna==3.10"], timeout_s=300)
    assert out["exit_code"] == 0, out["stderr"]
    assert run("import idna; print(idna.__version__)")["stdout"].strip() == "3.10"
