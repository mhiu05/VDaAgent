"""Fail-closed policy boundary for retired database datasource connectors.

MySQL, MongoDB, and server-path DuckDB connections are intentionally outside
the pilot trust boundary.  Keep the small compatibility surface here so every
HTTP route, job, script, and service has one guard before it can resolve a
host, decrypt a credential, or touch a filesystem path.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Literal, NoReturn

from cryptography.fernet import Fernet, InvalidToken

from src.config import (
    DATABASE_CONNECTOR_KINDS,
    DATABASE_CONNECTORS_DISABLED_CODE,
    Settings,
    get_settings,
)

DatasourceKind = Literal["mysql", "mongodb", "duckdb"]


class DatasourceError(ValueError):
    """A safe, user-facing datasource error."""

    code = "datasource_error"


class DatabaseConnectorsDisabledError(DatasourceError):
    """Raised before any retired database connector side effect."""

    code = DATABASE_CONNECTORS_DISABLED_CODE

    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(
            "Database connectors are disabled for this pilot. Upload a file "
            "or import it from Google Drive instead."
        )


def datasource_error_detail(error: DatasourceError) -> dict[str, str]:
    """Stable API contract without exposing configuration or credentials."""

    return {"code": error.code, "message": str(error)}


def reject_database_connector(kind: str) -> NoReturn:
    """Fail closed for every known database connector.

    Unknown kinds are rejected too.  This makes the helper safe for legacy
    rows and internal callers whose type annotations cannot be trusted.
    """

    normalized = str(kind).strip().lower()
    if normalized in DATABASE_CONNECTOR_KINDS:
        raise DatabaseConnectorsDisabledError(normalized)
    raise DatasourceError("Datasource is not supported.")


def _cipher(settings: Settings) -> Fernet:
    """Retain decrypt-only compatibility for administrative legacy cleanup."""

    key = settings.datasource_encryption_key.strip()
    if not key:
        if settings.app_env == "production":
            raise DatasourceError("Production requires DATASOURCE_ENCRYPTION_KEY.")
        seed = (settings.api_token or settings.database_url or "p170-local-datasource").encode()
        key = base64.urlsafe_b64encode(hashlib.sha256(seed).digest()).decode()
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise DatasourceError("DATASOURCE_ENCRYPTION_KEY is not a valid Fernet key.") from exc


def encrypt_config(config: dict[str, Any], settings: Settings | None = None) -> str:
    """Compatibility helper; no enabled route persists database credentials."""

    return _cipher(settings or get_settings()).encrypt(
        json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode()
    ).decode()


def decrypt_config(value: str, settings: Settings | None = None) -> dict[str, Any]:
    """Compatibility helper for offline credential removal only."""

    try:
        decoded = _cipher(settings or get_settings()).decrypt(value.encode())
        payload = json.loads(decoded)
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise DatasourceError("Could not decrypt datasource configuration.") from exc
    if not isinstance(payload, dict):
        raise DatasourceError("Datasource configuration is invalid.")
    return payload


def source_ref_for_connection(connection_id: str) -> str:
    return f"datasource://{connection_id}"


def connection_id_from_ref(source_ref: str) -> str:
    prefix, separator, connection_id = source_ref.partition("://")
    if prefix != "datasource" or not separator or not re.fullmatch(r"[a-f0-9]{32}", connection_id):
        raise DatasourceError("dataset_ref datasource is invalid.")
    return connection_id


def normalize_config(
    kind: DatasourceKind,
    config: dict[str, Any],
    *,
    require_collection: bool = True,
) -> dict[str, Any]:
    """Reject before validation can resolve a filesystem path or hostname."""

    del config, require_collection
    reject_database_connector(kind)


def connector_fingerprint(kind: DatasourceKind, config: dict[str, Any]) -> str:
    """Reject before a legacy config can be normalized or hashed for reuse."""

    del config
    reject_database_connector(kind)


def probe(kind: DatasourceKind, config: dict[str, Any]) -> list[str]:
    """Reject before any socket, MySQL engine, Mongo client, or DuckDB open."""

    del config
    reject_database_connector(kind)


@contextmanager
def materialize_connection(
    connection: dict[str, Any], settings: Settings | None = None
) -> Iterator[Path]:
    """Reject ``datasource://`` materialization before decrypting a secret."""

    del settings
    reject_database_connector(str(connection.get("kind", "")))
    # Keeps this function a generator for contextmanager's type/runtime
    # contract; ``reject_database_connector`` always raises first.
    yield Path()  # pragma: no cover


__all__ = [
    "DatabaseConnectorsDisabledError",
    "DatasourceError",
    "DatasourceKind",
    "connection_id_from_ref",
    "connector_fingerprint",
    "datasource_error_detail",
    "decrypt_config",
    "encrypt_config",
    "materialize_connection",
    "normalize_config",
    "probe",
    "reject_database_connector",
    "source_ref_for_connection",
]
