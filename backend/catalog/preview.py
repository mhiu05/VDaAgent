"""Skill preview before install (doc 05 "Preview before install").

The tarball named by a catalog row's `install_cmd` is downloaded from `SKILLS_CODELOAD_URL`
(GitHub's codeload, or the `fixtures` server in tests), and only `SKILL.md` and the file list
under the skill's path are kept, cached on disk under `<CACHE_DIR>/skills/<sha>/`.
"""

from __future__ import annotations

import hashlib
import io
import json
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any

import httpx

from backend.api.errors import ApiError

MAX_DOWNLOAD = 50 * 1024 * 1024
CODE_SUFFIXES = (".py", ".sh", ".js")
TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests replace it


def source_of(install_cmd: list[str]) -> tuple[str, str, str]:
    """(owner/repo, path, sha) from `python -m contoso.skills install <repo> <path> --ref <sha>`."""
    args = list(install_cmd[3:])
    if not args or args[0] != "install" or "--ref" not in args:
        raise ApiError(400, "invalid_request", "install_cmd không hợp lệ.")
    positional = [
        a
        for i, a in enumerate(args[1:], 1)
        if not a.startswith("--") and args[i - 1] not in ("--ref", "--name")
    ]
    ref = args[args.index("--ref") + 1]
    return positional[0], positional[1], ref


async def fetch_preview(settings: Any, install_cmd: list[str]) -> dict:
    repo, path, sha = source_of(install_cmd)
    cache = (
        Path(settings.CACHE_DIR)
        / "skills"
        / sha
        / (hashlib.sha256(f"{repo}/{path}".encode()).hexdigest()[:16] + ".json")
    )
    if cache.is_file():
        return json.loads(cache.read_text(encoding="utf-8"))
    headers = {"User-Agent": "contoso"}
    token = settings.GITHUB_TOKEN.get_secret_value()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"{settings.SKILLS_CODELOAD_URL.rstrip('/')}/{repo}/tar.gz/{sha}"
    try:
        async with httpx.AsyncClient(
            transport=TRANSPORT, timeout=60, follow_redirects=True
        ) as client:
            r = await client.get(url, headers=headers)
    except httpx.HTTPError as e:
        raise ApiError(502, "upstream_error", f"Không tải được kỹ năng: {e}") from e
    if r.status_code != 200 or len(r.content) > MAX_DOWNLOAD:
        raise ApiError(502, "upstream_error", f"Không tải được kỹ năng (HTTP {r.status_code}).")
    prefix = PurePosixPath(f"{repo.split('/')[1]}-{sha}") / path.strip("/")
    files, skill_md, has_code = [], "", False
    with tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz") as tar:
        for m in tar.getmembers():
            name = PurePosixPath(m.name)
            if not name.is_relative_to(prefix) or not (m.isfile() or m.issym()):
                continue
            rel = name.relative_to(prefix).as_posix()
            files.append(rel)
            if rel.endswith(CODE_SUFFIXES) or (m.isfile() and m.mode & 0o111):
                has_code = True
            if rel == "SKILL.md" and m.isfile():
                skill_md = tar.extractfile(m).read().decode("utf-8", "replace")
    result = {"skill_md": skill_md, "files": sorted(files), "has_code": has_code}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result
