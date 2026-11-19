"""Attachments (doc 08 "User attachments", "`send_to_user`").

- At most `MAX_COUNT` files of at most `MAX_BYTES` each per message (400 `invalid_file`,
  413 `file_too_large`).
- Stored once in `<ATTACHMENTS_DIR>/<message_id>/<name>` with `sha256`, so later edits in a
  folder don't change what was sent.
- Copied into each receiving agent's `files/inbox/m_<message_id>/<name>`. The copy is committed
  with author `contoso-harness` when the receiver's job lock is free; if the receiver is in the
  middle of an exec, its next snapshot commits the copy (waiting for the lock here could deadlock
  two agents messaging each other mid-exec).
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from backend.agents import gitops
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.harness.items import inbox_path

MAX_BYTES = 20 * 1024 * 1024
MAX_COUNT = 10
log = logging.getLogger("contoso.messaging")


@dataclass
class Incoming:
    filename: str
    mime: str
    source: Path | None = None  # a file in an agent folder
    data: bytes | None = None  # an upload


@dataclass
class Stored:
    id: uuid.UUID
    filename: str
    path: Path


def safe_name(name: str) -> str:
    name = Path(name.replace("\\", "/")).name
    name = re.sub(r"[\x00-\x1f\x7f/]", "", name).strip().lstrip(".")
    return name[:200] or "file"


def unique_names(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for name in names:
        n = seen.get(name, 0)
        seen[name] = n + 1
        if n:
            stem, dot, ext = name.rpartition(".")
            name = f"{stem} ({n + 1}).{ext}" if dot and stem else f"{name} ({n + 1})"
        out.append(name)
    return out


def guess_mime(name: str, given: str | None = None) -> str:
    if given and given != "application/octet-stream":
        return given
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def check_count(n: int) -> None:
    if n > MAX_COUNT:
        raise ApiError(400, "invalid_file", f"Tối đa {MAX_COUNT} tệp mỗi tin nhắn.")


def from_folder(folder: Path, paths: list[str]) -> list[Incoming]:
    """Folder-relative paths an agent wants to send; each must exist inside the folder."""
    check_count(len(paths))
    root = Path(folder).resolve()
    files = []
    for rel in paths:
        if not isinstance(rel, str) or not rel or rel.startswith("/") or "\x00" in rel:
            raise ApiError(400, "invalid_file", f"Đường dẫn không hợp lệ: {rel}")
        path = (root / rel).resolve()
        if root not in path.parents or not path.is_file():
            raise ApiError(400, "invalid_file", f"Không tìm thấy tệp: {rel}")
        if path.stat().st_size > MAX_BYTES:
            raise ApiError(413, "file_too_large", f"Tệp quá lớn: {rel}")
        files.append(
            Incoming(filename=safe_name(path.name), mime=guess_mime(path.name), source=path)
        )
    return files


def from_upload(items: list[tuple[str, bytes, str | None]]) -> list[Incoming]:
    check_count(len(items))
    files = []
    for name, data, mime in items:
        if len(data) > MAX_BYTES:
            raise ApiError(413, "file_too_large", f"Tệp quá lớn: {name}")
        filename = safe_name(name)
        files.append(Incoming(filename=filename, mime=guess_mime(filename, mime), data=data))
    return files


async def store(
    conn: AsyncConnection, settings: Any, message_id: int, files: list[Incoming]
) -> list[Stored]:
    """Write the files under `ATTACHMENTS_DIR/<message_id>/` and insert `attachments` rows."""
    if not files:
        return []
    directory = Path(settings.ATTACHMENTS_DIR) / str(message_id)
    directory.mkdir(parents=True, exist_ok=True)
    stored = []
    for f, name in zip(files, unique_names([f.filename for f in files]), strict=True):
        path = directory / name
        if f.source is not None:
            shutil.copyfile(f.source, path)
        else:
            path.write_bytes(f.data or b"")
        data = path.read_bytes()
        att_id = await conn.scalar(
            t.attachments.insert()
            .values(
                message_id=message_id,
                filename=name,
                mime=f.mime,
                size=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
                path=str(path),
            )
            .returning(t.attachments.c.id)
        )
        stored.append(Stored(id=att_id, filename=name, path=path))
    return stored


async def copy_to_inboxes(
    harness: Any, receivers: list[Any], message_id: int, stored: list[Stored]
) -> None:
    for agent in receivers:
        folder = harness.folder(agent)
        if not folder.is_dir():
            continue
        for s in stored:
            dest = folder / inbox_path(message_id, s.filename)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(s.path, dest)
        lock = harness.job_lock(agent.id)
        if (folder / ".git").exists() and not lock.locked():
            async with lock:
                try:
                    await gitops.commit_all(folder, gitops.HARNESS, f"inbox m_{message_id}")
                except gitops.GitError as e:  # the next snapshot picks the files up
                    log.warning("inbox commit failed for %s: %s", agent.slug, e)
