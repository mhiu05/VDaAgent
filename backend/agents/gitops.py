"""git in an agent folder, from the api side (doc 04 "Git snapshots": commits api makes itself).

Every commit names its author with the same rules as execd: `contoso-harness` for platform
actions, `user:<username>` for builder actions. Callers hold the agent's job lock.
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

from workspace.execd import git_sandbox

HARNESS = "contoso-harness"
_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "LANG": "C.UTF-8",
    "HOME": "/tmp",
    "GIT_TERMINAL_PROMPT": "0",
}


class GitError(Exception):
    pass


def run_sync(folder: Path, *args: str, ok: tuple[int, ...] = (0,), binary: bool = False):
    """Blocking git; returns stdout (bytes if `binary`)."""
    try:
        proc = git_sandbox.run(folder, *args, env=_ENV)
    except (OSError, subprocess.SubprocessError) as e:
        raise GitError(str(e)) from e
    if proc.returncode not in ok:
        raise GitError(proc.stderr.decode("utf-8", "replace").strip() or f"git {args[0]} failed")
    return proc.stdout if binary else proc.stdout.decode("utf-8", "replace")


async def run(folder: Path, *args: str, ok: tuple[int, ...] = (0,)) -> str:
    return await asyncio.to_thread(run_sync, folder, *args, ok=ok)


def _identity(author: str) -> list[str]:
    return ["-c", f"user.name={author}", "-c", f"user.email={author}@contoso.local"]


async def init(folder: Path) -> None:
    await run(folder, "init", "-q", "-b", "main")


async def head(folder: Path) -> str:
    return (await run(folder, "rev-parse", "HEAD")).strip()


async def commit_all(folder: Path, author: str, message: str) -> str | None:
    """`git add -A` and commit if anything changed; returns the new HEAD or None."""
    await run(folder, "add", "-A")
    if (
        await asyncio.to_thread(
            lambda: git_sandbox.run(folder, "diff", "--cached", "--quiet", env=_ENV).returncode
        )
        == 0
    ):
        return None
    await run(folder, *_identity(author), "commit", "-q", "--no-verify", "-m", message)
    return await head(folder)


async def restore_to(folder: Path, commit: str) -> None:
    """Make the worktree match `commit`, keeping ignored paths (doc 04 "Reset")."""
    await run(folder, "restore", f"--source={commit}", "--staged", "--worktree", ":/")
    await run(folder, "clean", "-fdq", "-e", ".venv", "-e", ".env.d", "-e", ".contoso")
