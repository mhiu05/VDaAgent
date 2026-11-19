"""The read-only folder viewer (doc 04 "Folder viewer").

Every path is resolved under the agent folder; `..`, absolute paths, NUL bytes and symlinks that
leave the folder are refused (400 `invalid_path`). `.env.d/*.env` (links into the domain's
credentials) are the one exception: they are shown, always with values redacted. `.venv/` is
listed collapsed and can't be expanded. `at=<commit>` reads from git instead of the worktree.
"""

from __future__ import annotations

import io
import os
import re
import stat
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from backend.agents.gitops import GitError, run_sync

TEXT_LIMIT = 1024 * 1024
REDACTED = "••••"
COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")
IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}
EXEC_MSG_RE = re.compile(r"^exec (x_\S+)")
COLLAPSED = ".venv"


class ViewerError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class FileResult:
    body: bytes
    media_type: str
    attachment: bool
    filename: str


# --- paths ----------------------------------------------------------------------------------


def parts_of(path: str | None) -> list[str]:
    path = path or ""
    if "\x00" in path or path.startswith("/") or "\\" in path:
        raise ViewerError(400, "invalid_path")
    parts = [p for p in path.split("/") if p not in ("", ".")]
    if ".." in parts or (parts and parts[0] == ".git"):
        raise ViewerError(400, "invalid_path")
    return parts


def is_credential_link(parts: list[str]) -> bool:
    return len(parts) == 2 and parts[0] == ".env.d" and parts[1].endswith(".env")


def resolve(folder: Path, parts: list[str]) -> Path:
    """The real path for `parts`, refusing anything that leaves the folder."""
    root = folder.resolve()
    current = root
    for i, part in enumerate(parts):
        candidate = current / part
        if candidate.is_symlink():
            if i == len(parts) - 1 and is_credential_link(parts):
                return candidate
            target = candidate.resolve()
            if target != root and root not in target.parents:
                raise ViewerError(400, "invalid_path")
            current = target
        else:
            current = candidate
    if not current.exists() and not current.is_symlink():
        raise ViewerError(404, "not_found")
    return current


def redact(text: str) -> str:
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if s and not s.startswith("#") and "=" in s:
            key = s.split("=", 1)[0].removeprefix("export ").strip()
            lines.append(f"{key}={REDACTED}")
    return "".join(f"{line}\n" for line in lines)


def _read_credential(link: Path) -> bytes:
    try:
        return redact(link.read_text(encoding="utf-8", errors="replace")).encode()
    except OSError:
        return b""  # dangling link: nothing to show


def _check_commit(folder: Path, at: str) -> str:
    if not COMMIT_RE.fullmatch(at):
        raise ViewerError(400, "invalid_commit")
    try:
        return run_sync(folder, "rev-parse", "--verify", "-q", f"{at}^{{commit}}").strip()
    except GitError:
        raise ViewerError(404, "not_found") from None


def _classify(name: str, body: bytes) -> FileResult:
    suffix = Path(name).suffix.lower()
    if suffix in IMAGE_TYPES:
        return FileResult(body, IMAGE_TYPES[suffix], False, name)
    if len(body) <= TEXT_LIMIT and b"\x00" not in body:
        try:
            body.decode("utf-8")
            return FileResult(body, "text/plain; charset=utf-8", False, name)
        except UnicodeDecodeError:
            pass
    return FileResult(body, "application/octet-stream", True, name)


# --- tree -----------------------------------------------------------------------------------


def _dir_size(path: Path) -> int:
    total = 0
    for dirpath, _dirs, files in os.walk(path):
        for f in files:
            p = os.path.join(dirpath, f)
            if not os.path.islink(p):
                total += os.path.getsize(p)
    return total


