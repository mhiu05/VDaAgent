"""Repository-level guardrails for the Supabase Data API boundary."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from src.services.database_access_policy import (
    ALL_CLASSIFIED_TABLES,
    LEGACY_DISCOVERED_BACKEND_ONLY_TABLES,
    MIGRATION_MANAGED_BACKEND_ONLY_TABLES,
    MIGRATION_FRAMEWORK_BACKEND_ONLY_TABLES,
    PUBLIC_READ_ONLY_TABLES,
    RUNTIME_MANAGED_BACKEND_ONLY_TABLES,
    USER_OWNED_DIRECT_ACCESS_TABLES,
)
from src.services.repository import metadata

ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PATH = (
    ROOT
    / "backend"
    / "migrations"
    / "versions"
    / "20260831_0022_data_api_boundary.py"
)


def _load_security_migration():
    spec = importlib.util.spec_from_file_location("p170_data_api_boundary", MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_repository_table_has_an_explicit_access_classification() -> None:
    repository_tables = frozenset(metadata.tables)
    assert repository_tables == MIGRATION_MANAGED_BACKEND_ONLY_TABLES
    assert repository_tables <= ALL_CLASSIFIED_TABLES


def test_direct_browser_access_is_an_explicit_empty_surface() -> None:
    assert not USER_OWNED_DIRECT_ACCESS_TABLES
    assert not PUBLIC_READ_ONLY_TABLES


def test_security_migration_covers_every_classified_backend_table() -> None:
    migration = _load_security_migration()
    assert frozenset(migration.APPLICATION_TABLES) == (
        MIGRATION_MANAGED_BACKEND_ONLY_TABLES
    )
    assert frozenset(migration.RUNTIME_MANAGED_TABLES) == (
        RUNTIME_MANAGED_BACKEND_ONLY_TABLES
    )
    assert frozenset(migration.LEGACY_DISCOVERED_TABLES) == (
        LEGACY_DISCOVERED_BACKEND_ONLY_TABLES
    )
    assert frozenset(migration.MIGRATION_FRAMEWORK_TABLES) == (
        MIGRATION_FRAMEWORK_BACKEND_ONLY_TABLES
    )
    assert tuple(migration.BROWSER_ROLES) == ("anon", "authenticated")
