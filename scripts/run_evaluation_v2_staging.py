"""Provision, benchmark, and clean up one synthetic guest evaluation workspace."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "tmp" / "p170-eval-v2-synthetic.csv"


def progress(stage: str, **details: str) -> None:
    print(json.dumps({"stage": stage, **details}, ensure_ascii=False), flush=True)


def request(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    headers: dict[str, str],
    **kwargs: Any,
) -> dict[str, Any]:
    response = client.request(method, path, headers=headers, **kwargs)
    if not response.is_success:
        raise RuntimeError(f"API request failed: {method} {path} status={response.status_code}")
    return response.json()


def idempotency_headers(headers: dict[str, str]) -> dict[str, str]:
    return {**headers, "Idempotency-Key": str(uuid.uuid4())}


def wait_for_job(
    client: httpx.Client,
    base_url: str,
    job_id: str,
    headers: dict[str, str],
    *,
    timeout_seconds: float,
) -> str:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        job = request(client, "GET", f"{base_url}profiling-jobs/{job_id}", headers=headers)
        if job["status"] == "succeeded":
            return str(job["profiling_run_id"])
        if job["status"] == "failed":
            code = ((job.get("error") or {}).get("code") or "unknown")
            raise RuntimeError(f"Profiling job failed: code={code}")
        time.sleep(2)
    raise TimeoutError("Profiling job did not finish before the evaluation timeout.")


def confirm_if_needed(
    client: httpx.Client,
    base_url: str,
    run_id: str,
    headers: dict[str, str],
) -> None:
    profile = request(client, "GET", f"{base_url}profile/{run_id}", headers=headers)
    decisions: list[dict[str, str]] = []
    for kind, proposals in (profile.get("proposals") or {}).items():
        for proposal in proposals or []:
            if proposal.get("status") == "pending" and proposal.get("id"):
                decisions.append(
                    {"kind": str(kind), "proposal_id": str(proposal["id"]), "decision": "confirm"}
                )
    if decisions:
        request(
            client,
            "PATCH",
            f"{base_url}profile/{run_id}/confirm",
            headers=idempotency_headers(headers),
            json={"decisions": decisions, "resume": True},
        )


def wait_for_completed_profile(
    client: httpx.Client,
    base_url: str,
    run_id: str,
    headers: dict[str, str],
    *,
    timeout_seconds: float,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        profile = request(client, "GET", f"{base_url}profile/{run_id}", headers=headers)
        if profile["status"] == "completed" and not profile.get("pending_proposals"):
            return
        if profile["status"] == "failed":
            raise RuntimeError("Profile Run entered failed status.")
        time.sleep(2)
    raise TimeoutError("Profile Run did not complete after review.")


def submit_run(
    client: httpx.Client,
    base_url: str,
    dataset_id: str,
    headers: dict[str, str],
    *,
    scan_mode: str,
) -> str:
    payload: dict[str, Any] = {"scan_mode": scan_mode, "run_name": f"p170-eval-v2-{scan_mode}"}
    if scan_mode == "sample":
        payload["sampling"] = {"strategy": "reservoir", "sample_size": 100, "random_seed": 42}
    job = request(
        client,
        "POST",
        f"{base_url}datasets/{dataset_id}/profile",
        headers=idempotency_headers(headers),
        json=payload,
    )
    return str(job["job_id"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--timeout-seconds", type=float, default=300.0)
    parser.add_argument("--keep-guest-workspace", action="store_true")
    args = parser.parse_args()

    subprocess.run(
        [sys.executable, "scripts/generate_evaluation_v2_dataset.py", "--output", str(DATASET)],
        cwd=ROOT,
        check=True,
    )
    guest_token = f"guest.{uuid.uuid4()}.analyst"
    headers = {"Authorization": f"Bearer {guest_token}"}
    workspace_id = ""
    try:
        with httpx.Client(base_url=args.base_url.rstrip("/"), timeout=60.0) as client:
            bootstrap = request(client, "GET", "workspace-bootstrap", headers=headers)
            workspace_id = str((bootstrap.get("workspace") or {})["id"])
            headers["X-Workspace-Id"] = workspace_id
            progress("workspace_ready", workspace_id=workspace_id)
            with DATASET.open("rb") as source:
                upload = request(
                    client,
                    "POST",
                    "datasets/upload",
                    headers=headers,
                    files={"file": (DATASET.name, source, "text/csv")},
                )
            dataset_id = str(upload["dataset_id"])
            progress("dataset_uploaded", dataset_id=dataset_id)
            full_run_id = wait_for_job(
                client,
                "",
                submit_run(client, "", dataset_id, headers, scan_mode="full"),
                headers,
                timeout_seconds=args.timeout_seconds,
            )
            progress("full_profile_ready", profile_run_id=full_run_id)
            sample_run_id = wait_for_job(
                client,
                "",
                submit_run(client, "", dataset_id, headers, scan_mode="sample"),
                headers,
                timeout_seconds=args.timeout_seconds,
            )
            progress("sample_profile_ready", profile_run_id=sample_run_id)
            for run_id in (full_run_id, sample_run_id):
                confirm_if_needed(client, "", run_id, headers)
                wait_for_completed_profile(
                    client, "", run_id, headers, timeout_seconds=args.timeout_seconds
                )
            progress("profiles_confirmed")

        environment = {**os.environ, "P170_EVAL_BEARER_TOKEN": guest_token}
        benchmark = subprocess.run(
            [
                sys.executable,
                "tests/evaluations/run_evaluation.py",
                "--base-url",
                args.base_url,
                "--workspace-id",
                workspace_id,
                "--profile-run-id",
                full_run_id,
                "--sample-profile-run-id",
                sample_run_id,
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
        )
        scorecard = json.loads(benchmark.stdout)
        safe_summary = {
            "runtime": scorecard["runtime"],
            "case_count": scorecard["case_count"],
            "failed_cases": scorecard["summary"]["failed_cases"],
            "release_gates": scorecard["release_gates"],
            "report_paths": scorecard.get("report_paths"),
        }
        print(json.dumps(safe_summary, ensure_ascii=False))
        return benchmark.returncode
    finally:
        DATASET.unlink(missing_ok=True)
        if workspace_id and not args.keep_guest_workspace:
            try:
                with httpx.Client(base_url=args.base_url.rstrip("/"), timeout=30.0) as client:
                    client.delete("guest/session", headers=headers)
            except httpx.HTTPError:
                pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        raise