def _entry(path: Path) -> dict:
    st = path.lstat()
    mtime = datetime.fromtimestamp(st.st_mtime, UTC).isoformat()
    if stat.S_ISLNK(st.st_mode):
        return {
            "name": path.name,
            "type": "symlink",
            "size": None,
            "mtime": mtime,
            "items": None,
            "symlink_target": os.readlink(path),
        }
    if stat.S_ISDIR(st.st_mode):
        if path.name == COLLAPSED and path.parent.name != COLLAPSED:
            return {
                "name": path.name,
                "type": "dir",
                "size": None,
                "mtime": mtime,
                "items": None,
                "symlink_target": None,
            }
        return {
            "name": path.name,
            "type": "dir",
            "size": _dir_size(path),
            "mtime": mtime,
            "items": len(os.listdir(path)),
            "symlink_target": None,
        }
    return {
        "name": path.name,
        "type": "file",
        "size": st.st_size,
        "mtime": mtime,
        "items": None,
        "symlink_target": None,
    }


def _ls_tree(folder: Path, commit: str, parts: list[str]) -> list[dict]:
    prefix = "/".join(parts)
    spec = [f"{prefix}/"] if prefix else []
    out = run_sync(folder, "ls-tree", "-r", "-t", "-l", "-z", commit, "--", *spec)
    entries: dict[str, dict] = {}
    depth = len(parts)
    for record in out.split("\0"):
        if not record:
            continue
        meta, name = record.split("\t", 1)
        mode, kind, obj, size = meta.split()
        rel = name.split("/")[depth:]
        if not rel:
            continue
        top = rel[0]
        if len(rel) == 1:
            if kind == "tree":
                entries[top] = {
                    "name": top,
                    "type": "dir",
                    "size": 0,
                    "mtime": None,
                    "items": 0,
                    "symlink_target": None,
                }
            elif mode == "120000":
                target = run_sync(folder, "cat-file", "-p", obj)
                entries[top] = {
                    "name": top,
                    "type": "symlink",
                    "size": None,
                    "mtime": None,
                    "items": None,
                    "symlink_target": target,
                }
            else:
                entries[top] = {
                    "name": top,
                    "type": "file",
                    "size": int(size),
                    "mtime": None,
                    "items": None,
                    "symlink_target": None,
                }
        else:
            parent = entries.get(top)
            if parent is not None:
                if len(rel) == 2:
                    parent["items"] += 1
                if kind == "blob" and size != "-":
                    parent["size"] += int(size)
    return list(entries.values())


def list_tree(folder: Path, path: str | None = "", at: str | None = None) -> list[dict]:
    parts = parts_of(path)
    if parts and parts[0] == COLLAPSED:
        raise ViewerError(400, "not_expandable")
    if at:
        commit = _check_commit(folder, at)
        if parts:
            kind = _object_type(folder, commit, parts)
            if kind is None:
                raise ViewerError(404, "not_found")
            if kind != "tree":
                raise ViewerError(400, "not_a_directory")
        return sorted(_ls_tree(folder, commit, parts), key=_order)
    target = resolve(folder, parts)
    if not target.is_dir():
        raise ViewerError(400, "not_a_directory")
    children = [c for c in target.iterdir() if not (not parts and c.name == ".git")]
    return sorted((_entry(c) for c in children), key=_order)


def _order(entry: dict) -> tuple[int, str]:
    return (0 if entry["type"] == "dir" else 1, entry["name"])


def _object_type(folder: Path, commit: str, parts: list[str]) -> str | None:
    try:
        return run_sync(folder, "cat-file", "-t", f"{commit}:{'/'.join(parts)}").strip()
    except GitError:
        return None


# --- file -----------------------------------------------------------------------------------


