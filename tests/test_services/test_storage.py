"""Regression coverage for bounded source materialization."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from src.services import storage


class _StreamResponse:
    status_code = 200

    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.chunk_size: int | None = None

    def __enter__(self) -> _StreamResponse:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def iter_bytes(self, *, chunk_size: int) -> list[bytes]:
        self.chunk_size = chunk_size
        return self.chunks


class _StreamClient:
    response: _StreamResponse
    requested: tuple[str, str, dict[str, str]] | None = None

    def __init__(self, *, timeout: int) -> None:
        self.timeout = timeout

    def __enter__(self) -> _StreamClient:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def stream(self, method: str, url: str, *, headers: dict[str, str]) -> _StreamResponse:
        type(self).requested = (method, url, headers)
        return type(self).response


def _supabase_storage() -> storage.SupabaseStorage:
    instance = object.__new__(storage.SupabaseStorage)
    instance.settings = SimpleNamespace(
        supabase_url="https://project.supabase.co",
        supabase_backend_key="server-key",
        supabase_storage_timeout_seconds=30,
        supabase_storage_chunk_mb=1,
    )
    return instance


class _SignedUploadStorageClient:
    def __init__(self, result: dict[str, str]) -> None:
        self.result = result
        self.storage = self

    def from_(self, _bucket: str) -> _SignedUploadStorageClient:
        return self

    def create_signed_upload_url(self, _object_path: str) -> dict[str, str]:
        return self.result


class _MetadataResponse:
    def __init__(self, status_code: int, payload: object | None = None) -> None:
        self.status_code = status_code
        self.headers: dict[str, str] = {}
        self.payload = payload

    def json(self) -> object:
        if self.payload is None:
            raise ValueError("empty response")
        return self.payload


class _MetadataClient:
    head_response: _MetadataResponse
    get_response: _MetadataResponse | None = None
    get_headers: dict[str, str] | None = None

    def __init__(self, *, timeout: int) -> None:
        self.timeout = timeout

    def __enter__(self) -> _MetadataClient:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def head(self, _url: str, *, headers: dict[str, str]) -> _MetadataResponse:
        return type(self).head_response

    def get(self, _url: str, *, headers: dict[str, str]) -> _MetadataResponse:
        type(self).get_headers = headers
        assert type(self).get_response is not None
        return type(self).get_response


def test_create_signed_upload_extracts_jws_from_signed_url_query() -> None:
    signed_url = (
        "https://project.storage.supabase.co/storage/v1/object/upload/sign/"
        "datasets/workspace/file.csv?token=header.payload.signature"
    )
    instance = _supabase_storage()
    instance.bucket = "datasets"
    instance.client = _SignedUploadStorageClient({"signedURL": signed_url})

    result = instance.create_signed_upload("workspace/file.csv")

    assert result == {"token": "header.payload.signature", "signed_url": signed_url}


def test_create_signed_upload_does_not_use_object_path_as_token() -> None:
    instance = _supabase_storage()
    instance.bucket = "datasets"
    instance.client = _SignedUploadStorageClient(
        {"signedURL": "https://project.storage.supabase.co/object/sign/datasets/file.csv"}
    )

    with pytest.raises(storage.StorageUploadError, match="upload token"):
        instance.create_signed_upload("datasets/file.csv")


def test_stat_treats_proxied_no_such_key_as_missing(monkeypatch) -> None:
    _MetadataClient.head_response = _MetadataResponse(400)
    _MetadataClient.get_response = _MetadataResponse(
        400, {"statusCode": "404", "code": "NoSuchKey", "message": "Object not found"}
    )
    _MetadataClient.get_headers = None
    monkeypatch.setattr(storage.httpx, "Client", _MetadataClient)
    instance = _supabase_storage()
    instance.bucket = "datasets"

    assert instance.stat("workspace/missing.csv") is None
    assert _MetadataClient.get_headers is not None
    assert _MetadataClient.get_headers["Range"] == "bytes=0-0"


def test_stat_does_not_mask_other_storage_400(monkeypatch) -> None:
    _MetadataClient.head_response = _MetadataResponse(400)
    _MetadataClient.get_response = _MetadataResponse(
        400, {"code": "InvalidJWT", "message": "Invalid Compact JWS"}
    )
    monkeypatch.setattr(storage.httpx, "Client", _MetadataClient)
    instance = _supabase_storage()
    instance.bucket = "datasets"

    with pytest.raises(storage.StorageDownloadError, match="metadata"):
        instance.stat("workspace/missing.csv")


def test_download_to_file_streams_chunks_without_sdk_bytes(tmp_path: Path, monkeypatch) -> None:
    response = _StreamResponse([b"abc", b"def", b"ghi"])
    _StreamClient.response = response
    monkeypatch.setattr(storage.httpx, "Client", _StreamClient)
    destination = tmp_path / "source.csv"

    written = _supabase_storage().download_to_file(
        "datasets", "workspace/source.csv", destination, max_bytes=10
    )

    assert written == 9
    assert destination.read_bytes() == b"abcdefghi"
    assert response.chunk_size == 1024 * 1024
    assert _StreamClient.requested == (
        "GET",
        "https://project.supabase.co/storage/v1/object/datasets/workspace/source.csv",
        {"Authorization": "Bearer server-key", "apikey": "server-key"},
    )


def test_download_to_file_enforces_limit_and_cleans_partial_file(tmp_path: Path, monkeypatch) -> None:
    _StreamClient.response = _StreamResponse([b"abc", b"def"])
    monkeypatch.setattr(storage.httpx, "Client", _StreamClient)
    destination = tmp_path / "oversized.csv"

    with pytest.raises(storage.StorageDownloadError, match="giới hạn"):
        _supabase_storage().download_to_file(
            "datasets", "workspace/oversized.csv", destination, max_bytes=5
        )

    assert not destination.exists()


def test_materialize_source_uses_streaming_api_and_cleans_successful_temp_file(
    monkeypatch,
) -> None:
    class _StreamingOnlyStorage:
        def download(self, *_: object) -> bytes:
            raise AssertionError("profiling must not call the full-payload download API")

        def download_to_file(
            self,
            _bucket: str,
            _path: str,
            destination: Path,
            *,
            max_bytes: int,
        ) -> int:
            assert max_bytes > 0
            with destination.open("wb") as handle:
                handle.write(b"id,city\n1,Hanoi\n")
            return destination.stat().st_size

    monkeypatch.setattr(storage, "get_storage", lambda _settings=None: _StreamingOnlyStorage())

    with storage.materialize_source("supabase://datasets/workspace/source.csv") as path:
        assert path.exists()
        temporary_path = path
        assert path.read_bytes() == b"id,city\n1,Hanoi\n"

    assert not temporary_path.exists()


def test_local_object_storage_supports_immutable_lifecycle(tmp_path: Path) -> None:
    settings = SimpleNamespace(upload_path=tmp_path)
    adapter = storage.LocalObjectStorage(settings)
    source = tmp_path / "input.csv"
    source.write_bytes(b"id,name\n1,A\n")
    object_key = storage.canonical_object_key(
        "workspace-a", "dataset-a", "artifact-a", "people.csv"
    )

    adapter.put(source, object_key, "text/csv")
    observed = adapter.stat(object_key)
    destination = tmp_path / "download.csv"

    assert observed is not None
    assert observed.size_bytes == source.stat().st_size
    assert adapter.download_to_path(object_key, destination, max_bytes=1024) == observed.size_bytes
    assert destination.read_bytes() == source.read_bytes()
    with pytest.raises(storage.StorageUploadError) as duplicate:
        adapter.put(source, object_key, "text/csv")
    assert duplicate.value.status == 409

    adapter.delete(object_key)
    assert adapter.stat(object_key) is None


def test_local_object_storage_rejects_paths_outside_canonical_root(tmp_path: Path) -> None:
    adapter = storage.LocalObjectStorage(SimpleNamespace(upload_path=tmp_path))

    with pytest.raises(storage.StorageReferenceError, match="outside"):
        adapter.stat("../../another-workspace/source.csv")


def test_artifact_source_ref_is_provider_neutral() -> None:
    assert storage.artifact_source_ref(
        {
            "storage_provider": "supabase",
            "bucket": "datasets",
            "object_key": "workspaces/w/datasets/d/source/a.csv",
        }
    ) == "supabase://datasets/workspaces/w/datasets/d/source/a.csv"
    assert storage.artifact_source_ref(
        {
            "storage_provider": "local",
            "bucket": None,
            "object_key": "workspaces/w/datasets/d/source/a.csv",
        }
    ) == "local-object:///workspaces/w/datasets/d/source/a.csv"
