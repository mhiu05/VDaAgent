"""Focused durability, concurrency, and authorization tests for profile jobs."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from src.config import get_settings
from src.services.profile_service import ProfileError
from src.services.repository import Repository, get_repository
from src.workers.profiling_worker import ProfilingWorker


def _headers() -> dict[str, str]:
    return {"Idempotency-Key": uuid4().hex}


def _submit(client: TestClient, sample_csv: Path, **overrides: object) -> dict:
    payload: dict[str, object] = {
        "dataset_ref": str(sample_csv),
        "dataset_name": f"job-{uuid4().hex[:8]}",
        "scan_mode": "full",
    }
    payload.update(overrides)
    response = client.post("/api/v1/profile", headers=_headers(), json=payload)
    assert response.status_code == 202, response.text
    return response.json()


def _drain(repo: Repository) -> None:
    """Remove abandoned queue work from earlier runs of the isolated test DB."""
    repo.recover_stale_profile_jobs()
    while job := repo.claim_profile_job(worker_id="pytest-drain", lease_seconds=30):
        repo.fail_profile_job(
            str(job["id"]),
            claim_token=str(job["job_claim_token"]),
            error_code="test_cleanup",
            safe_message="Test queue cleanup.",
            retryable=False,
        )


def test_submission_is_durable_and_idempotent(
    client: TestClient, sample_csv: Path
) -> None:
    _drain(get_repository())
    key = uuid4().hex
    payload = {
        "dataset_ref": str(sample_csv),
        "dataset_name": f"idempotent-{uuid4().hex[:8]}",
        "scan_mode": "full",
    }
    first = client.post(
        "/api/v1/profile", headers={"Idempotency-Key": key}, json=payload
    )
    second = client.post(
        "/api/v1/profile", headers={"Idempotency-Key": key}, json=payload
    )
    assert first.status_code == second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"]
    assert first.json()["status"] == "queued"
    assert second.json()["duplicate"] is True

    conflict = client.post(
        "/api/v1/profile",
        headers={"Idempotency-Key": key},
        json={**payload, "run_name": "different logical request"},
    )
    assert conflict.status_code == 409

    job = get_repository().claim_profile_job(
        worker_id="pytest-cleanup", lease_seconds=30
    )
    assert job and job["id"] == first.json()["job_id"]
    get_repository().fail_profile_job(
        str(job["id"]),
        claim_token=str(job["job_claim_token"]),
        error_code="test_cleanup",
        safe_message="Test queue cleanup.",
        retryable=False,
    )


def test_submission_requires_backend_idempotency_key(
    client: TestClient, sample_csv: Path
) -> None:
    response = client.post(
        "/api/v1/profile",
        json={"dataset_ref": str(sample_csv), "scan_mode": "full"},
    )
    assert response.status_code == 422


def test_two_workers_can_claim_one_job_only_once(
    client: TestClient, sample_csv: Path
) -> None:
    repo = get_repository()
    _drain(repo)
    submitted = _submit(client, sample_csv)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda worker: repo.claim_profile_job(
                    worker_id=worker, lease_seconds=60
                ),
                ("worker-a", "worker-b"),
            )
        )
    claimed = [item for item in results if item]
    assert len(claimed) == 1
    assert claimed[0]["id"] == submitted["job_id"]
    repo.fail_profile_job(
        submitted["job_id"],
        claim_token=str(claimed[0]["job_claim_token"]),
        error_code="test_cleanup",
        safe_message="Test queue cleanup.",
        retryable=False,
    )


def test_worker_transitions_queued_running_succeeded(
    client: TestClient, sample_csv: Path, monkeypatch
) -> None:
    repo = get_repository()
    _drain(repo)
    submitted = _submit(client, sample_csv)
    worker = ProfilingWorker(repo, worker_id="worker-success")

    async def succeed(job: dict) -> dict:
        assert job["job_status"] == "running"
        repo.update_profile_run(
            str(job["id"]),
            workspace_id=str(job["workspace_id"]),
            status="pending_review",
        )
        return {"run_id": job["id"]}

    monkeypatch.setattr(worker.service, "execute_profile_job", succeed)
    assert asyncio.run(worker.run_once())
    status = client.get(f"/api/v1/profiling-jobs/{submitted['job_id']}")
    assert status.status_code == 200
    assert status.json()["status"] == "succeeded"
    assert status.json()["result_id"] == submitted["profiling_run_id"]


def test_worker_persists_safe_non_retryable_failure(
    client: TestClient, sample_csv: Path, monkeypatch
) -> None:
    repo = get_repository()
    _drain(repo)
    submitted = _submit(client, sample_csv)
    worker = ProfilingWorker(repo, worker_id="worker-failure")

    async def fail(_job: dict) -> dict:
        raise ProfileError(
            "Safe client failure.", 400, error_code="invalid_dataset"
        )

    monkeypatch.setattr(worker.service, "execute_profile_job", fail)
    assert asyncio.run(worker.run_once())
    status = client.get(f"/api/v1/profiling-jobs/{submitted['job_id']}").json()
    assert status["status"] == "failed"
    assert status["error"] == {
        "code": "invalid_dataset",
        "message": "Safe client failure.",
    }


def test_retryable_failure_requeues_with_bounded_attempts(
    client: TestClient, sample_csv: Path, monkeypatch
) -> None:
    repo = get_repository()
    _drain(repo)
    submitted = _submit(client, sample_csv)
    worker = ProfilingWorker(repo, worker_id="worker-retry")

    async def transient(_job: dict) -> dict:
        raise ProfileError(
            "Temporarily unavailable.",
            503,
            error_code="database_unavailable",
            retryable=True,
        )

    monkeypatch.setattr(worker.service, "execute_profile_job", transient)
    assert asyncio.run(worker.run_once())
    queued = repo.get_profile_job(submitted["job_id"])
    assert queued and queued["job_status"] == "queued"
    assert queued["job_attempt_count"] == 1

    repo.update_profile_run(
        submitted["job_id"], job_available_at=datetime.now(UTC) - timedelta(seconds=1)
    )

    async def succeed(job: dict) -> dict:
        repo.update_profile_run(str(job["id"]), status="pending_review")
        return {"run_id": job["id"]}

    monkeypatch.setattr(worker.service, "execute_profile_job", succeed)
    assert asyncio.run(worker.run_once())
    completed = repo.get_profile_job(submitted["job_id"])
    assert completed and completed["job_status"] == "succeeded"
    assert completed["job_attempt_count"] == 2


def test_expired_worker_lease_is_recovered(
    client: TestClient, sample_csv: Path
) -> None:
    repo = get_repository()
    _drain(repo)
    submitted = _submit(client, sample_csv)
    claimed = repo.claim_profile_job(worker_id="worker-crashed", lease_seconds=30)
    assert claimed and claimed["id"] == submitted["job_id"]
    repo.update_profile_run(
        submitted["job_id"],
        job_lease_expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    recovered = repo.recover_stale_profile_jobs()
    assert recovered == [
        {
            "job_id": submitted["job_id"],
            "workspace_id": str(claimed["workspace_id"]),
            "status": "queued",
        }
    ]
    next_claim = repo.claim_profile_job(worker_id="worker-replacement", lease_seconds=30)
    assert next_claim and next_claim["id"] == submitted["job_id"]
    repo.fail_profile_job(
        submitted["job_id"],
        claim_token=str(next_claim["job_claim_token"]),
        error_code="test_cleanup",
        safe_message="Test queue cleanup.",
        retryable=False,
    )


def test_job_status_is_workspace_scoped(
    client: TestClient, sample_csv: Path, monkeypatch
) -> None:
    _drain(get_repository())
    monkeypatch.setattr(get_settings(), "auth_allow_guest", True)
    first_headers = {
        "Authorization": f"Bearer guest.{uuid4()}.analyst",
        "Idempotency-Key": uuid4().hex,
    }
    second_headers = {
        "Authorization": f"Bearer guest.{uuid4()}.analyst",
        "Idempotency-Key": uuid4().hex,
    }
    first_session = client.get("/api/v1/session", headers=first_headers).json()
    second_session = client.get("/api/v1/session", headers=second_headers).json()
    first_headers["X-Workspace-Id"] = first_session["workspace"]["id"]
    second_headers["X-Workspace-Id"] = second_session["workspace"]["id"]

    submitted = client.post(
        "/api/v1/profile",
        headers=first_headers,
        json={"dataset_ref": str(sample_csv), "scan_mode": "full"},
    )
    assert submitted.status_code == 202
    hidden = client.get(
        f"/api/v1/profiling-jobs/{submitted.json()['job_id']}",
        headers=second_headers,
    )
    assert hidden.status_code == 404

    claimed = get_repository().claim_profile_job(
        worker_id="pytest-cleanup", lease_seconds=30
    )
    assert claimed and claimed["id"] == submitted.json()["job_id"]
    get_repository().fail_profile_job(
        str(claimed["id"]),
        claim_token=str(claimed["job_claim_token"]),
        error_code="test_cleanup",
        safe_message="Test queue cleanup.",
        retryable=False,
    )
