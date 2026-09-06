"""Canonical dataset ingestion orchestration.

External providers end at this boundary. Internal profiling receives only an
immutable Supabase/local artifact reference recorded in PostgreSQL.
"""

from __future__ import annotations

import hashlib
import json
import logging
import mimetypes
import os
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePath
from typing import Any
from uuid import uuid4

from src.config import Settings, get_settings
from src.services.repository import Repository, get_repository
from src.services.storage import (
    ObjectStat,
    StorageDownloadError,
    StorageUploadError,
    canonical_object_key,
    get_object_storage,
)

logger = logging.getLogger(__name__)


class IngestionError(RuntimeError):
    def __init__(self, message: str, *, code: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def source_format(filename: str) -> str:
    suffix = PurePath(filename).suffix.lower()
    if suffix == ".parquet":
        return "parquet"
    if suffix == ".json":
        return "json"
    if suffix in {".csv", ".tsv"}:
        return "csv"
    raise IngestionError("Unsupported dataset file type.", code="unsupported_file_type")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class DatasetIngestionService:
    def __init__(
        self,
        repository: Repository | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.repository = repository or get_repository(self.settings)
        self.storage = get_object_storage(self.settings)

    @property
    def provider(self) -> str:
        return self.storage.provider

    def reserve(
        self,
        *,
        workspace_id: str,
        user_id: str,
        idempotency_key: str,
        kind: str,
        filename: str,
        dataset_name: str,
        expected_size_bytes: int | None,
        content_type: str | None,
        source_type: str,
        source_metadata: dict[str, Any] | None = None,
        expires_in_seconds: int | None = None,
    ) -> dict[str, Any]:
        dataset_id = uuid4().hex
        artifact_id = uuid4().hex
        ingestion_id = uuid4().hex
        object_key = canonical_object_key(
            workspace_id, dataset_id, artifact_id, filename
        )
        stable_source_metadata = {
            key: value
            for key, value in (source_metadata or {}).items()
            if key not in {"imported_at"}
        }
        request_payload = {
            "kind": kind,
            "filename": filename,
            "dataset_name": dataset_name,
            "expected_size_bytes": expected_size_bytes,
            "content_type": content_type,
            "source_type": source_type,
            "source_metadata": stable_source_metadata,
        }
        request_hash = hashlib.sha256(
            json.dumps(request_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        expires_at = (
            datetime.now(UTC) + timedelta(seconds=expires_in_seconds)
            if expires_in_seconds
            else None
        )
        row = self.repository.reserve_dataset_ingestion(
            ingestion_id=ingestion_id,
            dataset_id=dataset_id,
            artifact_id=artifact_id,
            workspace_id=workspace_id,
            created_by_user_id=user_id,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            kind=kind,
            dataset_name=dataset_name,
            dataset_source_type=source_format(filename),
            storage_provider=self.storage.provider,
            bucket=self.storage.bucket,
            object_key=object_key,
            original_filename=filename,
            source_type=source_type,
            source_metadata=source_metadata or {},
            ingestion_key=f"{kind}:{idempotency_key}",
            expected_size_bytes=expected_size_bytes,
            expires_at=expires_at,
            details={"content_type": content_type},
        )
        if row.get("conflict"):
            raise IngestionError(
                "Idempotency-Key was already used for a different ingestion.",
                code="idempotency_conflict",
            )
        if row.get("status") in {"failed", "expired"}:
            raise IngestionError(
                "This ingestion cannot be retried with the same idempotency key.",
                code="ingestion_terminal",
            )
        return row

    def ingest_path(
        self,
        path: Path,
        *,
        workspace_id: str,
        user_id: str,
        idempotency_key: str,
        kind: str,
        filename: str,
        dataset_name: str,
        content_type: str | None,
        source_type: str,
        source_metadata: dict[str, Any] | None = None,
        source_version: str | None = None,
    ) -> dict[str, Any]:
        size = path.stat().st_size
        if size <= 0:
            raise IngestionError("Dataset file is empty.", code="empty_file")
        row = self.reserve(
            workspace_id=workspace_id,
            user_id=user_id,
            idempotency_key=idempotency_key,
            kind=kind,
            filename=filename,
            dataset_name=dataset_name,
            expected_size_bytes=size,
            content_type=content_type,
            source_type=source_type,
            source_metadata=source_metadata,
        )
        if row.get("status") == "finalized":
            return row
        artifact = self.repository.get_dataset_artifact(
            str(row["artifact_id"]), workspace_id=workspace_id
        )
        if not artifact:
            raise IngestionError("Ingestion artifact is missing.", code="artifact_missing")
        object_key = str(artifact["object_key"])
        canonical_upload_ms = 0.0
        try:
            verify_started = time.perf_counter()
            observed = self.storage.stat(object_key)
            canonical_verify_ms = round(
                (time.perf_counter() - verify_started) * 1000, 2
            )
            if observed is None:
                upload_started = time.perf_counter()
                try:
                    self.storage.put(path, object_key, content_type)
                except StorageUploadError as exc:
                    # Another request with the same idempotency key may have
                    # won the immutable create race. Verification decides
                    # whether that object is safe to reuse.
                    if exc.status != 409:
                        raise
                canonical_upload_ms = round(
                    (time.perf_counter() - upload_started) * 1000, 2
                )
                verify_started = time.perf_counter()
                observed = self.storage.stat(object_key)
                canonical_verify_ms += round(
                    (time.perf_counter() - verify_started) * 1000, 2
                )
            if observed is None:
                raise IngestionError(
                    "Canonical object was not visible after upload.",
                    code="canonical_verify_failed",
                    retryable=True,
                )
            if observed.size_bytes != size:
                raise IngestionError(
                    "Canonical object size does not match the source.",
                    code="canonical_size_mismatch",
                )
            finalize_started = time.perf_counter()
            finalized = self.repository.finalize_dataset_ingestion(
                str(row["id"]),
                workspace_id=workspace_id,
                size_bytes=observed.size_bytes,
                content_type=observed.content_type or content_type,
                content_sha256=sha256_file(path),
                source_version=source_version or observed.etag,
            )
            if not finalized:
                raise IngestionError("Ingestion disappeared during finalize.", code="ingestion_missing")
            logger.info(
                "dataset_ingestion_finalized",
                extra={
                    "ingestion_id": str(row["id"]),
                    "dataset_id": str(row["dataset_id"]),
                    "workspace_id": workspace_id,
                    "storage_provider": self.storage.provider,
                    "size_bytes": size,
                    "canonical_upload_ms": canonical_upload_ms,
                    "canonical_verify_ms": canonical_verify_ms,
                    "metadata_finalize_ms": round(
                        (time.perf_counter() - finalize_started) * 1000, 2
                    ),
                },
            )
            return finalized
        except IngestionError as exc:
            if not exc.retryable:
                self.repository.fail_dataset_ingestion(
                    str(row["id"]), workspace_id=workspace_id, error_code=exc.code
                )
            raise
        except StorageUploadError as exc:
            retryable = exc.status in {408, 425, 429} or (
                isinstance(exc.status, int) and exc.status >= 500
            )
            if not retryable:
                self.repository.fail_dataset_ingestion(
                    str(row["id"]), workspace_id=workspace_id, error_code="storage_unavailable"
                )
            raise IngestionError(
                "Canonical storage rejected the dataset.",
                code="storage_unavailable",
                retryable=retryable,
            ) from exc
        except StorageDownloadError as exc:
            if not exc.retryable:
                self.repository.fail_dataset_ingestion(
                    str(row["id"]),
                    workspace_id=workspace_id,
                    error_code="storage_verify_unavailable",
                )
            raise IngestionError(
                "Canonical storage could not verify the dataset.",
                code="storage_verify_unavailable",
                retryable=exc.retryable,
            ) from exc

    def create_signed_upload(
        self,
        *,
        workspace_id: str,
        user_id: str,
        idempotency_key: str,
        filename: str,
        dataset_name: str,
        size_bytes: int,
        content_type: str | None,
    ) -> dict[str, Any]:
        if self.storage.provider != "supabase" or not hasattr(
            self.storage, "create_signed_upload"
        ):
            raise IngestionError(
                "Direct uploads require Supabase canonical storage.",
                code="direct_upload_unavailable",
            )
        row = self.reserve(
            workspace_id=workspace_id,
            user_id=user_id,
            idempotency_key=idempotency_key,
            kind="upload",
            filename=filename,
            dataset_name=dataset_name,
            expected_size_bytes=size_bytes,
            content_type=content_type,
            source_type="upload",
            expires_in_seconds=2 * 60 * 60,
        )
        if row.get("status") == "finalized":
            artifact = self.repository.get_dataset_artifact(
                str(row["artifact_id"]), workspace_id=workspace_id
            )
            return {
                **row,
                "token": "",
                "signed_url": "",
                "bucket": (artifact or {}).get("bucket") or self.storage.bucket,
                "object_key": (artifact or {}).get("object_key") or "",
            }
        artifact = self.repository.get_dataset_artifact(
            str(row["artifact_id"]), workspace_id=workspace_id
        )
        if not artifact:
            raise IngestionError("Upload artifact is missing.", code="artifact_missing")
        try:
            signed = self.storage.create_signed_upload(str(artifact["object_key"]))  # type: ignore[attr-defined]
        except StorageUploadError as exc:
            raise IngestionError(
                "Canonical storage could not authorize the direct upload.",
                code="signed_upload_unavailable",
                retryable=exc.status in {408, 425, 429}
                or (isinstance(exc.status, int) and exc.status >= 500),
            ) from exc
        return {**row, **signed, "bucket": self.storage.bucket, "object_key": artifact["object_key"]}

    def finalize_signed_upload(
        self, ingestion_id: str, *, workspace_id: str
    ) -> dict[str, Any]:
        ingestion = self.repository.get_dataset_ingestion(
            ingestion_id, workspace_id=workspace_id
        )
        if not ingestion:
            raise IngestionError("Upload session was not found.", code="ingestion_missing")
        if ingestion["status"] == "finalized":
            return ingestion
        artifact = self.repository.get_dataset_artifact(
            str(ingestion["artifact_id"]), workspace_id=workspace_id
        )
        if not artifact:
            raise IngestionError("Upload artifact is missing.", code="artifact_missing")
        try:
            observed: ObjectStat | None = self.storage.stat(str(artifact["object_key"]))
        except StorageDownloadError as exc:
            raise IngestionError(
                "Canonical storage could not verify the uploaded object.",
                code="storage_verify_unavailable",
                retryable=exc.retryable,
            ) from exc
        if observed is None:
            raise IngestionError(
                "Uploaded object was not found. Complete the upload before finalizing.",
                code="object_not_found",
            )
        try:
            finalized = self.repository.finalize_dataset_ingestion(
                ingestion_id,
                workspace_id=workspace_id,
                size_bytes=observed.size_bytes,
                content_type=observed.content_type,
                content_sha256=None,
                source_version=observed.etag,
            )
        except ValueError as exc:
            self.repository.fail_dataset_ingestion(
                ingestion_id,
                workspace_id=workspace_id,
                error_code="canonical_size_mismatch",
            )
            raise IngestionError(
                "Uploaded object size does not match the reserved size.",
                code="canonical_size_mismatch",
            ) from exc
        if not finalized:
            raise IngestionError("Upload session was not found.", code="ingestion_missing")
        return finalized

    def canonicalize_legacy_drive_dataset(
        self, dataset: dict[str, Any], *, workspace_id: str
    ) -> dict[str, Any]:
        """Lazily copy one legacy gdrive:// source, safely reusable on retry."""
        from src.services.google_drive import GoogleDriveConnector, parse_google_drive_ref

        current = self.repository.get_current_dataset_artifact(
            str(dataset["id"]), workspace_id=workspace_id
        )
        if current:
            return current
        source_ref = str(dataset.get("source_ref") or "")
        source_workspace, file_id, filename = parse_google_drive_ref(source_ref)
        if source_workspace != workspace_id:
            raise IngestionError(
                "Legacy Drive source is not owned by this workspace.",
                code="workspace_mismatch",
            )
        artifact_id = uuid4().hex
        object_key = canonical_object_key(
            workspace_id, str(dataset["id"]), artifact_id, filename
        )
        ingestion_key = "legacy-drive:" + hashlib.sha256(source_ref.encode()).hexdigest()
        reserved = self.repository.reserve_artifact_for_existing_dataset(
            artifact_id=artifact_id,
            dataset_id=str(dataset["id"]),
            workspace_id=workspace_id,
            storage_provider=self.storage.provider,
            bucket=self.storage.bucket,
            object_key=object_key,
            original_filename=filename,
            source_type="google_drive",
            source_metadata={"external_file_id": file_id, "legacy_source_ref": source_ref},
            ingestion_key=ingestion_key,
        )
        if reserved["status"] == "ready":
            return reserved
        connector = GoogleDriveConnector(self.settings)
        connector_started = time.perf_counter()
        metadata = connector.metadata(workspace_id, file_id)
        limit = self.settings.security_max_upload_mb * 1024 * 1024
        fd, temp_name = tempfile.mkstemp(
            prefix="p170-legacy-drive-", suffix=PurePath(filename).suffix
        )
        os.close(fd)
        temporary = Path(temp_name)
        try:
            connector.download(workspace_id, file_id, temporary, max_bytes=limit)
            connector_ms = round((time.perf_counter() - connector_started) * 1000, 2)
            object_key = str(reserved["object_key"])
            observed = self.storage.stat(object_key)
            if observed is None:
                try:
                    self.storage.put(
                        temporary,
                        object_key,
                        str(metadata.get("mimeType") or "application/octet-stream"),
                    )
                except StorageUploadError as exc:
                    if exc.status != 409:
                        raise
                observed = self.storage.stat(object_key)
            if observed is None or observed.size_bytes != temporary.stat().st_size:
                raise IngestionError(
                    "Legacy Drive canonical object verification failed.",
                    code="canonical_verify_failed",
                    retryable=True,
                )
            result = self.repository.finalize_existing_dataset_artifact(
                str(reserved["id"]),
                workspace_id=workspace_id,
                size_bytes=observed.size_bytes,
                content_type=observed.content_type,
                content_sha256=sha256_file(temporary),
                source_version=str(metadata.get("version") or metadata.get("md5Checksum") or "") or None,
            )
            logger.info(
                "legacy_drive_dataset_canonicalized",
                extra={
                    "dataset_id": str(dataset["id"]),
                    "workspace_id": workspace_id,
                    "connector_download_ms": connector_ms,
                    "size_bytes": observed.size_bytes,
                },
            )
            return result
        except StorageDownloadError as exc:
            raise IngestionError(
                "Canonical storage could not verify the legacy Drive copy.",
                code="storage_verify_unavailable",
                retryable=exc.retryable,
            ) from exc
        except StorageUploadError as exc:
            retryable = exc.status in {408, 425, 429} or (
                isinstance(exc.status, int) and exc.status >= 500
            )
            raise IngestionError(
                "Canonical storage rejected the legacy Drive copy.",
                code="storage_unavailable",
                retryable=retryable,
            ) from exc
        finally:
            temporary.unlink(missing_ok=True)


def upload_content_type(filename: str, provided: str | None) -> str:
    return provided or mimetypes.guess_type(filename)[0] or "application/octet-stream"


__all__ = [
    "DatasetIngestionService",
    "IngestionError",
    "sha256_file",
    "source_format",
    "upload_content_type",
]
