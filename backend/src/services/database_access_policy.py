"""Explicit Data API access classification for application PostgreSQL tables.

The browser uses Supabase for authentication and object storage only. Domain
data is accessed through FastAPI, so every table below is backend-only even
when the data itself is tenant-scoped or user-owned.

Keep this inventory in sync with ``repository.metadata``. CI intentionally
fails when a new application table has no access decision.
"""

from __future__ import annotations

INTERNAL_BACKEND_ONLY_TABLES = frozenset(
    {
        "agent_plans",
        "agent_runs",
        "agent_step_attempts",
        "agent_steps",
        "agent_trace_events",
        "approval_requests",
        "audit_events",
        "connector_idempotency",
        "conversation_feedback",
        "conversation_messages",
        "conversations",
        "evaluation_candidates",
        "datasource_connections",
        "dataset_artifacts",
        "dataset_ingestions",
        "evidence_items",
        "google_drive_connections",
        "google_drive_oauth_states",
        "model_invocations",
        "retrieval_documents",
        "tool_invocations",
        "verification_runs",
        "qa_answer_cache",
    }
)

TENANT_SCOPED_BACKEND_ONLY_TABLES = frozenset(
    {
        "analysis_sessions",
        "analysis_sources",
        "candidate_key_proposals",
        "column_stats",
        "datasets",
        "drift_reports",
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
        "semantic_context_versions",
        "semantic_type_proposals",
        "statistical_test_results",
        "workspace_context_versions",
        "workspace_invitations",
        "workspace_memberships",
        "workspace_theme_versions",
        "workspaces",
    }
)

# Identity is synchronized and authorized by FastAPI against canonical database
# state. It is not a browser-editable Supabase profile table.
AUTH_SYSTEM_BACKEND_ONLY_TABLES = frozenset({"user_profiles"})

# LangGraph owns these table definitions and creates them during checkpointer
# setup rather than through SQLAlchemy metadata. They contain serialized agent
# state and are therefore explicitly classified as sensitive backend-only data.
RUNTIME_MANAGED_BACKEND_ONLY_TABLES = frozenset(
    {
        "checkpoint_blobs",
        "checkpoint_migrations",
        "checkpoint_writes",
        "checkpoints",
    }
)

# These tables were discovered in the live public schema but have no current
# model, migration, or code references. Preserve their data while quarantining
# them from browser roles if an adopted environment still contains them.
LEGACY_DISCOVERED_BACKEND_ONLY_TABLES = frozenset(
    {"published_reports", "user_accounts"}
)

# Alembic's revision table is internal deployment metadata, not a Data API.
MIGRATION_FRAMEWORK_BACKEND_ONLY_TABLES = frozenset({"alembic_version"})

USER_OWNED_DIRECT_ACCESS_TABLES = frozenset()
PUBLIC_READ_ONLY_TABLES = frozenset()

MIGRATION_MANAGED_BACKEND_ONLY_TABLES = frozenset(
    INTERNAL_BACKEND_ONLY_TABLES
    | TENANT_SCOPED_BACKEND_ONLY_TABLES
    | AUTH_SYSTEM_BACKEND_ONLY_TABLES
)
ALL_CLASSIFIED_TABLES = frozenset(
    MIGRATION_MANAGED_BACKEND_ONLY_TABLES
    | RUNTIME_MANAGED_BACKEND_ONLY_TABLES
    | LEGACY_DISCOVERED_BACKEND_ONLY_TABLES
    | MIGRATION_FRAMEWORK_BACKEND_ONLY_TABLES
    | USER_OWNED_DIRECT_ACCESS_TABLES
    | PUBLIC_READ_ONLY_TABLES
)


__all__ = [
    "ALL_CLASSIFIED_TABLES",
    "AUTH_SYSTEM_BACKEND_ONLY_TABLES",
    "INTERNAL_BACKEND_ONLY_TABLES",
    "LEGACY_DISCOVERED_BACKEND_ONLY_TABLES",
    "MIGRATION_MANAGED_BACKEND_ONLY_TABLES",
    "MIGRATION_FRAMEWORK_BACKEND_ONLY_TABLES",
    "PUBLIC_READ_ONLY_TABLES",
    "RUNTIME_MANAGED_BACKEND_ONLY_TABLES",
    "TENANT_SCOPED_BACKEND_ONLY_TABLES",
    "USER_OWNED_DIRECT_ACCESS_TABLES",
]
