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
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urljoin, urlsplit

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


def is_supabase_ref(value: str) -> bool:
    return value.lower().startswith("supabase://")


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

    def download(self, bucket: str, object_path: str) -> bytes:
        return self.client.storage.from_(bucket).download(object_path)

    def remove(self, bucket: str, object_path: str) -> None:
        self.client.storage.from_(bucket).remove([object_path])


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
def materialize_source(source_ref: str, settings: Settings | None = None) -> Iterator[Path]:
    """Yield a readable local path for a local or Supabase source reference."""
    if source_ref.lower().startswith("gdrive://"):
        from src.services.google_drive import GoogleDriveStorage, parse_google_drive_ref

        workspace_id, file_id, filename = parse_google_drive_ref(source_ref)
        fd, temp_name = tempfile.mkstemp(prefix="p170-gdrive-", suffix=Path(filename).suffix)
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            try:
                GoogleDriveStorage(settings).download(workspace_id, file_id, temp_path)
            except Exception as exc:
                raise OSError(f"Lỗi tải dữ liệu từ Google Drive: {exc}") from exc
            with utf8_tabular_source(temp_path) as readable_path:
                yield readable_path

        finally:
            temp_path.unlink(missing_ok=True)
        return

    if not is_supabase_ref(source_ref):
        path = Path(source_ref)
        if not path.is_file():
            raise FileNotFoundError(f"Không tìm thấy dataset: {source_ref}")
        with utf8_tabular_source(path) as readable_path:
            yield readable_path
        return

    bucket, object_path = parse_supabase_ref(source_ref)
    suffix = Path(object_path).suffix
    fd, temp_name = tempfile.mkstemp(prefix="p170-source-", suffix=suffix)
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        payload = get_storage(settings).download(bucket, object_path)
        temp_path.write_bytes(payload)
        with utf8_tabular_source(temp_path) as readable_path:
            yield readable_path
    finally:
        temp_path.unlink(missing_ok=True)


__all__ = [
    "StorageNotConfiguredError",
    "StorageReferenceError",
    "StorageUploadError",
    "SupabaseStorage",
    "get_storage",
    "is_supabase_ref",
    "materialize_source",
    "parse_supabase_ref",
    "reset_storage",
]
