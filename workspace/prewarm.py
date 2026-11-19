"""Optional uv cache warming for the seeded library presets (doc 11 "uv cache warm-up").

Not part of the image build or `make up`: provisioning downloads what each agent needs into the
shared cache anyway. `make warm-cache` runs `warm` in the workspace container to fill the cache
ahead of time, so first provisioning doesn't wait on PyPI. It touches only `UV_CACHE_DIR`: no
agent, folder or user changes, and re-running it reuses what is already cached.

    python prewarm.py list   [SEED_FILE...]   every preset package, one per line
    python prewarm.py warm   [SEED_FILE...]   cache every preset package, with hashes
    python prewarm.py status [SEED_FILE...]   cache size, and whether every preset is cached

Hashes matter: agent folders are uv projects, and `uv add`/`uv sync` install from uv.lock,
reusing a cached wheel only if its sha256 is recorded. A plain `uv pip install` doesn't
record it, so the warm-up locks with `--generate-hashes` and installs with `--require-hashes`.

Standard library only: `packages:` in the seed files is a JSON-style list, read with a regex.
"""

from __future__ import annotations

import contextlib
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

PACKAGES = re.compile(r"^\s*packages:\s*(\[.*\])\s*$", re.M)
# `make warm-cache` mounts platform/seeds here; domains are mounted at /domains.
DEFAULT_SEEDS = ["/opt/warm/seeds/library_presets.yaml", "/domains/*/seeds/library_presets.yaml"]
PYTHON = "/usr/local/bin/python3"


def packages(paths: list[str]) -> list[str]:
    out: list[str] = []
    for pattern in paths:
        for p in sorted(glob.glob(pattern)) or [pattern]:
            path = Path(p)
            if not path.is_file():
                continue
            for match in PACKAGES.finditer(path.read_text(encoding="utf-8")):
                out.extend(str(x) for x in json.loads(match.group(1)))
    return list(dict.fromkeys(out))


def cache_dir() -> Path:
    return Path(os.environ.get("UV_CACHE_DIR", "/data/folders/.uv-cache"))


def _uv(*args: str, offline: bool = False) -> subprocess.CompletedProcess[str]:
    cmd = ["uv", *args, *(["--offline"] if offline else [])]
    return subprocess.run(cmd, capture_output=True, text=True)


def _install(pkgs: list[str], *, offline: bool) -> subprocess.CompletedProcess[str]:
    """Lock `pkgs` with hashes, then install them into a throwaway venv next to the cache (same
    filesystem, so uv hardlinks instead of copying)."""
    cache = cache_dir()
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache.parent, prefix=".warm-") as tmp:
        req, locked, venv = Path(tmp, "packages.txt"), Path(tmp, "locked.txt"), Path(tmp, "venv")
        req.write_text("\n".join(pkgs) + "\n", encoding="utf-8")
        steps = [
            ("pip", "compile", "-q", "--python", PYTHON, "--generate-hashes", str(req), "-o",
             str(locked)),
            ("venv", "-q", "--python", PYTHON, str(venv)),
            ("pip", "install", "-q", "--python", str(venv), "--require-hashes", "-r", str(locked)),
        ]  # fmt: skip
        for step in steps:
            r = _uv(*step, offline=offline)
            if r.returncode != 0:
                return r
        return r


def _size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            with contextlib.suppress(OSError):
                total += os.lstat(os.path.join(root, f)).st_size
    return total


def main(argv: list[str]) -> int:
    command, paths = (argv[0] if argv else "list"), (argv[1:] or DEFAULT_SEEDS)
    pkgs = packages(paths)
    if command == "list":
        print("\n".join(pkgs))
        return 0
    if command not in ("warm", "status"):
        print(f"usage: prewarm.py list|warm|status [SEED_FILE...] (got {command})", file=sys.stderr)
        return 2
    if not pkgs:
        print("warm-cache: no preset packages found", file=sys.stderr)
        return 1
    if command == "warm":
        print(f"warm-cache: caching {len(pkgs)} preset packages in {cache_dir()} ...", flush=True)
        r = _install(pkgs, offline=False)
        if r.returncode != 0:
            print(f"warm-cache: failed (re-run to continue):\n{r.stderr[-2000:]}", file=sys.stderr)
            return 1
        print(f"warm-cache: done; {_size(cache_dir()) / 2**20:.0f} MiB cached")
        return 0
    r = _install(pkgs, offline=True)
    state = "complete" if r.returncode == 0 else "incomplete (run make warm-cache)"
    print(f"uv cache: {cache_dir()} {_size(cache_dir()) / 2**20:.0f} MiB")
    print(f"preset packages ({len(pkgs)}): {state}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
