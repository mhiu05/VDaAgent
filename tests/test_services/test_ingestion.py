"""Focused coverage for canonical ingestion state and retry behavior."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from src.services.ingestion import DatasetIngestionService, IngestionError
from src.services.storage import ObjectStat, StorageUploadError


class _Repository:
    def __init__(self) -> None:
        self.row = {
            "id": "ingestion-a",
            "dataset_id": "dataset-a",
            "artifact_id": "artifact-a",
            "status": "pending",
        }
        self.artifact = {"id": "artifact-a", "object_key": "canonical/source.csv"}
        self.failed: list[str] = []
        self.finalize_calls = 0
        self.request_hashes: list[str] = []

    def reserve_dataset_ingestion(self, **values: object) -> dict[str, object]:
        self.request_hashes.append(str(values["request_hash"]))
        return {**self.row, "conflict": False, "duplicate": self.row["status"] == "finalized"}

    def get_dataset_artifact(self, _artifact_id: str, *, workspace_id: str) -> dict[str, object]:
        assert workspace_id == "workspace-a"
        return self.artifact

    def get_dataset_ingestion(self, _ingestion_id: str, *, workspace_id: str) -> dict[str, object]:
        assert workspace_id == "workspace-a"
        return dict(self.row)

    def finalize_dataset_ingestion(self, _ingestion_id: str, **_values: object) -> dict[str, object]:
        self.finalize_calls += 1
        self.row["status"] = "finalized"
        return dict(self.row)

    def fail_dataset_ingestion(self, _ingestion_id: str, *, workspace_id: str, error_code: str) -> bool:
        assert workspace_id == "workspace-a"
        self.failed.append(error_code)
        self.row["status"] = "failed"
        return True


class _Storage:
    provider = "local"
    bucket = None

    def __init__(self, *, fail_once: bool = False) -> None:
        self.object: bytes | None = None
        self.put_calls = 0
        self.fail_once = fail_once

    def stat(self, _object_key: str) -> ObjectStat | None:
        return ObjectStat(len(self.object)) if self.object is not None else None

    def put(self, path: Path, _object_key: str, _content_type: str | None) -> None:
        self.put_calls += 1
        if self.fail_once:
            self.fail_once = False
            raise StorageUploadError("temporary", status=503)
        self.object = path.read_bytes()


def _service(repo: _Repository, adapter: _Storage) -> DatasetIngestionService:
    service = object.__new__(DatasetIngestionService)
    service.settings = SimpleNamespace()
    service.repository = repo
    service.storage = adapter
    return service


def _ingest(service: DatasetIngestionService, path: Path) -> dict[str, object]:
    return service.ingest_path(
        path,
        workspace_id="workspace-a",
        user_id="user-a",
        idempotency_key="retry-key-a",
        kind="upload",
        filename="source.csv",
        dataset_name="Source",
        content_type="text/csv",
        source_type="upload",
    )


def test_ingest_path_is_idempotent_after_finalize(tmp_path: Path) -> None:
    path = tmp_path / "source.csv"
    path.write_bytes(b"id\n1\n")
    repo = _Repository()
    adapter = _Storage()
    service = _service(repo, adapter)

    first = _ingest(service, path)
    second = _ingest(service, path)

    assert first["status"] == second["status"] == "finalized"
    assert adapter.put_calls == 1
    assert repo.finalize_calls == 1
    assert repo.failed == []


def test_retryable_storage_failure_keeps_ingestion_recoverable(tmp_path: Path) -> None:
    path = tmp_path / "source.csv"
    path.write_bytes(b"id\n1\n")
    repo = _Repository()
    adapter = _Storage(fail_once=True)
    service = _service(repo, adapter)

    with pytest.raises(IngestionError) as failed:
        _ingest(service, path)
    assert failed.value.retryable is True
    assert repo.row["status"] == "pending"
    assert repo.failed == []

    recovered = _ingest(service, path)
    assert recovered["status"] == "finalized"
    assert adapter.put_calls == 2


def test_non_retryable_size_mismatch_marks_ingestion_failed(tmp_path: Path) -> None:
    path = tmp_path / "source.csv"
    path.write_bytes(b"id\n1\n")
    repo = _Repository()
    adapter = _Storage()
    adapter.object = b"different-size"
    service = _service(repo, adapter)

    with pytest.raises(IngestionError) as failed:
        _ingest(service, path)

    assert failed.value.code == "canonical_size_mismatch"
    assert repo.failed == ["canonical_size_mismatch"]
    assert repo.row["status"] == "failed"


def test_drive_import_timestamp_is_not_part_of_idempotency_identity() -> None:
    repo = _Repository()
    service = _service(repo, _Storage())
    common = {
        "workspace_id": "workspace-a",
        "user_id": "user-a",
        "idempotency_key": "drive-retry-key",
        "kind": "google_drive",
        "filename": "source.csv",
        "dataset_name": "Source",
        "expected_size_bytes": 10,
        "content_type": "text/csv",
        "source_type": "google_drive",
    }

    service.reserve(
        **common,
        source_metadata={"external_file_id": "file-a", "imported_at": "2026-01-01T00:00:00Z"},
    )
    service.reserve(
        **common,
        source_metadata={"external_file_id": "file-a", "imported_at": "2026-01-01T00:00:01Z"},
    )

    assert len(set(repo.request_hashes)) == 1


def test_signed_upload_finalize_is_idempotent() -> None:
    repo = _Repository()
    adapter = _Storage()
    adapter.provider = "supabase"
    adapter.bucket = "datasets"
    adapter.object = b"id\n1\n"
    service = _service(repo, adapter)

    first = service.finalize_signed_upload("ingestion-a", workspace_id="workspace-a")
    second = service.finalize_signed_upload("ingestion-a", workspace_id="workspace-a")

    assert first["status"] == second["status"] == "finalized"
    assert repo.finalize_calls == 1
