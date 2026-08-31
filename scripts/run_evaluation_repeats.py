"""Run the v2 staging benchmark repeatedly and preserve one scorecard per run."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "tests" / "evaluations" / "run_evaluation.py"


def read_bearer(header_path: Path) -> str:
    text = header_path.read_text(encoding="utf-8")
    match = re.search(r"(?im)^authorization:\s*Bearer\s+(\S+)\s*$", text)
    if not match:
        raise RuntimeError("Không tìm thấy bearer token trong file header session.")
    return match.group(1)


def run_repeats(args: argparse.Namespace) -> list[dict[str, Any]]:
    header_path = Path(args.header_path)
    token = read_bearer(header_path)
    output_root = Path(args.output_root)
    results: list[dict[str, Any]] = []
    try:
        for index in range(1, args.repeat_count + 1):
            output_dir = output_root / f"run_{index}"
            environment = {**os.environ, "P170_EVAL_BEARER_TOKEN": token}
            completed = subprocess.run(
                [
                    sys.executable,
                    str(RUNNER),
                    "--base-url",
                    args.base_url,
                    "--workspace-id",
                    args.workspace_id,
                    "--profile-run-id",
                    args.profile_run_id,
                    "--sample-profile-run-id",
                    args.sample_profile_run_id,
                    "--output-dir",
                    str(output_dir),
                ],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )
            scorecard = json.loads(completed.stdout)
            results.append(
                {
                    "run": index,
                    "exit_code": completed.returncode,
                    "case_count": scorecard["case_count"],
                    "failed_cases": scorecard["summary"]["failed_cases"],
                    "critical_failure_count": len(scorecard["summary"]["critical_failures"]),
                    "metrics": scorecard["summary"]["metrics"],
                    "latency_ms": scorecard["summary"]["telemetry"]["latency_ms"],
                    "release_gates": scorecard["release_gates"],
                    "output_dir": str(output_dir),
                }
            )
    finally:
        header_path.unlink(missing_ok=True)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--profile-run-id", required=True)
    parser.add_argument("--sample-profile-run-id", required=True)
    parser.add_argument("--header-path", required=True, help="Temporary browser request-header file.")
    parser.add_argument("--repeat-count", type=int, default=3)
    parser.add_argument("--output-root", default=str(ROOT / "evaluations" / "results" / "repeats" / "account"))
    args = parser.parse_args()
    if args.repeat_count < 3:
        parser.error("repeat-count phải >= 3 theo policy benchmark.")
    print(json.dumps(run_repeats(args), ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
