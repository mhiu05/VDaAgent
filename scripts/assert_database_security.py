"""Assert the migration-controlled backend-only database boundary."""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.services.database_access_policy import (  # noqa: E402
    LEGACY_DISCOVERED_BACKEND_ONLY_TABLES,
    MIGRATION_MANAGED_BACKEND_ONLY_TABLES,
    MIGRATION_FRAMEWORK_BACKEND_ONLY_TABLES,
    RUNTIME_MANAGED_BACKEND_ONLY_TABLES,
)

BROWSER_ROLES = ("anon", "authenticated")
CRUD_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE")


def _roles(connection: sa.Connection) -> set[str]:
    return set(
        connection.execute(
            text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:roles)"),
            {"roles": list(BROWSER_ROLES)},
        ).scalars()
    )


def _assert_catalog(connection: sa.Connection) -> None:
    existing = set(
        connection.execute(
            text(
                """
                SELECT c.relname
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relkind IN ('r', 'p')
                """
            )
        ).scalars()
    )
    missing = MIGRATION_MANAGED_BACKEND_ONLY_TABLES - existing
    assert not missing, f"Missing application tables: {sorted(missing)}"

    expected = set(MIGRATION_MANAGED_BACKEND_ONLY_TABLES)
    expected.update(RUNTIME_MANAGED_BACKEND_ONLY_TABLES & existing)
    expected.update(LEGACY_DISCOVERED_BACKEND_ONLY_TABLES & existing)
    expected.update(MIGRATION_FRAMEWORK_BACKEND_ONLY_TABLES & existing)
    rls_enabled = set(
        connection.execute(
            text(
                """
                SELECT c.relname
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relrowsecurity
                  AND c.relname = ANY(:tables)
                """
            ),
            {"tables": sorted(expected)},
        ).scalars()
    )
    assert rls_enabled == expected, (
        "Tables without RLS: " + ", ".join(sorted(expected - rls_enabled))
    )

    policy_count = connection.execute(
        text(
            """
            SELECT count(*)
            FROM pg_policies
            WHERE schemaname = 'public' AND tablename = ANY(:tables)
            """
        ),
        {"tables": sorted(expected)},
    ).scalar_one()
    assert policy_count == 0, "Backend-only tables must not gain browser policies"

    for role in sorted(_roles(connection)):
        for table_name in sorted(expected):
            qualified = f"public.{table_name}"
            for privilege in CRUD_PRIVILEGES:
                allowed = connection.execute(
                    text("SELECT has_table_privilege(:role, :table, :privilege)"),
                    {"role": role, "table": qualified, "privilege": privilege},
                ).scalar_one()
                assert not allowed, f"{role} unexpectedly has {privilege} on {qualified}"

    for table_name in sorted(expected):
        qualified = f"public.{table_name}"
        for privilege in CRUD_PRIVILEGES:
            allowed = connection.execute(
                text("SELECT has_table_privilege(current_user, :table, :privilege)"),
                {"table": qualified, "privilege": privilege},
            ).scalar_one()
            assert allowed, f"Backend role lost {privilege} on {qualified}"

    unsafe_defaults = connection.execute(
        text(
            """
            SELECT count(*)
            FROM pg_default_acl d
            JOIN pg_namespace n ON n.oid = d.defaclnamespace
            CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
            LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
            WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
              AND n.nspname = 'public'
              AND d.defaclobjtype IN ('r', 'S')
              AND (acl.grantee = 0 OR grantee.rolname = ANY(:roles))
            """
        ),
        {"roles": list(BROWSER_ROLES)},
    ).scalar_one()
    assert unsafe_defaults == 0, "Future tables/sequences retain browser defaults"


def _assert_role_statement_denied(
    engine: sa.Engine, role: str, statement: str
) -> None:
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text(f'SET LOCAL ROLE "{role}"'))
            try:
                connection.execute(text(statement))
            except DBAPIError:
                return
            raise AssertionError(f"{role} unexpectedly executed: {statement}")
        finally:
            transaction.rollback()


def _assert_actual_role_denials(engine: sa.Engine) -> None:
    with engine.connect() as connection:
        roles = _roles(connection)
    statements = (
        "SELECT * FROM public.datasets LIMIT 0",
        "INSERT INTO public.datasets DEFAULT VALUES",
        "UPDATE public.datasets SET name = name WHERE false",
        "DELETE FROM public.datasets WHERE false",
    )
    for role in BROWSER_ROLES:
        if role not in roles:
            continue
        for statement in statements:
            _assert_role_statement_denied(engine, role, statement)


def _assert_backend_crud(engine: sa.Engine) -> None:
    user_id = str(uuid.uuid4())
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO public.user_profiles
                    (user_id, role, status, created_at, updated_at)
                VALUES (:user_id, 'analyst', 'active', now(), now())
                """
            ),
            {"user_id": user_id},
        )
        assert connection.execute(
            text(
                "SELECT count(*) FROM public.user_profiles "
                "WHERE user_id = :user_id"
            ),
            {"user_id": user_id},
        ).scalar_one() == 1
        connection.execute(
            text(
                "UPDATE public.user_profiles SET display_name = 'security-smoke' "
                "WHERE user_id = :user_id"
            ),
            {"user_id": user_id},
        )
        connection.execute(
            text("DELETE FROM public.user_profiles WHERE user_id = :user_id"),
            {"user_id": user_id},
        )


def assert_database_security(database_url: str) -> None:
    engine = sa.create_engine(database_url, future=True, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            _assert_catalog(connection)
        _assert_actual_role_denials(engine)
        _assert_backend_crud(engine)
    finally:
        engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    args = parser.parse_args()
    if not args.database_url:
        raise RuntimeError("--database-url or DATABASE_URL is required")
    assert_database_security(args.database_url)
    print("Database security assertions PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
