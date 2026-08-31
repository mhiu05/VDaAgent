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
