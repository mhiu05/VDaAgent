"""PostgreSQL checks for the Owner/Analyst migration backfill contract."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text

from src.config import get_settings


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PATH = (
    ROOT
    / "src"
    / "backend"
    / "migrations"
    / "versions"
    / "20260915_0027_workspace_owner_roles.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("p170_workspace_owner_roles", MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _schema_name() -> str:
    return f"workspace_role_test_{uuid4().hex}"


def _set_search_path(connection, schema: str) -> None:
    # ``schema`` is generated from a UUID, never user input.
    connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')


def _create_legacy_schema(connection, schema: str) -> None:
    connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    _set_search_path(connection, schema)
    connection.execute(
        text(
            """
            CREATE TABLE workspaces (
                id varchar(36) PRIMARY KEY,
                created_by_user_id varchar(36) NOT NULL,
                status varchar(16) NOT NULL,
                settings jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE user_profiles (
                user_id varchar(36) PRIMARY KEY,
                role varchar(16) NOT NULL,
                status varchar(16) NOT NULL
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE workspace_memberships (
                workspace_id varchar(36) NOT NULL,
                user_id varchar(36) NOT NULL,
                role varchar(16) NOT NULL,
                status varchar(16) NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ck_membership_role
                    CHECK (role IN ('owner', 'admin', 'analyst', 'viewer'))
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE workspace_invitations (
                id varchar(36) PRIMARY KEY,
                role varchar(16) NOT NULL
            )
            """
        )
    )


def _run_upgrade(connection, migration, schema: str) -> None:
    _set_search_path(connection, schema)
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        migration.upgrade()


def _role(connection, schema: str, workspace_id: str, user_id: str) -> str:
    _set_search_path(connection, schema)
    return str(
        connection.execute(
            text(
                """
                SELECT role FROM workspace_memberships
                WHERE workspace_id = :workspace_id AND user_id = :user_id
                """
            ),
            {"workspace_id": workspace_id, "user_id": user_id},
        ).scalar_one()
    )


def _drop_schema(engine, schema: str) -> None:
    with engine.begin() as connection:
        connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


def test_workspace_role_migration_promotes_effective_creator_and_fallbacks() -> None:
    migration = _load_migration()
    engine = create_engine(get_settings().database_url)
    schema = _schema_name()
    try:
        with engine.begin() as connection:
            _create_legacy_schema(connection, schema)
            _set_search_path(connection, schema)
            connection.execute(
                text(
                    """
                    INSERT INTO workspaces (id, created_by_user_id, status, settings)
                    VALUES
                        ('creator-workspace', 'creator', 'active', '{}'::jsonb),
                        ('fallback-workspace', 'removed-creator', 'active', '{}'::jsonb),
                        ('archived-workspace', 'archived-creator', 'archived', '{}'::jsonb),
                        ('guest-workspace', 'guest-user', 'active', '{"guest": true}'::jsonb)
                    """
                )
            )
            connection.execute(
                text(
                    """
                    INSERT INTO user_profiles (user_id, role, status)
                    VALUES
                        ('creator', 'analyst', 'active'),
                        ('collaborator', 'analyst', 'active'),
                        ('oldest-member', 'analyst', 'active'),
                        ('later-member', 'analyst', 'active'),
                        ('archived-creator', 'analyst', 'active'),
                        ('guest-user', 'analyst', 'active')
                    """
                )
            )
            connection.execute(
                text(
                    """
                    INSERT INTO workspace_memberships
                        (workspace_id, user_id, role, status, created_at)
                    VALUES
                        ('creator-workspace', 'creator', 'analyst', 'active', '2026-01-03T00:00:00Z'),
                        ('creator-workspace', 'collaborator', 'viewer', 'active', '2026-01-01T00:00:00Z'),
                        ('fallback-workspace', 'oldest-member', 'viewer', 'active', '2026-01-01T00:00:00Z'),
                        ('fallback-workspace', 'later-member', 'analyst', 'active', '2026-01-02T00:00:00Z'),
                        ('archived-workspace', 'archived-creator', 'analyst', 'active', '2026-01-01T00:00:00Z'),
                        ('guest-workspace', 'guest-user', 'owner', 'active', '2026-01-01T00:00:00Z')
                    """
                )
            )
            connection.execute(
                text("INSERT INTO workspace_invitations (id, role) VALUES ('invite-1', 'owner')")
            )

        with engine.begin() as connection:
            _run_upgrade(connection, migration, schema)

        with engine.begin() as connection:
            assert _role(connection, schema, "creator-workspace", "creator") == "owner"
            assert _role(connection, schema, "creator-workspace", "collaborator") == "analyst"
            assert _role(connection, schema, "fallback-workspace", "oldest-member") == "owner"
            assert _role(connection, schema, "fallback-workspace", "later-member") == "analyst"
            assert _role(connection, schema, "archived-workspace", "archived-creator") == "owner"
            assert _role(connection, schema, "guest-workspace", "guest-user") == "analyst"
            _set_search_path(connection, schema)
            assert connection.execute(
                text("SELECT role FROM workspace_invitations WHERE id = 'invite-1'")
            ).scalar_one() == "analyst"
            membership_constraint = connection.execute(
                text(
                    """
                    SELECT pg_get_constraintdef(oid)
                    FROM pg_constraint
                    WHERE conname = 'ck_membership_role'
                      AND conrelid = 'workspace_memberships'::regclass
                    """
                )
            ).scalar_one()
            assert "owner" in membership_constraint and "analyst" in membership_constraint
            assert "viewer" not in membership_constraint
    finally:
        _drop_schema(engine, schema)
        engine.dispose()


def test_workspace_role_migration_stops_for_an_active_orphan_workspace() -> None:
    migration = _load_migration()
    engine = create_engine(get_settings().database_url)
    schema = _schema_name()
    try:
        with engine.begin() as connection:
            _create_legacy_schema(connection, schema)
            _set_search_path(connection, schema)
            connection.execute(
                text(
                    """
                    INSERT INTO workspaces (id, created_by_user_id, status)
                    VALUES ('orphan-workspace', 'missing-user', 'active')
                    """
                )
            )

        with pytest.raises(RuntimeError, match="without an active membership"):
            with engine.begin() as connection:
                _run_upgrade(connection, migration, schema)
    finally:
        _drop_schema(engine, schema)
        engine.dispose()
