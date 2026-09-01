"""Restore the Chat P2 revision identifier recorded by deployed databases.

The initial Chat P2 rollout created the schema represented by revision
``20260831_0024`` and recorded this follow-up revision in the production
Alembic ledger.  The source file was absent from a later branch sync, causing
Alembic to reject otherwise healthy deployments before application release.

The preceding migration already contains the expand-only table, index, and RLS
changes.  This revision deliberately has no schema operation: it restores the
ledger entry for existing environments and preserves the same history for new
installs.
"""

from __future__ import annotations

revision = "20260901_0025"
down_revision = "20260831_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Record the historical Chat P2 rollout boundary."""


def downgrade() -> None:
    """Keep durable Chat P2 history when rolling back application code."""

