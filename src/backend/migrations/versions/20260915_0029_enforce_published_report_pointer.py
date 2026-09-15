"""Preflight legacy published reports for an immutable version pointer.

Publication reads require both ``reports.status = 'published'`` and a pointer
to a version of that same report in ``published`` state. The revision repairs
only deterministic missing/stale pointers and aborts on every other invalid
row, so operators must decide recovery from a reviewed backup.
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect, text


revision = "20260915_0029"
down_revision = "20260915_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    required = {"reports", "report_versions"}
    missing = sorted(table for table in required if not inspector.has_table(table))
    if missing:
        raise RuntimeError(f"Required report lifecycle tables are missing: {', '.join(missing)}")

    # A legacy published report with an actual published version can be safely
    # repaired. Selecting its greatest version is deterministic and never
    # promotes draft, in_review, or approved content.
    op.execute(
        """
        WITH latest_published AS (
            SELECT DISTINCT ON (report_id) id, report_id
            FROM report_versions
            WHERE status = 'published'
            ORDER BY report_id, version DESC
        )
        UPDATE reports AS report
        SET current_published_version_id = version.id,
            updated_at = CURRENT_TIMESTAMP
        FROM latest_published AS version
        WHERE report.status = 'published'
          AND report.id = version.report_id
          AND NOT EXISTS (
              SELECT 1
              FROM report_versions AS pointed
              WHERE pointed.id = report.current_published_version_id
                AND pointed.report_id = report.id
                AND pointed.status = 'published'
          )
        """
    )

    invalid_count = bind.execute(
        text(
            """
            SELECT count(*)
            FROM reports AS report
            WHERE report.status = 'published'
              AND NOT EXISTS (
                  SELECT 1
                  FROM report_versions AS pointed
                  WHERE pointed.id = report.current_published_version_id
                    AND pointed.report_id = report.id
                    AND pointed.status = 'published'
              )

            """
        )
    ).scalar_one()
    if invalid_count:
        raise RuntimeError(
            "Cannot enforce the published report pointer invariant: "
            f"{invalid_count} published report(s) have no valid published version pointer. "
            "Restore or repair those rows from a reviewed backup, then rerun the migration."
        )


def downgrade() -> None:
    # The pointer column predates this revision. Do not reverse the deterministic
    # repair or fabricate an invalid pointer during a schema-only downgrade.
    pass