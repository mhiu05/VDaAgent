"""Running one exec: environment, rlimits, output caps and the wall clock (doc 11)."""

from __future__ import annotations

import asyncio
import contextlib
import functools
import os
import resource
import signal
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

from execd import landlock

GIB = 1024**3
DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin"


def folders_root() -> Path:
    return Path(os.environ.get("EXECD_FOLDERS_ROOT", "/data/folders"))


def max_output_bytes() -> int:
    return int(os.environ.get("EXEC_MAX_OUTPUT_BYTES") or DEFAULT_MAX_OUTPUT_BYTES)


def truncation_marker(cap: int) -> str:
    mb = cap / (1024 * 1024)
    size = f"{mb:g} MB" if mb >= 1 else f"{cap} bytes"
    return f"\n[... truncated by execd at {size}]"


@functools.cache
def landlock_abi() -> int:
    return landlock.abi()


def isolation() -> str:
    """`EXEC_FS_ISOLATION`: `auto` (default: Landlock when the kernel has it), `required` (refuse
    to run without it) or `off`. Returns what applies: `landlock`, `unavailable` or `off`.

    ABI 1 has no `REFER` right (added in ABI 2, kernel >= 5.19): without it, the kernel denies
    every `rename()`/`link()` under the sandbox with EXDEV, breaking `uv add`/`uv sync` (which
    renames into their cache) on kernels like WSL2's 5.15. So ABI 1 counts as unavailable too.
    """
    mode = os.environ.get("EXEC_FS_ISOLATION") or "auto"
    if mode == "off":
        return "off"
    return "landlock" if landlock_abi() >= 2 else "unavailable"


def resolve_folder(folder: str) -> Path | None:
    """The folder's real path if it is strictly under the root and is a git repo."""
    root = folders_root().resolve()
    real = Path(folder).resolve()
    if real == root or root not in real.parents:
        return None
    if not (real / ".git").exists():
        return None
    return real


def build_env(folder: Path, env_extra: dict[str, str] | None) -> dict[str, str]:
    """From scratch: base keys, then `.env.d/*.env` in name order, then `env_extra`."""
    env = {
        "PATH": f"{folder}/.venv/bin:{SYSTEM_PATH}",
        "HOME": str(folder),
        "LANG": "C.UTF-8",
        "TZ": "Asia/Ho_Chi_Minh",
        "PYTHONPATH": "/opt",
        "PYTHONUNBUFFERED": "1",
        "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", "/data/folders/.uv-cache"),
        "UV_LINK_MODE": os.environ.get("UV_LINK_MODE", "hardlink"),
    }
    # uv knobs set on the workspace service (UV_HTTP_TIMEOUT: slow first package downloads)
    for key in ("UV_PYTHON_DOWNLOADS", "UV_HTTP_TIMEOUT"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    env_d = folder / ".env.d"
    if env_d.is_dir():
        for path in sorted(env_d.glob("*.env")):
            try:
                values = dotenv_values(path, interpolate=False)
            except OSError:
                continue  # a dangling credential link; validation reports it elsewhere
            env.update({k: v for k, v in values.items() if v is not None})
    env.update({str(k): str(v) for k, v in (env_extra or {}).items()})
    return env


def command(folder: Path, code: str | None, argv: list[str] | None) -> list[str]:
    if code is not None:
        venv_python = folder / ".venv" / "bin" / "python"
        return [str(venv_python) if venv_python.exists() else "python3", "-c", code]
    assert argv
    return list(argv)


def _limits(mem_mb: int, ruleset_fd: int | None = None):
    def apply() -> None:
        resource.setrlimit(resource.RLIMIT_AS, (mem_mb * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_FSIZE, (GIB, GIB))
        if ruleset_fd is not None:
            landlock.restrict(ruleset_fd)  # an error here fails the exec (fail closed)

    return apply


def _ruleset(folder: Path, env: dict[str, str]) -> int | None:
    """The Landlock ruleset fd for this exec, or None when isolation is off/unavailable."""
    state = isolation()
    if state == "unavailable" and os.environ.get("EXEC_FS_ISOLATION") == "required":
        raise landlock.LandlockError(0, "Landlock is unavailable and EXEC_FS_ISOLATION=required")
    if state != "landlock":
        return None
    cache = Path(env["UV_CACHE_DIR"]) if env.get("UV_CACHE_DIR") else None
    if cache is not None:
        cache.mkdir(parents=True, exist_ok=True)
    return landlock.ruleset(folder, cache, landlock_abi())


@dataclass
class RunResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool
    truncated: bool


def _read_capped(stream, cap: int, out: list) -> None:
    kept = bytearray()
    over = False
    while chunk := stream.read(65536):
        room = cap - len(kept)
        if room > 0:
            kept += chunk[:room]
        if len(chunk) > max(room, 0):
            over = True
    out.extend([bytes(kept), over])


def _killpg(pgid: int) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pgid, signal.SIGKILL)


def _run_blocking(
    folder: Path, argv: list[str], env: dict[str, str], timeout_s: float, mem_mb: int
) -> RunResult:
    cap = max_output_bytes()
    start = time.monotonic()
    try:
        ruleset_fd = _ruleset(folder, env)
    except landlock.LandlockError as e:
        return RunResult(126, "", f"execd: filesystem isolation failed: {e}", 0, False, False)
    try:
        proc = subprocess.Popen(
            argv,
            cwd=folder,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            preexec_fn=_limits(mem_mb, ruleset_fd),
        )
    except subprocess.SubprocessError as e:  # the sandbox couldn't be applied in the child
        return RunResult(126, "", f"execd: could not start the exec: {e}", 0, False, False)
    finally:
        if ruleset_fd is not None:
            os.close(ruleset_fd)
    pgid = proc.pid  # start_new_session makes the child its own group leader
    results: tuple[list, list] = ([], [])
    readers = [
        threading.Thread(target=_read_capped, args=(proc.stdout, cap, results[0]), daemon=True),
        threading.Thread(target=_read_capped, args=(proc.stderr, cap, results[1]), daemon=True),
    ]
    for t in readers:
        t.start()
    timed_out = False
    try:
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
    # Either way, nothing in the group outlives the exec (doc 11 step 6).
    _killpg(pgid)
    proc.wait()
    for t in readers:
        t.join(timeout=10)  # a process that escaped the group may still hold a pipe
    out, out_over = results[0] or [b"", False]
    err, err_over = results[1] or [b"", False]
    for stream in (proc.stdout, proc.stderr):
        with contextlib.suppress(OSError):
            stream.close()
    marker = truncation_marker(cap)
    return RunResult(
        exit_code=proc.returncode,
        stdout=out.decode("utf-8", "replace") + (marker if out_over else ""),
        stderr=err.decode("utf-8", "replace") + (marker if err_over else ""),
        duration_ms=int((time.monotonic() - start) * 1000),
        timed_out=timed_out,
        truncated=out_over or err_over,
    )


async def run(
    folder: Path, argv: list[str], env: dict[str, str], timeout_s: float, mem_mb: int
) -> RunResult:
    return await asyncio.to_thread(_run_blocking, folder, argv, env, timeout_s, mem_mb)
