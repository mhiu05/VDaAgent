"""Shared, dependency-light helpers for the production benchmark."""
from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import re
import shutil
import statistics
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
EVALUATIONS = ROOT / "evaluations"
DATASETS = EVALUATIONS / "datasets"
TRUTH = EVALUATIONS / "ground_truth"
RUNS = EVALUATIONS / "runs"
SCORES = EVALUATIONS / "scores"
FAILURES = EVALUATIONS / "failures"
SEED = 1702026


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def ensure_dirs() -> None:
    for path in (EVALUATIONS, DATASETS, TRUTH, RUNS, SCORES, FAILURES):
        path.mkdir(parents=True, exist_ok=True)


def run_dir(run_id: str, *, create: bool = False) -> Path:
    """Return the immutable artifact directory for one benchmark run."""

    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{7,127}", run_id):
        raise ValueError("Invalid benchmark run_id.")
    path = RUNS / run_id
    if create:
        path.mkdir(parents=True, exist_ok=True)
        (path / "stages").mkdir(exist_ok=True)
        (path / "scores").mkdir(exist_ok=True)
        (path / "failures").mkdir(exist_ok=True)
    return path


def latest_run_id(*, require_status: str | None = None) -> str | None:
    candidates: list[tuple[float, str]] = []
    if not RUNS.exists():
        return None
    for path in RUNS.iterdir():
        if not path.is_dir() or not (path / "execution_metadata.json").exists():
            continue
        metadata = read_json(path / "execution_metadata.json", {})
        if require_status and metadata.get("status") != require_status:
            continue
        candidates.append((path.stat().st_mtime, path.name))
    return max(candidates)[1] if candidates else None


def stage_status(
    directory: Path,
    stage: str,
    status: str,
    *,
    exit_code: int | None = None,
    **details: Any,
) -> None:
    """Persist a small, secret-free status document for one pipeline stage."""

    write_json(
        directory / "stages" / f"{stage}.json",
        {
            "stage": stage,
            "status": status,
            "exit_code": exit_code,
            "updated_at": utc_now(),
            **scrub(details),
        },
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def execution_fingerprint(*, target: str, environment: str, case_count: int) -> dict[str, Any]:
    """Capture reproducibility metadata without serializing environment values."""

    try:
        git_sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
        dirty = bool(
            subprocess.check_output(
                ["git", "status", "--porcelain"], cwd=ROOT, text=True
            ).strip()
        )
    except (OSError, subprocess.CalledProcessError):
        git_sha, dirty = "not_available", None
    dataset_hashes = {
        path.name: sha256_file(path)
        for path in sorted(DATASETS.glob("*.csv"))
        if path.is_file()
    }
    manifest = read_json(EVALUATIONS / "benchmark_manifest.json", {})
    return {
        "git_sha": git_sha,
        "git_dirty": dirty,
        "python_version": platform.python_version(),
        "python_executable": Path(sys.executable).name,
        "platform": platform.platform(),
        "benchmark_version": manifest.get("benchmark_version", "unknown"),
        "benchmark_case_count": case_count,
        "dataset_sha256": dataset_hashes,
        "environment": environment,
        "target": target,
        "provider": os.getenv("LLM_PROVIDER") or "not_configured",
        "agent_model": os.getenv("LLM_MODEL") or "not_configured",
        "configured_keys": sorted(
            key
            for key in (
                "GEMINI_API_KEY",
                "LANGSMITH_API_KEY",
                "SUPABASE_URL",
                "DATABASE_URL",
            )
            if os.getenv(key)
        ),
    }


def publish_alias(source: Path, destination: Path) -> None:
    """Publish a latest-run alias only after its producing stage completed."""

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    shutil.copyfile(source, temporary)
    temporary.replace(destination)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: Path, default: Any = None) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_jsonl(path: Path, values: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n" for value in values), encoding="utf-8")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def numeric(values: list[str]) -> list[float]:
    parsed: list[float] = []
    for value in values:
        try:
            parsed.append(float(value))
        except (TypeError, ValueError):
            return []
    return parsed


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return math.nan
    index = (len(ordered) - 1) * p
    lo, hi = math.floor(index), math.ceil(index)
    return ordered[lo] if lo == hi else ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo)


def pearson(left: list[float], right: list[float]) -> float | None:
    if len(left) < 2 or len(left) != len(right):
        return None
    left_mean, right_mean = statistics.fmean(left), statistics.fmean(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    denom = math.sqrt(sum((x - left_mean) ** 2 for x in left) * sum((y - right_mean) ** 2 for y in right))
    return numerator / denom if denom else None


def scrub(value: Any) -> Any:
    """Keep artifacts safe to share: no auth headers, cookies, or raw PII values."""
    if isinstance(value, dict):
        return {str(k): "[REDACTED]" if re.search(r"authorization|token|password|cookie", str(k), re.I) else scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, str):
        value = re.sub(r"[A-Za-z0-9._%+-]+@example\.invalid", "[SYNTHETIC_EMAIL_REDACTED]", value)
        value = re.sub(r"\+1-555-010-\d{4}", "[SYNTHETIC_PHONE_REDACTED]", value)
        return re.sub(r"\+84-9\d{2}-\d{3}-\d{2}", "[SYNTHETIC_PHONE_REDACTED]", value)
    return value


def answer_text(body: dict[str, Any]) -> str:
    for key in ("answer", "conclusion", "text", "message", "detail"):
        value = body.get(key)
        if isinstance(value, str):
            return value
    return ""
