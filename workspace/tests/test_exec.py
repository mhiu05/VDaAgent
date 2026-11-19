"""`POST /exec` (doc 11 "`execd` API") and the execd tests listed in doc 17."""

from __future__ import annotations

import os
import time
import uuid

from conftest import ROOT


def _body(folder, **kw):
    return {
        "folder": str(folder),
        "exec_id": f"x_{uuid.uuid4().hex}",
        "timeout_s": 30,
        "author": "agent:data",
        **kw,
    }


# --- auth and request validation ------------------------------------------------------------


def test_exec_needs_the_bearer_token(client, folder):
    r = client.post("/exec", json=_body(folder, code="print(1)"), headers={"Authorization": ""})
    assert r.status_code == 401
    assert r.json()["error"] == "unauthenticated"
    r = client.post(
        "/exec", json=_body(folder, code="print(1)"), headers={"Authorization": "Bearer wrong"}
    )
    assert r.status_code == 401


def test_exec_refuses_when_no_token_is_configured(client, folder, monkeypatch):
    monkeypatch.setenv("EXECD_TOKEN", "")
    r = client.post(
        "/exec", json=_body(folder, code="print(1)"), headers={"Authorization": "Bearer "}
    )
    assert r.status_code == 401


def test_exactly_one_of_code_and_argv(client, folder):
    assert client.post("/exec", json=_body(folder)).status_code == 400
    r = client.post("/exec", json=_body(folder, code="print(1)", argv=["true"]))
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_request"


def test_folder_must_be_under_the_root_and_a_git_repo(client, folder, tmp_path):
    assert client.post("/exec", json=_body("/etc", code="print(1)")).status_code == 400
    escape = folder / ".." / ".." / ".."
    assert client.post("/exec", json=_body(escape, code="1")).status_code == 400
    no_git = ROOT / f"test-{uuid.uuid4().hex[:8]}"
    no_git.mkdir()
    try:
        r = client.post("/exec", json=_body(no_git, code="print(1)"))
        assert r.status_code == 400
        assert r.json()["error"] == "invalid_folder"
    finally:
        no_git.rmdir()
    # a symlink inside the root pointing outside it is refused too
    link = ROOT / f"test-{uuid.uuid4().hex[:8]}"
    link.symlink_to(tmp_path)
    try:
        assert client.post("/exec", json=_body(link, code="print(1)")).status_code == 400
    finally:
        link.unlink()


# --- running code ---------------------------------------------------------------------------


def test_code_runs_in_the_folder(run, folder):
    out = run("import os; print(os.getcwd()); print(os.environ['HOME'])")
    assert out["exit_code"] == 0
    assert out["stdout"].splitlines() == [str(folder), str(folder)]
    assert out["timed_out"] is False and out["truncated"] is False
    assert isinstance(out["duration_ms"], int)


def test_nonzero_exit_and_stderr(run):
    out = run("import sys; print('boom', file=sys.stderr); sys.exit(3)")
    assert out["exit_code"] == 3
    assert "boom" in out["stderr"]


def test_argv_runs_with_the_folder_venv_on_path(run, folder):
    out = run(argv=["sh", "-c", 'echo "$PATH"'])
    assert out["stdout"].strip().split(":")[0] == f"{folder}/.venv/bin"


def test_code_uses_the_folder_venv_python_when_present(run, folder):
    venv_bin = folder / ".venv" / "bin"
    venv_bin.mkdir(parents=True)
    (venv_bin / "python").symlink_to("/usr/local/bin/python3")
    out = run("import sys; print(sys.argv[0], sys.executable)")
    assert out["exit_code"] == 0
    assert str(venv_bin / "python") in out["stdout"]


def test_contoso_and_folder_helpers_are_importable(run, folder):
    (folder / "helpers").mkdir()
    (folder / "helpers" / "__init__.py").write_text("X = 42\n")
    out = run("import contoso, helpers; print(helpers.X, hasattr(contoso, 'send_to_user'))")
    assert out["stdout"].strip() == "42 True"


