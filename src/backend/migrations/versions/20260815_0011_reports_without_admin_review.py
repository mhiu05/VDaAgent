"""Publish existing report snapshots without an Admin approval step."""

from __future__ import annotations

from alembic import op

revision = "20260815_0011"
down_revision = "20260815_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Reports created by the old Analyst/Admin workflow were left in
    # `in_review`. They are already complete snapshots, so make them directly
    # available in the workspace report library.
    op.execute(
        """
        UPDATE report_versions
        SET status = 'published',
            published_by_user_id = COALESCE(
                published_by_user_id,
                reviewed_by_user_id,
                submitted_by_user_id,
                created_by_user_id
            ),
            published_at = COALESCE(
                published_at,
                reviewed_at,
                submitted_at,
                created_at
            )
        WHERE status IN ('in_review', 'approved')
        """
    )
    op.execute(
        """
        UPDATE reports AS report
        SET status = 'published',
            current_published_version_id = (
                SELECT version.id
                FROM report_versions AS version
                WHERE version.report_id = report.id
                  AND version.status = 'published'
                ORDER BY version.version DESC
                LIMIT 1
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE report.status = 'in_review'
        """
    )


def downgrade() -> None:
    # The previous approval state cannot be reconstructed reliably after the
    # report has been made available, so leave published reports unchanged.
    pass
