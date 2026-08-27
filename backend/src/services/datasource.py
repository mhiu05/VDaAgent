"""External tabular datasource connectors.

Connections are intentionally materialized to an ephemeral CSV/JSONL/Parquet
file before entering the existing DuckDB profiling boundary.  Credentials are
encrypted at rest and never returned by the API.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import json
import os
import re
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Literal

import duckdb
from cryptography.fernet import Fernet, InvalidToken
from src.config import Settings, get_settings

DatasourceKind = Literal["mysql", "mongodb", "duckdb"]
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
_MAX_ROWS = 1_000_000


class DatasourceError(ValueError):
    """A safe, user-facing datasource error."""


def _cipher(settings: Settings) -> Fernet:
    key = settings.datasource_encryption_key.strip()
    if not key:
        if settings.app_env == "production":
            raise DatasourceError("Production cần cấu hình DATASOURCE_ENCRYPTION_KEY.")
        # Local development still gets encryption, without forcing a secret into
        # source control. Production must always provide a dedicated key.
        seed = (settings.api_token or settings.database_url or "p170-local-datasource").encode()
        key = base64.urlsafe_b64encode(hashlib.sha256(seed).digest()).decode()
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise DatasourceError("DATASOURCE_ENCRYPTION_KEY không phải Fernet key hợp lệ.") from exc


def encrypt_config(config: dict[str, Any], settings: Settings | None = None) -> str:
    return _cipher(settings or get_settings()).encrypt(
        json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode()
    ).decode()


def decrypt_config(value: str, settings: Settings | None = None) -> dict[str, Any]:
    try:
        decoded = _cipher(settings or get_settings()).decrypt(value.encode())
        payload = json.loads(decoded)
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise DatasourceError("Không thể giải mã cấu hình datasource.") from exc
    if not isinstance(payload, dict):
        raise DatasourceError("Cấu hình datasource không hợp lệ.")
    return payload


def source_ref_for_connection(connection_id: str) -> str:
    return f"datasource://{connection_id}"


def connection_id_from_ref(source_ref: str) -> str:
    prefix, separator, connection_id = source_ref.partition("://")
    if prefix != "datasource" or not separator or not re.fullmatch(r"[a-f0-9]{32}", connection_id):
        raise DatasourceError("dataset_ref datasource không hợp lệ.")
    return connection_id


def _identifier(value: str, *, label: str = "identifier") -> str:
    value = value.strip()
    if not _IDENTIFIER.fullmatch(value):
        raise DatasourceError(f"{label} chỉ được chứa chữ, số, _ và $.")
    return value


def _read_only_query(value: str, *, label: str = "query") -> str:
    query = value.strip().rstrip(";").strip()
    if not query or not re.match(r"^(select|with)\b", query, re.IGNORECASE):
        raise DatasourceError(f"{label} chỉ được là câu lệnh SELECT hoặc WITH.")
    if ";" in query or re.search(r"\b(insert|update|delete|drop|alter|create|copy|attach|install|pragma)\b", query, re.IGNORECASE):
        raise DatasourceError(f"{label} chứa thao tác không được phép.")
    return query


def _mysql_config(config: dict[str, Any]) -> dict[str, Any]:
    required = ("host", "port", "user", "password", "database")
    if any(not str(config.get(key, "")).strip() for key in required):
        raise DatasourceError("MySQL cần host, port, user, password và database.")
    result = {key: config[key] for key in required}
    result["port"] = int(result["port"])
    if not 1 <= result["port"] <= 65535:
        raise DatasourceError("Port MySQL không hợp lệ.")
    if config.get("query"):
        result["query"] = _read_only_query(str(config["query"]), label="MySQL query")
    else:
        result["table"] = _identifier(str(config.get("table", "")), label="Tên bảng MySQL")
    return result


def _mongo_config(config: dict[str, Any]) -> dict[str, Any]:
    uri = str(config.get("uri", "")).strip()
    database = str(config.get("database", "")).strip()
    collection = str(config.get("collection", "")).strip()
    if not uri or not database or not collection:
        raise DatasourceError("MongoDB cần URI, database và collection.")
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        raise DatasourceError("MongoDB URI không hợp lệ.")
    try:
        query_filter = config.get("filter") or {}
        if isinstance(query_filter, str):
            query_filter = json.loads(query_filter)
        if not isinstance(query_filter, dict):
            raise ValueError
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise DatasourceError("MongoDB filter phải là JSON object.") from exc
    return {"uri": uri, "database": database, "collection": collection, "filter": query_filter}


def _duckdb_config(config: dict[str, Any]) -> dict[str, Any]:
    path = str(config.get("path", "")).strip()
    if not path:
        raise DatasourceError("DuckDB cần đường dẫn file .duckdb/.db.")
    path_obj = Path(path)
    if not path_obj.is_file():
        raise DatasourceError("Không tìm thấy file DuckDB trên máy chủ.")
    result = {"path": str(path_obj)}
    if config.get("query"):
        result["query"] = _read_only_query(str(config["query"]), label="DuckDB query")
    else:
        result["table"] = _identifier(str(config.get("table", "")), label="Tên bảng DuckDB")
    return result


def normalize_config(kind: DatasourceKind, config: dict[str, Any]) -> dict[str, Any]:
    if kind == "mysql":
        return _mysql_config(config)
    if kind == "mongodb":
        return _mongo_config(config)
    if kind == "duckdb":
        return _duckdb_config(config)
    raise DatasourceError("Datasource chưa được hỗ trợ.")


def connector_fingerprint(kind: DatasourceKind, config: dict[str, Any]) -> str:
    """Stable, non-reversible identity for a normalized connector config."""
    normalized = normalize_config(kind, config)
    payload = json.dumps(
        {"kind": kind, "config": normalized},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _mysql_engine(config: dict[str, Any]):
    try:
        from sqlalchemy import URL, create_engine
    except ImportError as exc:  # pragma: no cover
        raise DatasourceError("Thiếu SQLAlchemy để kết nối MySQL.") from exc
    try:
        import pymysql  # noqa: F401
    except ImportError as exc:
        raise DatasourceError("Thiếu pymysql. Cài thêm dependency datasource_mysql.") from exc
    url = URL.create(
        "mysql+pymysql",
        username=config["user"],
        password=config["password"],
        host=config["host"],
        port=config["port"],
        database=config["database"],
    )
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 10})


def _mysql_sql(config: dict[str, Any]) -> str:
    if config.get("query"):
        return str(config["query"])
    return f"SELECT * FROM `{config['table']}`"


def _materialize_mysql(config: dict[str, Any], target: Path) -> None:
    import pandas as pd

    engine = _mysql_engine(config)
    try:
        with engine.connect() as connection, target.open("w", newline="", encoding="utf-8") as handle:
            writer = None
            rows = 0
            for frame in pd.read_sql_query(_mysql_sql(config), connection, chunksize=50_000):
                rows += len(frame)
                if rows > _MAX_ROWS:
                    raise DatasourceError(f"Nguồn vượt giới hạn {_MAX_ROWS:,} dòng.")
                writer = writer or csv.writer(handle)
                if handle.tell() == 0:
                    writer.writerow(list(frame.columns))
                writer.writerows(frame.where(frame.notna(), None).itertuples(index=False, name=None))
    finally:
        engine.dispose()


def _materialize_mongodb(config: dict[str, Any], target: Path) -> None:
    try:
        from pymongo import MongoClient
    except ImportError as exc:
        raise DatasourceError("Thiếu pymongo. Cài thêm dependency datasource_mongodb.") from exc
    client = MongoClient(config["uri"], serverSelectionTimeoutMS=10_000, connectTimeoutMS=10_000)
    try:
        cursor = client[config["database"]][config["collection"]].find(config["filter"]).limit(_MAX_ROWS + 1)
        with target.open("w", encoding="utf-8") as handle:
            for index, document in enumerate(cursor, start=1):
                if index > _MAX_ROWS:
                    raise DatasourceError(f"Nguồn vượt giới hạn {_MAX_ROWS:,} dòng.")
                handle.write(json.dumps(document, ensure_ascii=False, default=str) + "\n")
    finally:
        client.close()


def _duckdb_sql(config: dict[str, Any]) -> str:
    if config.get("query"):
        return str(config["query"])
    return f'SELECT * FROM "{config["table"]}"'


def _materialize_duckdb(config: dict[str, Any], target: Path) -> None:
    connection = duckdb.connect(config["path"], read_only=True)
    try:
        connection.execute(
            f"COPY ({_duckdb_sql(config)}) TO ? (FORMAT PARQUET, COMPRESSION ZSTD)",
            [str(target)],
        )
    except duckdb.Error as exc:
        raise DatasourceError("Không thể đọc bảng/query DuckDB.") from exc
    finally:
        connection.close()


def probe(kind: DatasourceKind, config: dict[str, Any]) -> list[str]:
    normalized = normalize_config(kind, config)
    if kind == "mysql":
        engine = _mysql_engine(normalized)
        try:
            with engine.connect() as connection:
                rows = connection.exec_driver_sql(
                    "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"
                ).fetchall()
                connection.exec_driver_sql(_mysql_sql(normalized).replace("SELECT *", "SELECT 1", 1) + " LIMIT 1")
            return [str(row[0]) for row in rows]
        finally:
            engine.dispose()
    if kind == "mongodb":
        try:
            from pymongo import MongoClient
        except ImportError as exc:
            raise DatasourceError("Thiếu pymongo. Cài thêm dependency datasource_mongodb.") from exc
        client = MongoClient(normalized["uri"], serverSelectionTimeoutMS=10_000)
        try:
            client.admin.command("ping")
            return list(client[normalized["database"]].list_collection_names())
        finally:
            client.close()
    connection = duckdb.connect(normalized["path"], read_only=True)
    try:
        connection.execute("SELECT 1").fetchone()
        rows = connection.execute("SHOW TABLES").fetchall()
        if normalized.get("table"):
            connection.execute(f'SELECT 1 FROM "{normalized["table"]}" LIMIT 1').fetchone()
        return [str(row[0]) for row in rows]
    finally:
        connection.close()


@contextmanager
def materialize_connection(connection: dict[str, Any], settings: Settings | None = None) -> Iterator[Path]:
    kind = str(connection["kind"])
    config = decrypt_config(str(connection["config_encrypted"]), settings)
    suffix = ".parquet" if kind == "duckdb" else ".json" if kind == "mongodb" else ".csv"
    fd, name = tempfile.mkstemp(prefix="p170-datasource-", suffix=suffix)
    os.close(fd)
    Path(name).unlink(missing_ok=True)
    target = Path(name)
    try:
        if kind == "mysql":
            _materialize_mysql(config, target)
        elif kind == "mongodb":
            _materialize_mongodb(config, target)
        elif kind == "duckdb":
            _materialize_duckdb(config, target)
        else:
            raise DatasourceError("Datasource chưa được hỗ trợ.")
        yield target
    finally:
        target.unlink(missing_ok=True)


__all__ = [
    "DatasourceError", "DatasourceKind", "connection_id_from_ref", "connector_fingerprint", "decrypt_config",
    "encrypt_config", "materialize_connection", "normalize_config", "probe",
    "source_ref_for_connection",
]
