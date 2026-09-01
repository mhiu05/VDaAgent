"""Add immutable canonical dataset artifacts and durable ingestion state.

This migration is metadata-only. It deliberately does not download or copy any
legacy Google Drive object while Alembic holds a deployment transaction.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260901_0026"
down_revision = "20260901_0025"
branch_labels = None
depends_on = None

BROWSER_ROLES = ("anon", "authenticated")
BACKEND_ONLY_TABLES = ("dataset_artifacts", "dataset_ingestions")


def _secure_backend_table(table_name: str) -> None:
    op.execute(f'ALTER TABLE public."{table_name}" ENABLE ROW LEVEL SECURITY')
    op.execute(f'REVOKE ALL PRIVILEGES ON TABLE public."{table_name}" FROM PUBLIC')
    op.execute(
        sa.text(
            f"""
            DO $browser_revoke$
            DECLARE browser_role text;
            BEGIN
                FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
                LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
                        EXECUTE format(
                            'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
                            '{table_name}', browser_role
                        );
                    END IF;
                END LOOP;
            END
            $browser_revoke$;
            """
        )
    )


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column(
            "ingestion_status", sa.String(16), nullable=False, server_default="ready"
        ),
    )
    op.create_check_constraint(
        "ck_datasets_ingestion_status",
        "datasets",
        "ingestion_status IN ('uploading', 'importing', 'validating', 'ready', 'failed', 'deleted')",
    )

    op.create_table(
        "dataset_artifacts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "dataset_id",
            sa.String(32),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("storage_provider", sa.String(16), nullable=False),
        sa.Column("bucket", sa.String(255)),
        sa.Column("object_key", sa.String(1024), nullable=False),
        sa.Column("size_bytes", sa.BigInteger()),
        sa.Column("content_type", sa.String(255)),
        sa.Column("content_sha256", sa.String(64)),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("original_filename", sa.String(255)),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("ingestion_key", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True)),
        sa.Column("failed_at", sa.DateTime(timezone=True)),
        sa.Column("failure_code", sa.String(64)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "storage_provider IN ('supabase', 'local')",
            name="ck_dataset_artifacts_provider",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'ready', 'failed', 'deleted')",
            name="ck_dataset_artifacts_status",
        ),
        sa.CheckConstraint(
            "size_bytes IS NULL OR size_bytes >= 0",
            name="ck_dataset_artifacts_size",
        ),
        sa.UniqueConstraint(
            "storage_provider", "bucket", "object_key", name="uq_dataset_artifacts_object"
        ),
        sa.UniqueConstraint(
            "workspace_id", "ingestion_key", name="uq_dataset_artifacts_ingestion_key"
        ),
    )
    op.create_index("ix_dataset_artifacts_dataset_id", "dataset_artifacts", ["dataset_id"])
    op.create_index("ix_dataset_artifacts_workspace_id", "dataset_artifacts", ["workspace_id"])
    op.create_index(
        "ix_dataset_artifacts_workspace_status",
        "dataset_artifacts",
        ["workspace_id", "status", "created_at"],
    )
    op.create_index(
        "uq_dataset_artifacts_current",
        "dataset_artifacts",
        ["dataset_id"],
        unique=True,
        postgresql_where=sa.text("is_current AND status = 'ready'"),
    )

    op.create_table(
        "dataset_ingestions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column(
            "dataset_id",
            sa.String(32),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
        ),
        sa.Column(
            "artifact_id",
            sa.String(32),
            sa.ForeignKey("dataset_artifacts.id", ondelete="CASCADE"),
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="creating"),
        sa.Column("expected_size_bytes", sa.BigInteger()),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finalized_at", sa.DateTime(timezone=True)),
        sa.Column("error_code", sa.String(64)),
        sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.CheckConstraint(
            "status IN ('creating', 'pending', 'importing', 'finalized', 'failed', 'expired')",
            name="ck_dataset_ingestions_status",
        ),
        sa.CheckConstraint(
            "expected_size_bytes IS NULL OR expected_size_bytes >= 0",
            name="ck_dataset_ingestions_size",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "created_by_user_id",
            "idempotency_key",
            name="uq_dataset_ingestions_idempotency",
        ),
    )
    op.create_index("ix_dataset_ingestions_workspace_id", "dataset_ingestions", ["workspace_id"])
    op.create_index("ix_dataset_ingestions_dataset_id", "dataset_ingestions", ["dataset_id"])
    op.create_index("ix_dataset_ingestions_artifact_id", "dataset_ingestions", ["artifact_id"])
    op.create_index(
        "ix_dataset_ingestions_stale",
        "dataset_ingestions",
        ["status", "expires_at", "created_at"],
    )

    op.add_column("profile_runs", sa.Column("artifact_id", sa.String(32)))
    op.create_foreign_key(
        "fk_profile_runs_artifact_id", "profile_runs", "dataset_artifacts", ["artifact_id"], ["id"]
    )
    op.create_index("ix_profile_runs_artifact_id", "profile_runs", ["artifact_id"])

    for table_name in BACKEND_ONLY_TABLES:
        _secure_backend_table(table_name)


def downgrade() -> None:
    # Artifact and provenance rows are intentionally retained. Rolling back the
    # application image is safe because all additions are nullable/additive;
    # destructive schema removal requires a separately reviewed archival plan.
    pass
