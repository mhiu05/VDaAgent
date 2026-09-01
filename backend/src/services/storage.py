"""Supabase Storage integration for immutable dataset sources.

The API stores only a stable ``supabase://bucket/object`` reference in the
metadata database.  Compute code materializes that object into an ephemeral
file for DuckDB/pandas and removes it after the operation.  This keeps the
source of truth in Supabase while preserving the existing local compute
contract.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import os
import shutil
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import quote, urljoin, urlsplit

# pyrefly: ignore [missing-import]
import httpx
from src.config import Settings, get_settings
from src.services.tabular_source import utf8_tabular_source

logger = logging.getLogger(__name__)


class StorageNotConfiguredError(RuntimeError):
    """Raised when a production storage operation lacks Supabase credentials."""


class StorageReferenceError(ValueError):
    """Raised for malformed or unsupported storage references."""


class StorageUploadError(RuntimeError):
    """Raised when Supabase Storage cannot persist an upload."""

    def __init__(self, message: str, *, status: int | str | None = None) -> None:
        super().__init__(message)
        self.status = status


class StorageDownloadError(RuntimeError):
    """Raised when a remote source cannot be streamed safely to local disk."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass(frozen=True)
class ObjectStat:
    size_bytes: int
    content_type: str | None = None
    etag: str | None = None


class ObjectStorage(Protocol):
    provider: str
    bucket: str | None

    def put(self, local_path: Path, object_path: str, content_type: str | None = None) -> None: ...
    def stat(self, object_path: str) -> ObjectStat | None: ...
    def download_to_path(self, object_path: str, destination: Path, *, max_bytes: int) -> int: ...
    def delete(self, object_path: str) -> None: ...
    def list_objects(self, prefix: str) -> Iterator[str]: ...


def is_supabase_ref(value: str) -> bool:
    return value.lower().startswith("supabase://")


def is_local_object_ref(value: str) -> bool:
    return value.lower().startswith("local-object:///")


