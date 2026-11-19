"""Git snapshot after every exec (doc 04 "Git snapshots")."""

from __future__ import annotations

import asyncio
import subprocess
from dataclasses import dataclass
from pathlib import Path

from execd import git_sandbox

# git runs with execd's own environment plus a fixed identity source; never the exec's env.
_GIT_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "LANG": "C.UTF-8",
    "HOME": "/tmp",
    "GIT_TERMINAL_PROMPT": "0",
}


class GitError(Exception):
    pass


async def git(folder: Path, *args: str, ok_codes: tuple[int, ...] = (0,)) -> tuple[int, str]:
    try:
        proc = await asyncio.to_thread(git_sandbox.run, folder, *args, env=_GIT_ENV)
    except (OSError, subprocess.SubprocessError) as e:
        raise GitError(str(e)) from e
    out, err = proc.stdout, proc.stderr
    if proc.returncode not in ok_codes:
        msg = err.decode("utf-8", "replace").strip() or f"git {args[0]} exited {proc.returncode}"
        raise GitError(msg)
    return proc.returncode, out.decode("utf-8", "replace")


async def current_head(folder: Path) -> str | None:
    try:
        return (await git(folder, "rev-parse", "--verify", "-q", "HEAD"))[1].strip() or None
    except GitError:
        return None


@dataclass
class Snapshot:
    head: str | None
    changed: list[dict[str, str]] | None
    snapshot_error: str | None


def _parse_name_status(text: str) -> list[dict[str, str]]:
    changed = []
    for line in text.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0][0]  # R100 → R, C075 → C
        changed.append({"path": parts[-1], "status": status})
    return changed


async def take(folder: Path, old_head: str | None, author: str, exec_id: str) -> Snapshot:
    try:
        await git(folder, "add", "-A")
        code, _ = await git(folder, "diff", "--cached", "--quiet", ok_codes=(0, 1))
        if code == 1:
            await git(
                folder,
                "-c",
                f"user.name={author}",
                "-c",
                f"user.email={author}@contoso.local",
                "commit",
                "-q",
                "--no-verify",
                "-m",
                f"exec {exec_id}",
            )
        head = await current_head(folder)
        if head is None:
            raise GitError("no HEAD after snapshot")
        if head == old_head:
            return Snapshot(head=head, changed=[], snapshot_error=None)
        if old_head is None:
            _, out = await git(
                folder, "diff-tree", "--root", "--no-commit-id", "-r", "-M", "--name-status", head
            )
        else:
            _, out = await git(folder, "diff", "-M", "--name-status", old_head, head)
        return Snapshot(head=head, changed=_parse_name_status(out), snapshot_error=None)
    except GitError as e:
        return Snapshot(head=None, changed=None, snapshot_error=str(e)[:2000])