# --- environment ----------------------------------------------------------------------------


def test_environment_is_built_from_scratch(run, folder, monkeypatch):
    monkeypatch.setenv("PARENT_ONLY_SECRET", "leak")
    monkeypatch.setenv("UV_HTTP_TIMEOUT", "300")
    (folder / ".env.d").mkdir()
    (folder / ".env.d" / "a.env").write_text("WAREHOUSE_DSN=postgres://x\nSHARED=a\n")
    (folder / ".env.d" / "b.env").write_text("# c\nTAVILY_API_KEY='k $HOME'\nSHARED=b\n")
    out = run(
        "import os, json; print(json.dumps(dict(os.environ)))",
        env_extra={"CONTOSO_API_URL": "http://api:8001", "SHARED": "extra"},
    )
    import json

    env = json.loads(out["stdout"])
    assert "PARENT_ONLY_SECRET" not in env
    assert "EXECD_TOKEN" not in env
    assert env["WAREHOUSE_DSN"] == "postgres://x"
    assert env["TAVILY_API_KEY"] == "k $HOME"  # no interpolation
    assert env["SHARED"] == "extra"  # env_extra wins over .env.d, b.env over a.env
    assert env["CONTOSO_API_URL"] == "http://api:8001"
    assert env["HOME"] == str(folder)
    assert env["LANG"] == "C.UTF-8"
    assert env["TZ"] == "Asia/Ho_Chi_Minh"
    assert env["PYTHONPATH"] == "/opt"
    assert env["PYTHONUNBUFFERED"] == "1"
    assert env["UV_CACHE_DIR"] and env["UV_LINK_MODE"]
    assert env["UV_HTTP_TIMEOUT"] == "300"  # passed through for slow package downloads


def test_env_d_files_load_in_name_order(run, folder):
    (folder / ".env.d").mkdir()
    (folder / ".env.d" / "b.env").write_text("K=b\n")
    (folder / ".env.d" / "a.env").write_text("K=a\n")
    assert run("import os; print(os.environ['K'])")["stdout"].strip() == "b"


# --- limits ---------------------------------------------------------------------------------


def _gone(pid: int, wait_s: float = 3.0) -> bool:
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        # a zombie still answers kill(0); check its state
        try:
            with open(f"/proc/{pid}/stat") as f:
                if f.read().split()[2] == "Z":
                    return True
        except FileNotFoundError:
            return True
        time.sleep(0.05)
    return False


SPAWN_SLEEPER = (
    "import subprocess, time\n"
    "p = subprocess.Popen(['sleep', '1000'])\n"
    "open('outputs_pid', 'w').write(str(p.pid))\n"
)


def test_timeout_kills_the_whole_process_group(run, folder):
    out = run(SPAWN_SLEEPER + "time.sleep(100)\n", timeout_s=1)
    assert out["timed_out"] is True
    assert out["exit_code"] != 0
    assert _gone(int((folder / "outputs_pid").read_text()))


def test_background_children_die_when_the_exec_ends(run, folder):
    out = run(SPAWN_SLEEPER)
    assert out["exit_code"] == 0 and out["timed_out"] is False
    assert _gone(int((folder / "outputs_pid").read_text()))


def test_rlimit_as_makes_a_large_allocation_fail(run):
    out = run("x = bytearray(6 * 1024**3)\nprint('allocated')")
    assert out["exit_code"] != 0
    assert "MemoryError" in out["stderr"]


def test_output_over_the_cap_is_truncated_with_the_marker(run):
    out = run("import sys; sys.stdout.write('a' * (11 * 1024 * 1024)); sys.stderr.write('ok')")
    assert out["truncated"] is True
    assert out["stdout"].endswith("\n[... truncated by execd at 10 MB]")
    assert len(out["stdout"]) == 10 * 1024 * 1024 + len("\n[... truncated by execd at 10 MB]")
    assert out["stderr"] == "ok"