def parse_local_object_ref(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme.lower() != "local-object" or parsed.netloc:
        raise StorageReferenceError("Invalid local canonical object reference.")
    object_path = parsed.path.lstrip("/")
    if not object_path or ".." in Path(object_path).parts:
        raise StorageReferenceError("Invalid local canonical object path.")
    return object_path


def parse_supabase_ref(value: str) -> tuple[str, str]:
    parsed = urlsplit(value)
    if parsed.scheme.lower() != "supabase" or not parsed.netloc or not parsed.path:
        raise StorageReferenceError("dataset_ref Supabase không hợp lệ.")
    object_path = parsed.path.lstrip("/")
    if not object_path or ".." in Path(object_path).parts:
        raise StorageReferenceError("Đường dẫn object Supabase không hợp lệ.")
    return parsed.netloc, object_path


class SupabaseStorage:
    """Small synchronous wrapper around the Supabase Storage client."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.provider = "supabase"
        self.settings = settings or get_settings()
        if not self.settings.supabase_url or not self.settings.supabase_backend_key:
            raise StorageNotConfiguredError(
                "Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY."
            )
        try:
            # pyrefly: ignore [missing-import]
            from supabase import create_client
            # pyrefly: ignore [missing-import]
            from supabase.lib.client_options import SyncClientOptions
        except ImportError as exc:  # pragma: no cover - depends on deployment extras
            raise StorageNotConfiguredError(
                "Thiếu package supabase. Cài dependency từ requirements.txt."
            ) from exc

        self.client = create_client(
            self.settings.supabase_url,
            self.settings.supabase_backend_key,
            options=SyncClientOptions(
                storage_client_timeout=self.settings.supabase_storage_timeout_seconds,
            ),
        )
        self.bucket = self.settings.supabase_storage_bucket.strip()
        if not self.bucket:
            raise StorageNotConfiguredError("SUPABASE_STORAGE_BUCKET không được để trống.")

    @property
    def resumable_threshold_bytes(self) -> int:
        return self.settings.supabase_storage_resumable_threshold_mb * 1024 * 1024

    @property
    def chunk_bytes(self) -> int:
        return self.settings.supabase_storage_chunk_mb * 1024 * 1024

    def _resumable_url(self) -> str:
        parsed = urlsplit(self.settings.supabase_url)
        host = parsed.hostname or ""
        if host.endswith(".supabase.co") and not host.endswith(".storage.supabase.co"):
            host = f"{host[:-len('.supabase.co')]}.storage.supabase.co"
        if not host:
            raise StorageNotConfiguredError("SUPABASE_URL không hợp lệ.")
        return f"{parsed.scheme or 'https'}://{host}/storage/v1/upload/resumable"

    @staticmethod
    def _http_error(response: httpx.Response) -> StorageUploadError:
        detail = response.text.strip()
        try:
            payload = response.json()
            if isinstance(payload, dict):
                detail = str(payload.get("message") or payload.get("error") or detail)
        except ValueError:
            pass
        detail = detail[:300] or "Supabase Storage trả về lỗi không có nội dung."
        return StorageUploadError(
            f"Supabase Storage từ chối upload ({response.status_code}): {detail}",
            status=response.status_code,
        )

    def _upload_resumable(self, local_path: Path, object_path: str, content_type: str | None) -> None:
        """Upload a large object with Supabase's TUS-compatible endpoint."""
        key = self.settings.supabase_backend_key
        metadata = {
            "bucketName": self.bucket,
            "objectName": object_path,
            "contentType": content_type or mimetypes.guess_type(local_path.name)[0] or "application/octet-stream",
            "cacheControl": "3600",
        }
        encoded_metadata = ",".join(
            f"{name} {base64.b64encode(value.encode('utf-8')).decode('ascii')}"
            for name, value in metadata.items()
        )
        common_headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Tus-Resumable": "1.0.0",
        }
        upload_url: str | None = None
        completed = False
        try:
            with httpx.Client(timeout=self.settings.supabase_storage_timeout_seconds) as client:
                create = client.post(
                    self._resumable_url(),
                    headers={
                        **common_headers,
                        "Upload-Length": str(local_path.stat().st_size),
                        "Upload-Metadata": encoded_metadata,
                        "x-upsert": "false",
                    },
                )
                if create.status_code not in {201, 204}:
                    raise self._http_error(create)
                location = create.headers.get("Location")
                if not location:
                    raise StorageUploadError("Supabase Storage không trả về URL resumable upload.")
                upload_url = urljoin(str(create.url), location)

                offset = 0
                with local_path.open("rb") as handle:
                    while chunk := handle.read(self.chunk_bytes):
                        for attempt in range(3):
                            try:
                                response = client.patch(
                                    upload_url,
                                    headers={
                                        **common_headers,
                                        "Upload-Offset": str(offset),
                                        "Content-Type": "application/offset+octet-stream",
                                    },
                                    content=chunk,
                                )
                                if response.status_code not in {200, 204}:
                                    error = self._http_error(response)
                                    if error.status not in {408, 425, 429} and not (
                                        isinstance(error.status, int) and error.status >= 500
                                    ):
                                        raise error
                                    raise error
                                offset = int(response.headers.get("Upload-Offset", offset + len(chunk)))
                                break
                            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as exc:
                                if attempt == 2:
                                    raise StorageUploadError("Kết nối tới Supabase Storage bị gián đoạn khi upload.") from exc
                                time.sleep(2**attempt)
                            except StorageUploadError as exc:
                                if exc.status not in {408, 425, 429} and not (
                                    isinstance(exc.status, int) and exc.status >= 500
                                ):
                                    raise
                                if attempt == 2:
                                    raise
                                time.sleep(2**attempt)
                completed = True
        except StorageUploadError:
            raise
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as exc:
            raise StorageUploadError("Kết nối tới Supabase Storage bị gián đoạn khi upload.") from exc
        finally:
            if upload_url and not completed:
                try:
                    with httpx.Client(timeout=10) as client:
                        client.delete(upload_url, headers={"Authorization": f"Bearer {key}", "Tus-Resumable": "1.0.0"})
                except Exception:
                    # Completed uploads may reject DELETE; cleanup is best-effort.
                    logger.debug("Không cleanup được resumable upload URL", exc_info=True)

    def upload(
        self,
        local_path: Path,
        object_path: str,
        content_type: str | None = None,
    ) -> None:
        if local_path.stat().st_size > self.resumable_threshold_bytes:
            self._upload_resumable(local_path, object_path, content_type)
            return
        options = {
            "content-type": content_type or mimetypes.guess_type(local_path.name)[0] or "application/octet-stream",
            "upsert": "false",
        }
        # A transient 5xx/429/network failure is common on a long upload. Retry
        # only those failures; configuration/policy errors must surface at once.
        for attempt in range(3):
            try:
                with local_path.open("rb") as handle:
                    self.client.storage.from_(self.bucket).upload(
                        path=object_path,
                        file=handle,
                        file_options=options.copy(),
                    )
                return
            except Exception as exc:
                status_code = getattr(exc, "status_code", None)
                if status_code is None:
                    status_code = getattr(exc, "status", None)
                if status_code is None:
                    response = getattr(exc, "response", None)
                    status_code = getattr(response, "status_code", None)
                retryable = status_code in {408, 425, 429} or (
                    isinstance(status_code, int) and status_code >= 500
                ) or exc.__class__.__name__ in {
                    "ConnectError",
                    "ReadTimeout",
                    "WriteTimeout",
                    "PoolTimeout",
                }
                if not retryable or attempt == 2:
                    raise StorageUploadError(
                        f"Supabase Storage từ chối upload: "
                        f"{getattr(exc, 'message', str(exc))[:300]}",
                        status=status_code,
                    ) from exc
                time.sleep(2**attempt)

    def put(self, local_path: Path, object_path: str, content_type: str | None = None) -> None:
        self.upload(local_path, object_path, content_type)

    def stat(self, object_path: str) -> ObjectStat | None:
        key = self.settings.supabase_backend_key
        try:
            with httpx.Client(timeout=self.settings.supabase_storage_timeout_seconds) as client:
                response = client.head(
                    self._download_url(self.bucket, object_path),
                    headers={"Authorization": f"Bearer {key}", "apikey": key},
                )
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as exc:
            raise StorageDownloadError(
                "Supabase Storage is temporarily unavailable.", retryable=True
            ) from exc
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise StorageDownloadError(
                f"Supabase Storage refused object metadata ({response.status_code}).",
                status=response.status_code,
                retryable=response.status_code in {408, 425, 429}
                or response.status_code >= 500,
            )
        length = response.headers.get("content-length")
        if length is None or not length.isdigit():
            raise StorageDownloadError("Supabase Storage did not return a valid object size.")
        return ObjectStat(
            size_bytes=int(length),
            content_type=response.headers.get("content-type"),
            etag=response.headers.get("etag"),
        )

    def create_signed_upload(self, object_path: str) -> dict[str, str]:
        try:
            result = self.client.storage.from_(self.bucket).create_signed_upload_url(object_path)
        except Exception as exc:
            raise StorageUploadError("Could not create a signed upload authorization.") from exc
        if not isinstance(result, dict):
            raise StorageUploadError("Supabase Storage returned an invalid upload authorization.")
        token = str(result.get("token") or "")
        signed_url = str(result.get("signedURL") or result.get("signed_url") or "")
        if not token and signed_url:
            token = signed_url.rstrip("/").rsplit("/", 1)[-1]
        if not token:
            raise StorageUploadError("Supabase Storage did not return an upload token.")
        return {"token": token, "signed_url": signed_url}

    def download(self, bucket: str, object_path: str) -> bytes:
        return self.client.storage.from_(bucket).download(object_path)

    def _download_url(self, bucket: str, object_path: str) -> str:
        """Return the authenticated Storage object endpoint without SDK buffering."""
        return (
            f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/"
            f"{quote(bucket, safe='')}/{quote(object_path, safe='/')}"
        )

    def download_to_file(
        self,
        bucket: str,
        object_path: str,
        destination: Path,
        *,
        max_bytes: int,
    ) -> int:
        """Stream a Storage object into ``destination`` with a hard byte limit.

        The Supabase Python SDK's ``download`` API returns one large ``bytes``
        object.  Profiling must not use that API: a 500 MB source otherwise
        temporarily exists both as a Python payload and as the local file.
        """
        if max_bytes <= 0:
            raise ValueError("max_bytes phải lớn hơn 0.")

        written = 0
        key = self.settings.supabase_backend_key
        try:
            with httpx.Client(timeout=self.settings.supabase_storage_timeout_seconds) as client:
                with client.stream(
                    "GET",
                    self._download_url(bucket, object_path),
                    headers={"Authorization": f"Bearer {key}", "apikey": key},
                ) as response:
                    if response.status_code >= 400:
                        detail = response.text.strip()[:300]
                        raise StorageDownloadError(
                            "Supabase Storage từ chối tải source"
                            f" ({response.status_code}): {detail or 'không có nội dung.'}",
                            status=response.status_code,
                            retryable=response.status_code in {408, 425, 429}
                            or response.status_code >= 500,
                        )
                    with destination.open("wb") as target:
                        for chunk in response.iter_bytes(chunk_size=self.chunk_bytes):
                            if not chunk:
                                continue
                            next_size = written + len(chunk)
                            if next_size > max_bytes:
                                raise StorageDownloadError(
                                    "Dataset vượt giới hạn dung lượng cho profiling."
                                )
                            target.write(chunk)
                            written = next_size
        except StorageDownloadError:
            destination.unlink(missing_ok=True)
            raise
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as exc:
            destination.unlink(missing_ok=True)
            raise StorageDownloadError(
                "Kết nối tới Supabase Storage bị gián đoạn khi tải source.",
                retryable=True,
            ) from exc
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        return written

    def remove(self, bucket: str, object_path: str) -> None:
        self.client.storage.from_(bucket).remove([object_path])

    def download_to_path(self, object_path: str, destination: Path, *, max_bytes: int) -> int:
        return self.download_to_file(self.bucket, object_path, destination, max_bytes=max_bytes)

    def delete(self, object_path: str) -> None:
        self.remove(self.bucket, object_path)

    def list_objects(self, prefix: str) -> Iterator[str]:
        """Yield object keys below a prefix without loading bucket contents at once."""
        pending = [prefix.strip("/")]
        while pending:
            directory = pending.pop()
            offset = 0
            while True:
                rows = self.client.storage.from_(self.bucket).list(
                    directory,
                    {"limit": 100, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
                )
                if not isinstance(rows, list):
                    raise StorageDownloadError("Supabase Storage returned an invalid object listing.")
                for row in rows:
                    if not isinstance(row, dict) or not row.get("name"):
                        continue
                    child = f"{directory}/{row['name']}" if directory else str(row["name"])
                    if row.get("id") is None and not row.get("metadata"):
                        pending.append(child)
                    else:
                        yield child
                if len(rows) < 100:
                    break
                offset += len(rows)


class LocalObjectStorage:
    """Development-only canonical storage with the same immutable contract."""

    provider = "local"
    bucket = None

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.root = (self.settings.upload_path / "canonical").resolve()

    def _path(self, object_path: str) -> Path:
        candidate = (self.root / object_path).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise StorageReferenceError("Local object path is outside canonical storage.") from exc
        return candidate

    def put(self, local_path: Path, object_path: str, content_type: str | None = None) -> None:
        del content_type
        target = self._path(object_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with target.open("xb") as output, local_path.open("rb") as source:
                shutil.copyfileobj(source, output, length=1024 * 1024)
        except FileExistsError as exc:
            raise StorageUploadError("Canonical object already exists.", status=409) from exc

    def stat(self, object_path: str) -> ObjectStat | None:
        target = self._path(object_path)
        if not target.is_file():
            return None
        return ObjectStat(target.stat().st_size, mimetypes.guess_type(target.name)[0])

    def download_to_path(self, object_path: str, destination: Path, *, max_bytes: int) -> int:
        source = self._path(object_path)
        if not source.is_file():
            raise StorageDownloadError("Canonical object was not found.")
        size = source.stat().st_size
        if size > max_bytes:
            raise StorageDownloadError("Dataset exceeds the profiling byte limit.")
        with source.open("rb") as input_file, destination.open("wb") as output:
            shutil.copyfileobj(input_file, output, length=1024 * 1024)
        return size

    def delete(self, object_path: str) -> None:
        self._path(object_path).unlink(missing_ok=True)

    def list_objects(self, prefix: str) -> Iterator[str]:
        root = self._path(prefix)
        if not root.exists():
            return
        if root.is_file():
            yield root.relative_to(self.root).as_posix()
            return
        for item in root.rglob("*"):
            if item.is_file():
                yield item.relative_to(self.root).as_posix()


def canonical_object_key(workspace_id: str, dataset_id: str, artifact_id: str, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".csv", ".tsv", ".parquet", ".json"}:
        raise StorageReferenceError("Unsupported canonical dataset extension.")
    for value in (workspace_id, dataset_id, artifact_id):
        if not value or not all(char.isalnum() or char in "-_" for char in value):
            raise StorageReferenceError("Invalid canonical object identity.")
    return f"workspaces/{workspace_id}/datasets/{dataset_id}/source/{artifact_id}{suffix}"


def artifact_source_ref(artifact: dict[str, object]) -> str:
    """Build the internal immutable reference for a persisted artifact row."""
    object_key = str(artifact["object_key"])
    if artifact["storage_provider"] == "supabase":
        return f"supabase://{artifact['bucket']}/{object_key}"
    if artifact["storage_provider"] == "local":
        return f"local-object:///{object_key}"
    raise StorageReferenceError("Unsupported canonical artifact provider.")


def get_object_storage(settings: Settings | None = None) -> ObjectStorage:
    current = settings or get_settings()
    provider = current.canonical_storage_provider
    if provider == "supabase":
        return get_storage(current)
    return LocalObjectStorage(current)


_storage: SupabaseStorage | None = None
_storage_lock = threading.Lock()


def get_storage(settings: Settings | None = None) -> SupabaseStorage:
    global _storage
    with _storage_lock:
        if _storage is None:
            _storage = SupabaseStorage(settings)
        return _storage


def reset_storage() -> None:
    global _storage
    with _storage_lock:
        _storage = None


@contextmanager
def materialize_source(
    source_ref: str,
    settings: Settings | None = None,
    *,
    max_bytes: int | None = None,
) -> Iterator[Path]:
    """Yield a readable local path for a local or Supabase source reference."""
    current_settings = settings or get_settings()
    source_limit = max_bytes or (current_settings.security_max_upload_mb * 1024 * 1024)
    if source_limit <= 0:
        raise ValueError("Giới hạn source cho profiling phải lớn hơn 0.")
    if source_ref.lower().startswith("datasource://"):
        from src.services.datasource import DatasourceError, connection_id_from_ref, materialize_connection
        from src.services.repository import get_repository

        connection_id = connection_id_from_ref(source_ref)
        # The dataset was resolved with workspace authorization before compute;
        # the connection id is random and is not exposed to other workspaces.
        connection = get_repository(settings).get_datasource_connection_any(connection_id)
        if connection is None:
            raise DatasourceError("Không tìm thấy datasource connection.")
        with materialize_connection(connection, current_settings) as readable_path:
            yield readable_path
        return
    if source_ref.lower().startswith("gdrive://"):
        from src.services.google_drive import GoogleDriveStorage, parse_google_drive_ref

        workspace_id, file_id, filename = parse_google_drive_ref(source_ref)
        fd, temp_name = tempfile.mkstemp(prefix="p170-gdrive-", suffix=Path(filename).suffix)
        os.close(fd)
        temp_path = Path(temp_name)
        started = time.perf_counter()
        try:
            try:
                GoogleDriveStorage(current_settings).download(
                    workspace_id, file_id, temp_path, max_bytes=source_limit
                )
            except Exception as exc:
                raise OSError(f"Lỗi tải dữ liệu từ Google Drive: {exc}") from exc
            logger.info(
                "source_materialized",
                extra={
                    "source_type": "legacy_google_drive",
                    "storage_download_ms": round((time.perf_counter() - started) * 1000, 2),
                    "size_bytes": temp_path.stat().st_size,
                },
            )
            with utf8_tabular_source(temp_path) as readable_path:
                yield readable_path

        finally:
            temp_path.unlink(missing_ok=True)
        return

    if is_local_object_ref(source_ref):
        object_path = parse_local_object_ref(source_ref)
        suffix = Path(object_path).suffix
        fd, temp_name = tempfile.mkstemp(prefix="p170-source-", suffix=suffix)
        os.close(fd)
        temp_path = Path(temp_name)
        started = time.perf_counter()
        try:
            LocalObjectStorage(current_settings).download_to_path(
                object_path, temp_path, max_bytes=source_limit
            )
            logger.info(
                "source_materialized",
                extra={
                    "source_type": "canonical",
                    "storage_provider": "local",
                    "storage_download_ms": round((time.perf_counter() - started) * 1000, 2),
                    "size_bytes": temp_path.stat().st_size,
                },
            )
            with utf8_tabular_source(temp_path) as readable_path:
                yield readable_path
        finally:
            temp_path.unlink(missing_ok=True)
        return

    if not is_supabase_ref(source_ref):
        path = Path(source_ref)
        if not path.is_file():
            raise FileNotFoundError(f"Không tìm thấy dataset: {source_ref}")
        if path.stat().st_size > source_limit:
            raise StorageDownloadError("Dataset vượt giới hạn dung lượng cho profiling.")
        with utf8_tabular_source(path) as readable_path:
            yield readable_path
        return

    bucket, object_path = parse_supabase_ref(source_ref)
    suffix = Path(object_path).suffix
    fd, temp_name = tempfile.mkstemp(prefix="p170-source-", suffix=suffix)
    os.close(fd)
    temp_path = Path(temp_name)
    started = time.perf_counter()
    try:
        get_storage(current_settings).download_to_file(
            bucket, object_path, temp_path, max_bytes=source_limit
        )
        logger.info(
            "source_materialized",
            extra={
                "source_type": "canonical",
                "storage_provider": "supabase",
                "storage_download_ms": round((time.perf_counter() - started) * 1000, 2),
                "size_bytes": temp_path.stat().st_size,
            },
        )
        with utf8_tabular_source(temp_path) as readable_path:
            yield readable_path
    finally:
        temp_path.unlink(missing_ok=True)


__all__ = [
    "LocalObjectStorage",
    "ObjectStat",
    "ObjectStorage",
    "StorageNotConfiguredError",
    "StorageReferenceError",
    "StorageDownloadError",
    "StorageUploadError",
    "SupabaseStorage",
    "artifact_source_ref",
    "canonical_object_key",
    "get_object_storage",
    "get_storage",
    "is_supabase_ref",
    "is_local_object_ref",
    "materialize_source",
    "parse_supabase_ref",
    "parse_local_object_ref",
    "reset_storage",
]
