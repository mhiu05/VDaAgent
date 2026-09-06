"""Run the synthetic vi-VN benchmark through authenticated public APIs.

Artifacts are immutable and run-scoped under ``evaluations/runs/<run_id>``.
Only a completely executed run may update compatibility aliases. Secrets and
raw exception payloads are never persisted.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from queue import Queue
from threading import Thread
from typing import Any

import httpx
from dotenv import load_dotenv

from common import (
    DATASETS,
    EVALUATIONS,
    RUNS,
    ensure_dirs,
    execution_fingerprint,
    latest_run_id,
    publish_alias,
    read_json,
    read_jsonl,
    run_dir,
    scrub,
    stage_status,
    utc_now,
    write_json,
    write_jsonl,
)
from utils.auth import (
    AuthenticatedSession,
    AuthenticationError,
    authenticate,
    authenticate_local_guest,
)

API_DEFAULT = "https://vdaagent-api.azurewebsites.net/api/v1"
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
SMOKE_CATEGORIES = (
    "basic profiling factual QA",
    "missingness",
    "numeric aggregation",
    "evidence / provenance",
    "ambiguous query requiring clarification",
    "insufficient evidence",
    "comparison / drift",
    "privacy/safety/adversarial",
)


def parse_sse(lines: list[str]) -> dict[str, Any]:
    event, data, final = "message", [], {"events": []}
    for line in [*lines, ""]:
        if not line:
            if data:
                try:
                    payload = json.loads("\n".join(data))
                except json.JSONDecodeError:
                    payload = {"text": "\n".join(data)}
                final["events"].append({"event": event, "payload": payload})
                if event == "done" and isinstance(payload, dict):
                    final.update(payload)
                elif event == "error":
                    final["error"] = payload
                event, data = "message", []
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
    final["answer"] = "".join(
        str(item["payload"].get("text") or "")
        for item in final["events"]
        if item["event"] == "token" and isinstance(item["payload"], dict)
    )
    return final


def _retry_delay(response: httpx.Response | None, attempt: int) -> float:
    if response is not None:
        try:
            return min(5.0, max(0.0, float(response.headers.get("retry-after", ""))))
        except ValueError:
            pass
    return min(4.0, 0.5 * (2 ** (attempt - 1)))


def _safe_failure(exc: BaseException) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "transport_timeout"
    if isinstance(exc, httpx.TransportError):
        return "transport_error"
    return type(exc).__name__[:80]


class Production:
    def __init__(
        self,
        api: str,
        auth: AuthenticatedSession,
        workspace: str | None,
        timeout: float,
    ):
        self.api = api.rstrip("/")
        self.auth = auth
        self.workspace = workspace
        self.timeout = timeout
        self.client = httpx.Client(timeout=timeout, follow_redirects=True)

    @property
    def headers(self) -> dict[str, str]:
        output = {"Authorization": f"Bearer {self.auth.access_token}"}
        if self.workspace:
            output["X-Workspace-Id"] = self.workspace
        return output

    def close(self) -> None:
        self.client.close()

    def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        """Retry only transport, 429, and 5xx failures with bounded backoff."""

        supplied_headers = kwargs.pop("headers", {})
        headers = {**self.headers, **supplied_headers}
        retry_safe = method.upper() in {"GET", "HEAD", "OPTIONS"} or bool(
            headers.get("Idempotency-Key")
        )
        last_error: BaseException | None = None
        for attempt in range(1, 4):
            response: httpx.Response | None = None
            try:
                response = self.client.request(
                    method, f"{self.api}{path}", headers=headers, **kwargs
                )
                if response.status_code == 401 and self.auth.refresh_or_reauthenticate(
                    api_url=self.api, timeout=min(self.timeout, 30)
                ):
                    headers = {**self.headers, **supplied_headers}
                    response = self.client.request(
                        method, f"{self.api}{path}", headers=headers, **kwargs
                    )
                if (
                    response.status_code not in RETRYABLE_STATUS
                    or not retry_safe
                    or attempt == 3
                ):
                    response.extensions["benchmark_transport_attempts"] = attempt
                    return response
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_error = exc
                if not retry_safe or attempt == 3:
                    raise
            time.sleep(_retry_delay(response, attempt))
        raise RuntimeError(_safe_failure(last_error or RuntimeError("request_failed")))

    def workspace_for_run(self, name: str) -> str:
        listing = self.request("GET", "/workspaces")
        listing.raise_for_status()
        workspaces = listing.json().get("workspaces", [])
        existing = next((item for item in workspaces if item.get("name") == name), None)
        if existing:
            self.workspace = str(existing["id"])
            return self.workspace
        created = self.request("POST", "/workspaces", json={"name": name})
        created.raise_for_status()
        self.workspace = str(created.json()["id"])
        return self.workspace

    def upload_and_submit_profile(
        self, filename: str, remote_name: str | None = None
    ) -> dict[str, str | None]:
        path = DATASETS / filename
        with path.open("rb") as handle:
            uploaded = self.request(
                "POST",
                "/datasets/upload",
                files={"file": (remote_name or filename, handle, "text/csv")},
                headers={"Idempotency-Key": uuid.uuid4().hex},
            )
        uploaded.raise_for_status()
        dataset_id = uploaded.json().get("dataset_id")
        if not dataset_id:
            raise RuntimeError(f"Upload returned no dataset_id for {filename}")
        queued = self.request(
            "POST",
            f"/datasets/{dataset_id}/profile",
            json={"scan_mode": "full", "run_name": f"benchmark-{filename}"},
            headers={"Idempotency-Key": uuid.uuid4().hex},
        )
        queued.raise_for_status()
        body = queued.json()
        profile_run_id = body.get("run_id") or body.get("profile_run_id") or body.get("id")
        if not profile_run_id:
            raise RuntimeError(f"Profile submission returned no run id for {filename}")
        return {
            "dataset_id": str(dataset_id),
            "artifact_id": uploaded.json().get("artifact_id"),
            "profile_run_id": str(profile_run_id),
        }

    def advance_profile(
        self,
        filename: str,
        mapping: dict[str, str | None],
        auto_confirm: bool,
        missing_is_error: bool = False,
    ) -> bool:
        profile_run_id = str(mapping["profile_run_id"])
        # Reused profiles are already immutable and reviewed, so the compact
        # summary contract is enough to prove visibility/readiness.  Avoid
        # downloading every column statistic and proposal during preflight.
        path = (
            f"/profile/{profile_run_id}/summary"
            if missing_is_error
            else f"/profile/{profile_run_id}"
        )
        result = self.request("GET", path)
        if result.status_code == 404:
            if missing_is_error:
                raise RuntimeError(f"Reused profile is not visible: {filename}")
            return False
        result.raise_for_status()
        body = result.json()
        status = str(body.get("status") or body.get("run", {}).get("status") or "")
        if status == "completed":
            return True
        if auto_confirm and status in {"awaiting_review", "review_required", "pending_review"}:
            proposals = body.get("proposals") or {}
            decisions = [
                {
                    "kind": kind,
                    "proposal_id": item.get("id") or item.get("proposal_id"),
                    "decision": "confirm",
                }
                for kind, items in proposals.items()
                for item in items
                if isinstance(item, dict)
                and item.get("status") == "pending"
                and (item.get("id") or item.get("proposal_id"))
            ]
            confirmed = self.request(
                "PATCH",
                f"/profile/{profile_run_id}/confirm",
                json={"decisions": decisions, "resume": True},
                headers={"Idempotency-Key": uuid.uuid4().hex},
            )
            confirmed.raise_for_status()
        elif status in {"failed", "cancelled"}:
            raise RuntimeError(f"Profile {filename} ended {status}")
        return False

    def detect_drift(self, baseline_run_id: str, current_run_id: str) -> dict[str, Any]:
        response = self.request(
            "POST",
            f"/profile/{current_run_id}/drift",
            json={"baseline_run_id": baseline_run_id, "current_run_id": current_run_id},
            headers={"Idempotency-Key": f"benchmark-drift-{baseline_run_id}-{current_run_id}"},
        )
        response.raise_for_status()
        return response.json()

    def ask(
        self,
        question: str,
        profile_run_id: str,
        case_timeout: float,
        *,
        history: list[dict[str, Any]] | None = None,
        conversation_id: str | None = None,
        persist: bool = False,
    ) -> dict[str, Any]:
        """Execute one SSE request with a hard wall-clock deadline.

        HTTP read timeouts reset whenever any bytes arrive.  A malformed or
        heartbeat-only stream could therefore run forever despite
        ``case_timeout``.  Isolate the stream in a daemon thread so the harness
        can always record a bounded 504 and continue the resumable run.
        """

        started = time.perf_counter()
        outcome: Queue[tuple[str, Any]] = Queue(maxsize=1)

        def target() -> None:
            try:
                outcome.put(("result", self._ask_stream(
                    question,
                    profile_run_id,
                    case_timeout,
                    history=history,
                    conversation_id=conversation_id,
                    persist=persist,
                )))
            except BaseException as exc:  # propagated in the caller thread
                outcome.put(("error", exc))

        worker = Thread(target=target, name="benchmark-sse-request", daemon=True)
        worker.start()
        worker.join(case_timeout)
        if worker.is_alive():
            return {
                "status_code": 504,
                "response": {"detail": "benchmark_case_timeout"},
                "telemetry": {
                    "ttft_ms": None,
                    "total_latency_ms": round((time.perf_counter() - started) * 1000, 3),
                    "transport_attempts": 1,
                    "hard_deadline_enforced": True,
                },
            }
        kind, value = outcome.get_nowait()
        if kind == "error":
            raise value
        return value

    def _ask_stream(
        self,
        question: str,
        profile_run_id: str,
        case_timeout: float,
        *,
        history: list[dict[str, Any]] | None = None,
        conversation_id: str | None = None,
        persist: bool = False,
    ) -> dict[str, Any]:
        request_id = f"benchmark-{uuid.uuid4().hex}"
        payload = {
            "question": question,
            "profile_run_id": profile_run_id,
            "request_id": request_id,
            "persist_user_message": persist,
            "history": history or [],
        }
        if conversation_id:
            payload.update(
                {
                    "conversation_id": conversation_id,
                    "message_id": uuid.uuid4().hex,
                    "assistant_message_id": uuid.uuid4().hex,
                }
            )
        started = time.perf_counter()
        last_error: BaseException | None = None
        transport_attempt = 0
        for transport_attempt in range(1, 4):
            first_token: float | None = None
            lines: list[str] = []
            try:
                # A request-local client allows a timed-out daemon stream to
                # unwind independently without corrupting later requests.
                with httpx.Client(timeout=case_timeout, follow_redirects=True) as stream_client, stream_client.stream(
                    "POST",
                    f"{self.api}/qa/stream",
                    headers=self.headers,
                    json=payload,
                    timeout=case_timeout,
                ) as response:
                    status = response.status_code
                    if status in RETRYABLE_STATUS and transport_attempt < 3:
                        time.sleep(_retry_delay(response, transport_attempt))
                        continue
                    for line in response.iter_lines():
                        lines.append(line)
                        if first_token is None and line.startswith("data:") and "text" in line:
                            first_token = time.perf_counter()
                        if time.perf_counter() - started >= case_timeout:
                            return {
                                "status_code": 504,
                                "response": {"detail": "benchmark_case_timeout"},
                                "telemetry": {
                                    "ttft_ms": round((first_token - started) * 1000, 3)
                                    if first_token
                                    else None,
                                    "total_latency_ms": round((time.perf_counter() - started) * 1000, 3),
                                    "transport_attempts": transport_attempt,
                                },
                            }
                parsed = parse_sse(lines) if status < 400 else {"detail": "http_error"}
                return {
                    "status_code": status,
                    "response": parsed,
                    "telemetry": {
                        "ttft_ms": round((first_token - started) * 1000, 3)
                        if first_token
                        else None,
                        "total_latency_ms": round((time.perf_counter() - started) * 1000, 3),
                        "transport_attempts": transport_attempt,
                    },
                }
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_error = exc
                if lines or transport_attempt == 3:
                    break
                time.sleep(_retry_delay(None, transport_attempt))
        return {
            "status_code": 502,
            "response": {"detail": _safe_failure(last_error or RuntimeError("stream_failed"))},
            "telemetry": {
                "ttft_ms": None,
                "total_latency_ms": round((time.perf_counter() - started) * 1000, 3),
                "transport_attempts": transport_attempt,
            },
        }


def _split_values(values: list[str] | None) -> set[str]:
    return {
        item.strip()
        for value in values or []
        for item in value.split(",")
        if item.strip()
    }


def _local_auth_identity(
    previous: dict[str, Any], source_id: str | None, run_id: str
) -> str:
    """Keep reused local resources under the identity that created them.

    Older run artifacts predate the explicit identity field. Their default
    workspace name embeds the originating run id, which provides a compatible
    migration path without copying credentials into artifacts.
    """

    explicit = str(previous.get("local_auth_identity") or "").strip()
    if explicit:
        return explicit
    workspace_name = str(previous.get("workspace_name") or "")
    if workspace_name.startswith("benchmark-run-"):
        return workspace_name.removeprefix("benchmark-")
    return str(source_id or run_id)


def _select_cases(cases: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    case_ids, categories = _split_values(args.case_id), _split_values(args.category)
    selected = [
        case
        for case in cases
        if (not case_ids or case["case_id"] in case_ids)
        and (not categories or case["category"] in categories)
    ]
    if case_ids:
        missing = sorted(case_ids - {case["case_id"] for case in selected})
        if missing:
            raise ValueError("Unknown case_id: " + ", ".join(missing))
    if args.smoke:
        selected = [
            next(case for case in selected if case["category"] == category)
            for category in SMOKE_CATEGORIES
            if any(case["category"] == category for case in selected)
        ]
    if args.max_cases:
        selected = selected[: args.max_cases]
    if not selected:
        raise ValueError("No benchmark cases matched the requested filters.")
    return selected


def _needed_datasets(selected: list[dict[str, Any]]) -> list[str]:
    names = {str(case["dataset"]) for case in selected}
    if "drift_v2" in names:
        names.add("drift_v1")
    order = ("profiling_base", "profiling_edge_cases", "profiling_pii", "drift_v1", "drift_v2")
    return [name for name in order if name in names]


def _missing_datasets(
    selected: list[dict[str, Any]], mappings: dict[str, Any]
) -> list[str]:
    """Return required datasets absent from a full or filtered reuse source."""

    return [name for name in _needed_datasets(selected) if name not in mappings]


def _expected_attempts(case: dict[str, Any]) -> int:
    policy = case.get("repeat_policy")
    if isinstance(policy, int) and policy > 0:
        return min(policy, 3)
    return 3 if case["difficulty"] == "hard" or case["query_type"] == "adversarial" else 1


def _run_postprocessing(
    run_id: str, *, judge_only: bool = False, baseline: str | None = None
) -> int:
    directory = run_dir(run_id)
    scripts = [
        "normalize_results.py",
        "extract_langsmith_traces.py",
        "grade_benchmark.py",
        "audit_numeric_accuracy.py",
        "audit_grader.py",
        "build_report.py",
        "validate_benchmark_artifacts.py",
    ]
    if judge_only:
        scripts = ["normalize_results.py", "grade_benchmark.py", "build_report.py", "validate_benchmark_artifacts.py"]
    for script in scripts:
        stage = Path(script).stem
        stage_status(directory, stage, "RUNNING")
        command = [sys.executable, str(Path(__file__).with_name(script)), "--run-id", run_id]
        if baseline and script == "grade_benchmark.py":
            command.extend(["--baseline", baseline])
        completed = subprocess.run(
            command,
            cwd=Path(__file__).resolve().parents[2],
            check=False,
        )
        stage_status(
            directory,
            stage,
            "COMPLETED" if completed.returncode == 0 else "FAILED",
            exit_code=completed.returncode,
        )
        if completed.returncode:
            return completed.returncode
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--environment", choices=("local", "production"))
    parser.add_argument("--api-url")
    parser.add_argument("--workspace-name")
    parser.add_argument("--token", default=os.getenv("P170_EVAL_BEARER_TOKEN", ""))
    parser.add_argument("--email", default=os.getenv("VDAGENT_EMAIL", ""))
    parser.add_argument("--password", default=os.getenv("VDAGENT_PASSWORD", ""))
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--auto-confirm", action="store_true")
    parser.add_argument("--max-cases", type=int, default=0)
    parser.add_argument("--case-timeout", type=float, default=150)
    parser.add_argument("--qa-concurrency", type=int, default=1)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--auth-check", action="store_true")
    parser.add_argument("--case-id", action="append")
    parser.add_argument("--category", action="append")
    parser.add_argument(
        "--resume", nargs="?", const="latest",
        help="Resume a run_id, or the most recent run when no value is supplied.",
    )
    parser.add_argument("--skip-provision", action="store_true")
    parser.add_argument(
        "--reuse-provision-from",
        help="Create a fresh run while reusing completed dataset mappings from an existing local run.",
    )
    parser.add_argument("--judge-only", action="store_true")
    parser.add_argument("--run-id", help="Explicit run id for a new run.")
    parser.add_argument("--baseline", help="Optional prior benchmark_summary.json for regression checks.")
    parser.add_argument("--no-postprocess", action="store_true")
    return parser


def main() -> int:
    load_dotenv(EVALUATIONS.parent / ".env")
    args = _parser().parse_args()
    args.token = args.token or os.getenv("P170_EVAL_BEARER_TOKEN", "")
    args.email = args.email or os.getenv("VDAGENT_EMAIL", "")
    args.password = args.password or os.getenv("VDAGENT_PASSWORD", "")
    if not 1 <= args.qa_concurrency <= 3:
        raise SystemExit("--qa-concurrency must be between 1 and 3")
    ensure_dirs()
    cases = read_jsonl(EVALUATIONS / "benchmark_cases.jsonl")
    selected = _select_cases(cases, args)

    resume_id = args.resume
    if resume_id == "latest":
        resume_id = latest_run_id()
    if args.resume is not None and not resume_id:
        raise SystemExit("No run is available to resume.")
    reuse_id = args.reuse_provision_from
    if reuse_id and resume_id:
        raise SystemExit("Choose either --resume or --reuse-provision-from, not both.")
    source_id = resume_id or reuse_id
    run_id = str(resume_id or args.run_id or f"run-{time.strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:8]}")
    directory = run_dir(run_id, create=True)
    source_metadata = (
        read_json(run_dir(source_id) / "execution_metadata.json", {})
        if source_id
        else {}
    )
    if reuse_id:
        previous = {
            key: source_metadata.get(key)
            for key in (
                "environment", "target", "workspace_name", "workspace_id",
                "dataset_mappings", "profile_runs", "drift_ready",
                "drift_finding_count", "auth_method",
                "local_auth_identity",
            )
            if source_metadata.get(key) is not None
        }
    else:
        previous = source_metadata
    environment = args.environment or previous.get("environment") or os.getenv("VDAGENT_BENCHMARK_ENV", "local")
    if reuse_id and environment != "local":
        raise SystemExit("--reuse-provision-from is restricted to local synthetic runs.")
    if environment == "local":
        api_url = args.api_url or previous.get("target") or os.getenv("VDAGENT_API_URL", "http://localhost:8000/api/v1")
        frontend_url = os.getenv("VDAGENT_BASE_URL", "http://localhost:3000/")
        workspace_name = args.workspace_name or previous.get("workspace_name") or f"benchmark-{run_id}"
    else:
        api_url = args.api_url or previous.get("target") or API_DEFAULT
        frontend_url = "https://vdaagent.azurewebsites.net/"
        workspace_name = args.workspace_name or previous.get("workspace_name") or f"benchmark-{run_id}"

    local_auth_identity = _local_auth_identity(previous, source_id, run_id)

    metadata: dict[str, Any] = {
        **previous,
        "attempted_at": previous.get("attempted_at") or utc_now(),
        "updated_at": utc_now(),
        "language": "vi-VN",
        "environment": environment,
        "frontend": frontend_url,
        "production_evidence": environment == "production",
        "target": api_url,
        "workspace_name": workspace_name,
        "local_auth_identity": local_auth_identity if environment == "local" else None,
        "run_id": run_id,
        "requested_cases": len(selected),
        "selected_case_ids": [case["case_id"] for case in selected],
        "phase": "smoke" if args.smoke else "filtered" if args.case_id or args.category else "full",
        "mode": "judge_only" if args.judge_only else "auth_check" if args.auth_check else "execution" if args.execute else "dry_run",
        "fingerprint": execution_fingerprint(target=api_url, environment=environment, case_count=len(cases)),
    }

    if args.judge_only:
        if not resume_id:
            raise SystemExit("--judge-only requires --resume RUN_ID.")
        return _run_postprocessing(run_id, judge_only=True, baseline=args.baseline)
    if not args.execute and not args.auth_check:
        metadata.update({"status": "NOT_EXECUTED", "reason": "Pass --execute after a successful environment preflight."})
        write_json(directory / "execution_metadata.json", metadata)
        stage_status(directory, "execute", "NOT_EXECUTED", exit_code=0)
        return 0

    stage_status(directory, "preflight", "RUNNING")
    try:
        auth = (
            authenticate_local_guest(
                api_url=api_url,
                timeout=min(args.timeout, 30),
                identity=local_auth_identity,
            )
            if environment == "local"
            else authenticate(
                api_url=api_url, bearer_token=args.token, email=args.email,
                password=args.password, timeout=min(args.timeout, 30),
            )
        )
    except AuthenticationError as exc:
        stage = str(exc).split(" ", 1)[0]
        metadata.update({"status": "FAILED_AUTH", "error_type": type(exc).__name__, "error": stage})
        write_json(directory / "execution_metadata.json", metadata)
        stage_status(directory, "preflight", "FAILED", exit_code=2, reason=stage)
        print(f"Environment: {environment.upper()}\nAuthentication: FAIL ({stage})")
        return 2

    production = Production(api_url, auth, None, args.timeout)
    try:
        session_workspace = (
            (auth.session.get("workspace") or {}).get("id")
            if isinstance(auth.session.get("workspace"), dict) else None
        )
        frontend_status: int | None = None
        health_status: int | None = None
        health_payload: dict[str, Any] = {}
        if environment == "local":
            try:
                frontend_status = httpx.get(frontend_url, timeout=min(args.timeout, 30), follow_redirects=True).status_code
                health = httpx.get(
                    f"{api_url.split('/api/v1', 1)[0].rstrip('/')}/health",
                    timeout=min(args.timeout, 30), follow_redirects=True,
                )
                health_status = health.status_code
                health_payload = health.json() if health.headers.get("content-type", "").startswith("application/json") else {}
            except httpx.HTTPError:
                pass
        if not session_workspace:
            metadata.update({"status": "WORKSPACE_RESOLUTION_FAILED"})
            write_json(directory / "execution_metadata.json", metadata)
            stage_status(directory, "preflight", "FAILED", exit_code=2, reason="workspace_resolution")
            return 2
        production.workspace = str(session_workspace)
        scoped = production.request("GET", "/datasets")
        preflight_ok = scoped.status_code < 300 and (
            environment != "local" or (
                frontend_status is not None and frontend_status < 300
                and health_status is not None and health_status < 300
            )
        )
        auth_payload = {
            "timestamp": utc_now(), "environment": environment,
            "status": "PASS" if preflight_ok else "LOCAL_PREFLIGHT_OR_WORKSPACE_SCOPE_FAILED",
            "credentials_loaded": bool(args.password) if environment == "production" else "NOT_APPLICABLE",
            "local_guest_authentication": "PASS" if environment == "local" else "NOT_APPLICABLE",
            "supabase_authentication": "PASS" if environment == "production" else "NOT_APPLICABLE",
            "api_authentication": "PASS", "account_resolved": bool(auth.session.get("user")),
            "workspace_resolution": "PASS",
            "workspace_scoped_read": "PASS" if scoped.status_code < 300 else "FAIL",
            "auth_method": auth.method, "frontend_status_code": frontend_status,
            "backend_health_status_code": health_status, "backend_health": health_payload,
        }
        write_json(directory / "auth_check.json", auth_payload)
        stage_status(directory, "preflight", "COMPLETED" if preflight_ok else "FAILED", exit_code=0 if preflight_ok else 2)
        if args.auth_check:
            if preflight_ok:
                publish_alias(directory / "auth_check.json", RUNS / "auth_check.json")
            print(
                f"Environment: {environment.upper()}\nFrontend: {frontend_url} "
                f"({frontend_status if frontend_status is not None else 'NOT_CHECKED'})\n"
                f"Backend health: {health_status if health_status is not None else 'NOT_CHECKED'}\n"
                "Authentication: PASS\nWorkspace resolution: PASS\nWorkspace-scoped request: "
                + ("PASS" if scoped.status_code < 300 else "FAIL")
            )
            return 0 if preflight_ok else 2
        if not preflight_ok:
            metadata.update({"status": "FAILED_PREFLIGHT"})
            write_json(directory / "execution_metadata.json", metadata)
            return 2

        stage_status(directory, "provision", "RUNNING")
        dataset_mappings = dict(previous.get("dataset_mappings") or {})
        missing_datasets = _missing_datasets(selected, dataset_mappings)
        if args.skip_provision and missing_datasets:
            raise RuntimeError(
                "--skip-provision is missing required dataset mappings: "
                + ", ".join(missing_datasets)
            )
        newly_provisioned: set[str] = set()
        if not args.skip_provision and missing_datasets:
            workspace_id = (
                str(session_workspace)
                if environment == "local" and auth.method == "local_guest"
                else str(previous.get("workspace_id") or "")
                or production.workspace_for_run(workspace_name)
            )
            production.workspace = workspace_id
            resource_prefix = f"benchmark-{environment}-{run_id}"
            for name in missing_datasets:
                dataset_mappings[name] = production.upload_and_submit_profile(
                    f"{name}.csv", remote_name=f"{resource_prefix}-{name}.csv"
                )
                newly_provisioned.add(name)
                metadata.update({
                    "status": "PROFILES_SUBMITTED", "auth_method": auth.method,
                    "workspace_id": workspace_id, "dataset_mappings": dataset_mappings,
                })
                write_json(directory / "execution_metadata.json", scrub(metadata))
        else:
            workspace_id = str(previous.get("workspace_id") or session_workspace)
            production.workspace = workspace_id

        pending = {
            name: mapping for name, mapping in dataset_mappings.items()
            if name in _needed_datasets(selected)
        }
        deadline = time.monotonic() + 600
        while pending and time.monotonic() < deadline:
            completed_names: list[str] = []
            with ThreadPoolExecutor(max_workers=min(2, len(pending)), thread_name_prefix="benchmark-profile") as executor:
                futures = {
                    executor.submit(
                        production.advance_profile,
                        f"{name}.csv",
                        mapping,
                        args.auto_confirm,
                        bool(reuse_id) and name not in newly_provisioned,
                    ): name for name, mapping in pending.items()
                }
                for future in as_completed(futures):
                    if future.result():
                        completed_names.append(futures[future])
            for name in completed_names:
                pending.pop(name, None)
            if pending:
                time.sleep(3)
        if pending:
            raise TimeoutError("Profiles did not complete within 600 seconds: " + ", ".join(sorted(pending)))
        run_ids = {name: str(mapping["profile_run_id"]) for name, mapping in dataset_mappings.items()}
        if {"drift_v1", "drift_v2"}.issubset(run_ids) and not metadata.get("drift_ready"):
            try:
                drift_payload = production.detect_drift(run_ids["drift_v1"], run_ids["drift_v2"])
                metadata["drift_ready"] = True
                metadata["drift_finding_count"] = len(drift_payload.get("findings") or [])
            except Exception as exc:
                metadata["drift_ready"] = False
                metadata["drift_error"] = _safe_failure(exc)
        metadata.update({
            "status": "RUNNING", "auth_method": auth.method,
            "workspace_id": workspace_id, "dataset_mappings": dataset_mappings,
            "profile_runs": run_ids, "worker_readiness": "PASS",
        })
        write_json(directory / "execution_metadata.json", scrub(metadata))
        stage_status(directory, "provision", "COMPLETED", exit_code=0)
    except Exception as exc:
        metadata.update({
            "status": "FAILED_SETUP", "error_type": type(exc).__name__,
            "error": _safe_failure(exc), "dataset_mappings": locals().get("dataset_mappings", {}),
            "workspace_id": locals().get("workspace_id"),
        })
        write_json(directory / "execution_metadata.json", scrub(metadata))
        stage_status(directory, "provision", "FAILED", exit_code=2, reason=_safe_failure(exc))
        production.close()
        return 2

    stage_status(directory, "execute", "RUNNING")
    raw_path = directory / "raw_results.jsonl"
    raw = read_jsonl(raw_path) if resume_id else []
    completed_attempts = {(str(row.get("case_id")), int(row.get("attempt") or 0)) for row in raw}

    def execute_case(case: dict[str, Any]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for attempt in range(1, _expected_attempts(case) + 1):
            if (case["case_id"], attempt) in completed_attempts:
                continue
            turns = case.get("turns") or [{"role": "user", "text": case["question"]}]
            conversation_id = f"benchmark-{uuid.uuid4().hex}"
            history: list[dict[str, Any]] = []
            result: dict[str, Any] | None = None
            turn_telemetry: list[dict[str, Any]] = []
            try:
                for turn in turns:
                    question = str(turn.get("text") or turn.get("question") or "")
                    result = production.ask(
                        question, run_ids.get(case["dataset"], run_ids["profiling_base"]),
                        args.case_timeout, history=history,
                        conversation_id=conversation_id if len(turns) > 1 else None,
                        persist=len(turns) > 1,
                    )
                    turn_telemetry.append(result["telemetry"])
                    answer = str((result.get("response") or {}).get("answer") or "")
                    history.extend([
                        {"role": "user", "text": question, "profile_run_id": run_ids.get(case["dataset"])},
                        {"role": "agent", "text": answer or "No answer was produced.", "profile_run_id": run_ids.get(case["dataset"])},
                    ])
                    if result["status_code"] >= 400 or result["response"].get("error"):
                        break
                assert result is not None
                telemetry = {
                    **result["telemetry"],
                    "total_latency_ms": round(sum(float(item.get("total_latency_ms") or 0) for item in turn_telemetry), 3),
                    "turn_count": len(turn_telemetry),
                }
                rows.append(scrub({
                    "case_id": case["case_id"], "language": "vi-VN",
                    "environment": environment, "run_id": run_id, "attempt": attempt,
                    "timestamp": utc_now(), "dataset": case["dataset"],
                    "question": case["question"], "turn_count": len(turns),
                    "status": "OK" if result["status_code"] < 400 and not result["response"].get("error") else "ERROR",
                    "status_code": result["status_code"], "response": result["response"],
                    "telemetry": telemetry,
                }))
                # A 200 SSE stream carrying a product/graph error is a logic
                # failure, not a transport failure; do not spend repeated
                # attempts on it.  Bounded repeats remain for OK hard cases
                # and for explicitly retryable 429/5xx/transport outcomes.
                if result["response"].get("error") and result["status_code"] < 400:
                    break
            except Exception as exc:
                rows.append({
                    "case_id": case["case_id"], "language": "vi-VN",
                    "environment": environment, "run_id": run_id, "attempt": attempt,
                    "timestamp": utc_now(), "dataset": case["dataset"],
                    "question": case["question"], "status": "ERROR", "status_code": 502,
                    "error": _safe_failure(exc), "telemetry": {"turn_count": len(turn_telemetry)},
                })
        return rows

    try:
        if args.qa_concurrency == 1:
            for case in selected:
                raw.extend(execute_case(case))
                write_jsonl(raw_path, raw)
        else:
            with ThreadPoolExecutor(max_workers=args.qa_concurrency, thread_name_prefix="benchmark-qa") as executor:
                futures = {executor.submit(execute_case, case): case["case_id"] for case in selected}
                for future in as_completed(futures):
                    raw.extend(future.result())
                    raw.sort(key=lambda row: (row["case_id"], row["attempt"]))
                    write_jsonl(raw_path, raw)
        write_jsonl(directory / "repeated_runs.jsonl", [row for row in raw if int(row.get("attempt") or 0) > 1])
        metadata.update({
            "status": "COMPLETED", "completed_at": utc_now(), "executed_requests": len(raw),
            "executed_cases": len({row.get("case_id") for row in raw}),
        })
        write_json(directory / "execution_metadata.json", scrub(metadata))
        stage_status(directory, "execute", "COMPLETED", exit_code=0)
        publish_alias(raw_path, RUNS / "raw_results.jsonl")
        publish_alias(directory / "repeated_runs.jsonl", RUNS / "repeated_runs.jsonl")
        publish_alias(directory / "execution_metadata.json", RUNS / "execution_metadata.json")
    except Exception as exc:
        metadata.update({"status": "FAILED_EXECUTION", "error_type": type(exc).__name__, "error": _safe_failure(exc)})
        write_json(directory / "execution_metadata.json", scrub(metadata))
        stage_status(directory, "execute", "FAILED", exit_code=2, reason=_safe_failure(exc))
        return 2
    finally:
        production.close()

    return 0 if args.no_postprocess else _run_postprocessing(run_id, baseline=args.baseline)


if __name__ == "__main__":
    raise SystemExit(main())