def read_file(folder: Path, path: str | None, at: str | None = None) -> FileResult:
    parts = parts_of(path)
    if not parts:
        raise ViewerError(400, "not_a_file")
    if parts[0] == COLLAPSED:
        raise ViewerError(400, "not_expandable")
    name = parts[-1]
    if at:
        commit = _check_commit(folder, at)
        kind = _object_type(folder, commit, parts)
        if kind is None:
            raise ViewerError(404, "not_found")
        if kind != "blob":
            raise ViewerError(400, "not_a_file")
        body = run_sync(folder, "cat-file", "-p", f"{commit}:{'/'.join(parts)}", binary=True)
        return _classify(name, body)
    target = resolve(folder, parts)
    if is_credential_link(parts):
        return FileResult(_read_credential(target), "text/plain; charset=utf-8", False, name)
    if not target.is_file():
        raise ViewerError(400, "not_a_file")
    return _classify(name, target.read_bytes())


# --- archive --------------------------------------------------------------------------------


def _worktree_files(folder: Path, parts: list[str]):
    """(archive path, bytes) for every file under `parts`, without `.venv/` and `.git/`."""
    root = folder.resolve()
    base = resolve(folder, parts)
    if base.is_file():
        yield "/".join(parts), base.read_bytes()
        return
    for dirpath, dirs, files in os.walk(base):
        rel_dir = Path(dirpath).relative_to(root)
        dirs[:] = [d for d in dirs if not (rel_dir == Path(".") and d in (".git", COLLAPSED))]
        for f in sorted(files) + [d for d in dirs if os.path.islink(os.path.join(dirpath, d))]:
            p = Path(dirpath) / f
            rel = (rel_dir / f).as_posix()
            rel_parts = rel.split("/")
            if p.is_symlink():
                if is_credential_link(rel_parts):
                    yield rel, _read_credential(p)
                    continue
                target = p.resolve()
                if root in target.parents and target.is_file():
                    yield rel, target.read_bytes()
                continue  # escaping or dangling links are left out
            if p.is_file():
                yield rel, p.read_bytes()


def _commit_files(folder: Path, commit: str, parts: list[str]):
    prefix = "/".join(parts)
    spec = [prefix] if prefix else []
    out = run_sync(folder, "ls-tree", "-r", "-z", commit, "--", *spec)
    for record in out.split("\0"):
        if not record:
            continue
        meta, name = record.split("\t", 1)
        mode, kind, obj = meta.split()
        if kind != "blob" or mode == "120000" or name.split("/")[0] == COLLAPSED:
            continue
        yield name, run_sync(folder, "cat-file", "-p", obj, binary=True)


def archive(folder: Path, path: str | None = "", at: str | None = None) -> bytes:
    parts = parts_of(path)
    if parts and parts[0] == COLLAPSED:
        raise ViewerError(400, "not_expandable")
    if at:
        commit = _check_commit(folder, at)
        if parts and _object_type(folder, commit, parts) is None:
            raise ViewerError(404, "not_found")
        files = _commit_files(folder, commit, parts)
    else:
        files = _worktree_files(folder, parts)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            z.writestr(name, data)
    return buf.getvalue()


# --- history --------------------------------------------------------------------------------


def log(folder: Path, path: str | None = "", limit: int = 50) -> list[dict]:
    parts = parts_of(path)
    limit = max(1, min(int(limit), 500))
    spec = ["--", "/".join(parts)] if parts else []
    out = run_sync(folder, "log", f"-n{limit}", "--format=%H%x1f%an%x1f%s%x1f%aI%x1e", *spec)
    entries = []
    for record in out.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        commit, author, message, at = record.split("\x1f")
        m = EXEC_MSG_RE.match(message)
        entries.append(
            {
                "commit": commit,
                "author": author,
                "message": message,
                "at": at,
                "exec_id": m.group(1) if m else None,
            }
        )
    return entries


def diff(folder: Path, commit: str | None) -> str:
    if not commit:
        raise ViewerError(400, "invalid_commit")
    sha = _check_commit(folder, commit)
    return run_sync(
        folder,
        "show",
        "--no-color",
        "--no-ext-diff",
        "--format=commit %H%nauthor %an%ndate %aI%n%n    %s%n",
        "--patch",
        sha,
    )
