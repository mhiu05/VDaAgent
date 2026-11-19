"""Skill installer (doc 05 "Installer `contoso.skills`"). Standard library only.

    python -m contoso.skills install <owner/repo> <path> --ref <sha> [--name <dir>]

Run with the agent folder as the working directory. Prints
`{"installed": "skills/<dir>", "files": N, "has_code": bool}` on success; on failure prints
the reason to stderr and exits non-zero, leaving any existing install untouched.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import stat
import sys
import tarfile
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath

DEFAULT_CODELOAD = "https://codeload.github.com"
MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
CODE_SUFFIXES = (".py", ".sh", ".js")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


class InstallError(Exception):
    pass


def download(owner_repo: str, ref: str) -> bytes:
    base = os.environ.get("CONTOSO_SKILLS_CODELOAD_URL", DEFAULT_CODELOAD).rstrip("/")
    cap = int(os.environ.get("CONTOSO_SKILLS_MAX_DOWNLOAD_BYTES") or MAX_DOWNLOAD_BYTES)
    headers = {"User-Agent": "contoso-skills"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    req = urllib.request.Request(f"{base}/{owner_repo}/tar.gz/{ref}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read(cap + 1)
    except urllib.error.HTTPError as e:
        raise InstallError(f"download failed: HTTP {e.code}") from None
    except urllib.error.URLError as e:
        raise InstallError(f"download failed: {e.reason}") from None
    if len(data) > cap:
        raise InstallError("download too large (the cap is 50 MB)")
    return data


def _inside(base: PurePosixPath, target: PurePosixPath) -> bool:
    parts: list[str] = []
    for p in (base / target).parts:
        if p == "..":
            if not parts:
                return False
            parts.pop()
        elif p not in ("", "."):
            parts.append(p)
    return PurePosixPath(*parts).is_relative_to(base) if parts else False


def extract(data: bytes, owner_repo: str, ref: str, path: str, dest: Path) -> None:
    """Extract only `<repo>-<ref>/<path>/` into `dest`, refusing escapes."""
    repo = owner_repo.split("/", 1)[1]
    prefix = PurePosixPath(f"{repo}-{ref}") / path.strip("/")
    found = False
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        members = tar.getmembers()
        for m in members:
            name = PurePosixPath(m.name)
            if name.is_absolute() or ".." in name.parts:
                raise InstallError(f"refused unsafe path in archive: {m.name}")
        for m in members:
            name = PurePosixPath(m.name)
            if name != prefix and not name.is_relative_to(prefix):
                continue
            rel = name.relative_to(prefix)
            found = True
            if m.issym() or m.islnk():
                link = PurePosixPath(m.linkname)
                base = PurePosixPath("skill") / rel.parent
                if link.is_absolute() or not _inside(PurePosixPath("skill"), base / link):
                    raise InstallError(f"refused link pointing outside the skill: {m.name}")
                if m.islnk():
                    raise InstallError(f"refused hard link: {m.name}")
                target = dest / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                os.symlink(m.linkname, target)
            elif m.isdir():
                (dest / rel).mkdir(parents=True, exist_ok=True)
            elif m.isfile():
                target = dest / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                src = tar.extractfile(m)
                assert src is not None
                with open(target, "wb") as f:
                    shutil.copyfileobj(src, f)
                os.chmod(target, 0o755 if m.mode & 0o111 else 0o644)
            # devices, fifos etc. are skipped
    if not found:
        raise InstallError(f"path not found in the archive: {path}")


def read_frontmatter(skill_md: Path) -> dict[str, str]:
    if not skill_md.is_file():
        raise InstallError("SKILL.md is missing at the top of the skill")
    lines = skill_md.read_text(encoding="utf-8", errors="replace").splitlines()
    if not lines or lines[0].strip() != "---":
        raise InstallError("SKILL.md has no YAML frontmatter")
    meta: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" in line and not line.startswith((" ", "\t", "#")):
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip().strip("'\"")
    else:
        raise InstallError("SKILL.md frontmatter is not closed")
    for key in ("name", "description"):
        if not meta.get(key):
            raise InstallError(f"SKILL.md frontmatter needs `{key}`")
    return meta


def install(owner_repo: str, path: str, ref: str, name: str | None, cwd: Path) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", owner_repo):
        raise InstallError("repo must be <owner>/<repo>")
    if name is not None and not SAFE_NAME.match(name):
        raise InstallError(f"unsafe skill name: {name}")
    skills = cwd / "skills"
    skills.mkdir(exist_ok=True)
    data = download(owner_repo, ref)
    tmp = skills / f".tmp-{os.getpid()}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    try:
        extract(data, owner_repo, ref, path, tmp)
        meta = read_frontmatter(tmp / "SKILL.md")
        dirname = name or meta["name"]
        if not SAFE_NAME.match(dirname):
            raise InstallError(f"unsafe skill name: {dirname}")
        files = [p for p in tmp.rglob("*") if p.is_file() or p.is_symlink()]
        has_code = any(
            p.suffix in CODE_SUFFIXES
            or (not p.is_symlink() and p.stat().st_mode & (stat.S_IXUSR | stat.S_IXGRP))
            for p in files
        )
        final = skills / dirname
        old = skills / f".old-{os.getpid()}"
        if final.exists():
            final.rename(old)
        tmp.rename(final)
        shutil.rmtree(old, ignore_errors=True)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return {"installed": f"skills/{dirname}", "files": len(files), "has_code": bool(has_code)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m contoso.skills")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("install")
    p.add_argument("repo")
    p.add_argument("path")
    p.add_argument("--ref", required=True)
    p.add_argument("--name")
    args = parser.parse_args(argv)
    try:
        result = install(args.repo, args.path, args.ref, args.name, Path.cwd())
    except InstallError as e:
        print(f"contoso.skills: {e}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
