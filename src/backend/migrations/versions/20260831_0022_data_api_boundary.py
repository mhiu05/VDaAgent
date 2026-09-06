"""Enforce the backend-only Supabase Data API boundary.

All application tables are accessed through FastAPI. Browser-facing Supabase
roles therefore receive no direct table privileges and no RLS policies. RLS is
still enabled as defense in depth for every migration-managed table.

Revision ID: 20260831_0022
Revises: 20260831_0021
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260831_0022"
down_revision = "20260831_0021"
branch_labels = None
depends_on = None


# Keep revisions self-contained and immutable. A CI assertion compares this
# inventory with the current application access-classification module.
APPLICATION_TABLES = (
    "agent_plans",
    "agent_runs",
    "agent_step_attempts",
    "agent_steps",
    "agent_trace_events",
    "analysis_sessions",
    "analysis_sources",
    "approval_requests",
    "audit_events",
    "candidate_key_proposals",
    "column_stats",
    "connector_idempotency",
    "datasets",
    "datasource_connections",
    "drift_reports",
    "evidence_items",
    "google_drive_connections",
    "google_drive_oauth_states",
    "model_invocations",
    "pii_proposals",
    "profile_runs",
    "quality_gate_runs",
    "quality_issues",
    "query_executions",
    "report_items",
    "report_reviews",
    "report_sections",
    "report_versions",
    "report_visualizations",
    "reports",
    "retrieval_documents",
    "semantic_context_versions",
    "semantic_type_proposals",
    "statistical_test_results",
    "tool_invocations",
    "user_profiles",
    "verification_runs",
    "workspace_context_versions",
    "workspace_invitations",
    "workspace_memberships",
    "workspace_theme_versions",
    "workspaces",
)

RUNTIME_MANAGED_TABLES = (
    "checkpoint_blobs",
    "checkpoint_migrations",
    "checkpoint_writes",
    "checkpoints",
)

LEGACY_DISCOVERED_TABLES = ("published_reports", "user_accounts")

MIGRATION_FRAMEWORK_TABLES = ("alembic_version",)

BROWSER_ROLES = ("anon", "authenticated")


def _validate_identifiers() -> None:
    identifiers = (
        APPLICATION_TABLES
        + RUNTIME_MANAGED_TABLES
        + LEGACY_DISCOVERED_TABLES
        + MIGRATION_FRAMEWORK_TABLES
        + BROWSER_ROLES
    )
    if any(not value.replace("_", "").isalnum() for value in identifiers):
        raise RuntimeError("Unsafe identifier in database access inventory")


def _revoke_browser_roles(table_names: tuple[str, ...], *, optional: bool) -> None:
    table_array = ", ".join(f"'{name}'" for name in table_names)
    existence_guard = (
        "IF to_regclass(format('public.%I', table_name)) IS NULL THEN "
        "CONTINUE; END IF;"
        if optional
        else ""
    )
    op.execute(
        sa.text(
            f"""
            DO $data_api_boundary$
            DECLARE
                table_name text;
                browser_role text;
            BEGIN
                FOREACH table_name IN ARRAY ARRAY[{table_array}]
                LOOP
                    {existence_guard}
                    EXECUTE format(
                        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC',
                        table_name
                    );
                    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
                    LOOP
                        IF EXISTS (
                            SELECT 1 FROM pg_roles WHERE rolname = browser_role
                        ) THEN
                            EXECUTE format(
                                'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
                                table_name,
                                browser_role
                            );
                        END IF;
                    END LOOP;
                END LOOP;
            END
            $data_api_boundary$;
            """
        )
    )


def _revoke_browser_default_privileges() -> None:
    # Alembic and the LangGraph checkpointer connect as the configured backend
    # database owner. Removing that owner's defaults prevents later tables from
    # silently inheriting Supabase's legacy browser-role CRUD grants.
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC"
    )
    op.execute(
        sa.text(
            """
            DO $data_api_defaults$
            DECLARE
                browser_role text;
            BEGIN
                FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
                LOOP
                    IF EXISTS (
                        SELECT 1 FROM pg_roles WHERE rolname = browser_role
                    ) THEN
                        EXECUTE format(
                            'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                            'REVOKE ALL PRIVILEGES ON TABLES FROM %I',
                            browser_role
                        );
                        EXECUTE format(
                            'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                            'REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
                            browser_role
                        );
                    END IF;
                END LOOP;
            END
            $data_api_defaults$;
            """
        )
    )


def upgrade() -> None:
    _validate_identifiers()

    for table_name in APPLICATION_TABLES:
        op.execute(f'ALTER TABLE public."{table_name}" ENABLE ROW LEVEL SECURITY')

    for table_name in MIGRATION_FRAMEWORK_TABLES:
        op.execute(f'ALTER TABLE public."{table_name}" ENABLE ROW LEVEL SECURITY')

    # LangGraph creates these tables at runtime. Secure existing installations;
    # revoked owner defaults ensure a later setup cannot grant browser access.
    for table_name in RUNTIME_MANAGED_TABLES + LEGACY_DISCOVERED_TABLES:
        op.execute(
            sa.text(
                f"""
                DO $runtime_table$
                BEGIN
                    IF to_regclass('public.{table_name}') IS NOT NULL THEN
                        ALTER TABLE public."{table_name}" ENABLE ROW LEVEL SECURITY;
                    END IF;
                END
                $runtime_table$;
                """
            )
        )

    _revoke_browser_roles(APPLICATION_TABLES, optional=False)
    _revoke_browser_roles(RUNTIME_MANAGED_TABLES, optional=True)
    _revoke_browser_roles(LEGACY_DISCOVERED_TABLES, optional=True)
    _revoke_browser_roles(MIGRATION_FRAMEWORK_TABLES, optional=False)
    _revoke_browser_default_privileges()

    # audit_events is the only application table with an owned sequence today.
    # Keep this conditional for adopted databases with a non-serial legacy key.
    op.execute(
        sa.text(
            """
            DO $audit_sequence$
            DECLARE
                sequence_name text := pg_get_serial_sequence(
                    'public.audit_events', 'id'
                );
                browser_role text;
            BEGIN
                IF sequence_name IS NOT NULL THEN
                    EXECUTE format(
                        'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC',
                        sequence_name
                    );
                    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
                    LOOP
                        IF EXISTS (
                            SELECT 1 FROM pg_roles WHERE rolname = browser_role
                        ) THEN
                            EXECUTE format(
                                'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM %I',
                                sequence_name,
                                browser_role
                            );
                        END IF;
                    END LOOP;
                END IF;
            END
            $audit_sequence$;
            """
        )
    )


def downgrade() -> None:
    # A rollback must never recreate browser access that the product does not
    # use. RLS flags and revoked privileges are intentionally retained.
    pass
