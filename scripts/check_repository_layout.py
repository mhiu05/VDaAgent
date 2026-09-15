"""Fail fast when an entry point drifts from the repository path contract."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = ("README.md", "config.yaml", "alembic.ini")
ROOT_DIRECTORIES = ("src/backend/src", "src/backend/migrations", "src/frontend")
ENTRY_POINTS = (
    "src/backend/src/main.py",
    "src/backend/src/workers/profiling_worker.py",
    "src/backend/migrations/env.py",
    "src/frontend/package.json",
    "Dockerfile.backend.azure",
    "Dockerfile.frontend.azure",
    ".github/workflows/azure-container-deploy.yml",
)
STATIC_FILES = (
    "Makefile",
    "alembic.ini",
    "Dockerfile.backend.azure",
    "Dockerfile.frontend.azure",
    ".dockerignore",
    "pyproject.toml",
    ".github/workflows/azure-container-deploy.yml",
)
LEGACY_PATH_PATTERNS = (
    re.compile(
        r"(?<!src/)(?<!src\\)(?<![A-Za-z0-9_.-])"
        r"backend[\\/](?:src|migrations|node_modules|\.next|test-results|playwright-report)\b"
    ),
    re.compile(
        r"(?<!src/)(?<!src\\)(?<![A-Za-z0-9_.-])"
        r"frontend[\\/](?:src|node_modules|\.next|test-results|playwright-report)\b"
    ),
    re.compile(r"\bcd\s+(?:/d\s+)?[\"']?backend\b"),
    re.compile(r"\bcd\s+(?:/d\s+)?[\"']?frontend\b"),
    re.compile(r"--app-dir\s+backend\b"),
    re.compile(r"PYTHONPATH=(?:/app/)?backend\b"),
    re.compile(r"working-directory:\s*backend\b"),
    re.compile(r"working-directory:\s*frontend\b"),
    re.compile(r"context:\s*frontend\b"),
)


def _fail(message: str) -> None:
    raise RuntimeError(f"Repository layout check failed: {message}")


def _require_contains(path: Path, expected: str) -> None:
    if expected not in path.read_text(encoding="utf-8"):
        _fail(f"{path.relative_to(ROOT)} must contain {expected!r}")


def _iter_checked_code_files() -> list[Path]:
    paths: list[Path] = []
    for directory in (ROOT / "scripts", ROOT / "tests", ROOT / "src" / "backend"):
        paths.extend(directory.rglob("*.py"))
    return [path for path in paths if path != Path(__file__).resolve()]


def _check_root_contract() -> None:
    for name in ROOT_FILES:
        if not (ROOT / name).is_file():
            _fail(f"missing root file {name}")
    for name in ROOT_DIRECTORIES:
        if not (ROOT / name).is_dir():
            _fail(f"missing required directory {name}")
    for name in ENTRY_POINTS:
        if not (ROOT / name).is_file():
            _fail(f"missing entry point {name}")
    for obsolete in (ROOT / "backend", ROOT / "frontend"):
        if obsolete.exists():
            _fail(f"obsolete root directory {obsolete.name} must not exist")


def _check_declared_entry_points() -> None:
    workflow = ROOT / ".github/workflows/azure-container-deploy.yml"
    _require_contains(ROOT / "Makefile", "BACKEND_DIR := src\\backend")
    _require_contains(ROOT / "Makefile", "FRONTEND_DIR := src\\frontend")
    _require_contains(ROOT / "alembic.ini", "script_location = %(here)s/src/backend/migrations")
    _require_contains(ROOT / "alembic.ini", "prepend_sys_path = %(here)s/src/backend")
    _require_contains(ROOT / "Dockerfile.backend.azure", "PYTHONPATH=/app/src/backend")
    _require_contains(ROOT / "Dockerfile.backend.azure", "COPY --chown=app:app src/backend ./src/backend")
    _require_contains(ROOT / "Dockerfile.backend.azure", "alembic.ini config.yaml README.md")
    _require_contains(ROOT / "Dockerfile.backend.azure", '"--app-dir", "/app/src/backend"')
    _require_contains(workflow, "grep -Eq '^(src/backend/|src/frontend/")
    _require_contains(workflow, "working-directory: src/frontend")
    _require_contains(workflow, "PYTHONPATH=/app/src/backend")
    _require_contains(workflow, "            src/frontend")
    if workflow.read_text(encoding="utf-8").count(
        "run: python scripts/check_repository_layout.py"
    ) != 2:
        _fail("workflow must run the repository layout check in quality and deploy jobs")
    _require_contains(ROOT / "pyproject.toml", '"src/backend/**/*.py"')
    for ignored in (
        ".env",
        ".env.*",
        ".git",
        ".venv",
        "node_modules",
        "src/frontend/node_modules",
        "src/frontend/.next",
        "src/frontend/.next-*",
        ".pytest_cache",
        ".ruff_cache",
        "__pycache__",
        "test-results",
        "playwright-report",
    ):
        _require_contains(ROOT / ".dockerignore", ignored)
    for ignored in (
        ".env",
        ".env.*",
        "node_modules",
        ".next",
        ".next-*",
        "test-results",
        "playwright-report",
    ):
        _require_contains(ROOT / "src/frontend/.dockerignore", ignored)


def _check_for_legacy_paths() -> None:
    files = [ROOT / name for name in STATIC_FILES] + _iter_checked_code_files()
    violations: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        for pattern in LEGACY_PATH_PATTERNS:
            if pattern.search(text):
                violations.append(f"{path.relative_to(ROOT)} ({pattern.pattern})")
                break
    if violations:
        _fail("legacy executable path found in " + ", ".join(violations))


def main() -> int:
    _check_root_contract()
    _check_declared_entry_points()
    _check_for_legacy_paths()
    print("Repository layout check PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1) from exc
