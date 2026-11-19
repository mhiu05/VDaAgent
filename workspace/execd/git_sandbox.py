"""Run Git over agent-controlled repositories inside the folder's filesystem boundary.

Repository config and attributes can launch programs even when commit hooks are disabled.
Those programs must inherit the same Landlock restrictions as generated agent code.
"""

from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import sys
from pathlib import Path


def run(folder: Path, *args: str, env: dict[str, str]) -> subprocess.CompletedProcess:
    ruleset_fd = None
    if sys.platform == "linux":
        from . import landlock

        mode = os.environ.get("EXEC_FS_ISOLATION", "auto")
        version = landlock.abi()
        if mode != "off" and version >= 2:
            ruleset_fd = landlock.ruleset(folder.resolve(), None, version)
        elif mode == "required":
            raise OSError("Landlock is unavailable and EXEC_FS_ISOLATION=required")

    def restrict() -> None:
        if ruleset_fd is not None:
            landlock.restrict(ruleset_fd)

    command = [
        "git",
        "-c",
        f"safe.directory={folder.resolve()}",
        "-c",
        f"core.hooksPath={os.devnull}",
        "-c",
        "core.fsmonitor=false",
        *args,
    ]
    clean_env = {**env, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
    try:
        proc = subprocess.Popen(
            command,
            cwd=folder,
            env=clean_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=sys.platform != "win32",
            preexec_fn=restrict if sys.platform == "linux" else None,
        )
    finally:
        if ruleset_fd is not None:
            os.close(ruleset_fd)
    try:
        out, err = proc.communicate(timeout=30)
        return subprocess.CompletedProcess(command, proc.returncode, out, err)
    finally:
        if sys.platform != "win32":
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
        elif proc.poll() is None:
            proc.kill()
        proc.wait()
