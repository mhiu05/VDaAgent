from __future__ import annotations

import socket
import sys
import types
from unittest.mock import Mock

import duckdb
import pytest
import sqlalchemy

from src.services.datasource import (
    DatabaseConnectorsDisabledError,
    materialize_connection,
    normalize_config,
    probe,
)


@pytest.mark.parametrize("kind,config", [
    ("mysql", {"host": "127.0.0.1", "port": 3306}),
    ("mongodb", {"uri": "mongodb://127.0.0.1/test"}),
    ("duckdb", {"path": "C:/sensitive/warehouse.duckdb"}),
])
def test_database_connector_guard_precedes_all_network_and_filesystem_clients(
    monkeypatch: pytest.MonkeyPatch, kind: str, config: dict[str, object]
) -> None:
    blocked = Mock(side_effect=AssertionError("database client must not be called"))
    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(sqlalchemy, "create_engine", blocked)
    monkeypatch.setattr(duckdb, "connect", blocked)
    monkeypatch.setitem(sys.modules, "pymongo", types.SimpleNamespace(MongoClient=blocked))

    with pytest.raises(DatabaseConnectorsDisabledError) as normalized:
        normalize_config(kind, config)  # type: ignore[arg-type]
    assert normalized.value.code == "database_connectors_disabled"

    with pytest.raises(DatabaseConnectorsDisabledError):
        probe(kind, config)  # type: ignore[arg-type]
    with pytest.raises(DatabaseConnectorsDisabledError):
        with materialize_connection({"kind": kind, "config_encrypted": "not-decrypted"}):
            pass

    blocked.assert_not_called()


def test_unknown_datasource_kind_is_also_rejected() -> None:
    with pytest.raises(Exception, match="not supported"):
        normalize_config("postgres" , {})  # type: ignore[arg-type]
