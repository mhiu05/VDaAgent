from __future__ import annotations

import duckdb
import pytest

from src.services.datasource import (
    DatasourceError,
    encrypt_config,
    materialize_connection,
    normalize_config,
    probe,
)


def test_duckdb_datasource_materializes_to_profileable_parquet(tmp_path) -> None:
    source = tmp_path / "warehouse.duckdb"
    connection = duckdb.connect(str(source))
    connection.execute("CREATE TABLE orders AS SELECT 1 AS id, 'paid' AS status")
    connection.close()

    config = normalize_config("duckdb", {"path": str(source), "table": "orders"})
    assert probe("duckdb", config) == ["orders"]
    encrypted = encrypt_config(config)
    with materialize_connection({"kind": "duckdb", "config_encrypted": encrypted}) as materialized:
        assert duckdb.connect().execute(
            "SELECT * FROM read_parquet(?)", [str(materialized)]
        ).fetchall() == [(1, "paid")]


def test_external_query_is_read_only() -> None:
    with pytest.raises(DatasourceError):
        normalize_config("duckdb", {"path": "missing.duckdb", "query": "DROP TABLE orders"})


def test_mongodb_filter_must_be_json_object() -> None:
    with pytest.raises(DatasourceError):
        normalize_config(
            "mongodb",
            {"uri": "mongodb://localhost", "database": "app", "collection": "orders", "filter": "[]"},
        )


def test_mongodb_probe_validation_allows_collection_to_be_deferred() -> None:
    config = normalize_config(
        "mongodb",
        {"uri": "mongodb://localhost", "database": "app", "filter": "{}"},
        require_collection=False,
    )

    assert config == {"uri": "mongodb://localhost", "database": "app", "filter": {}}
    with pytest.raises(DatasourceError, match="collection"):
        normalize_config("mongodb", config)
