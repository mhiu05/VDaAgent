"""Make agent request IDs unique within their tenant and actor scope.

The partial index leaves historical runs without an idempotency key untouched
while making concurrent/retried chat starts resolve to one durable run.
"""

from __future__ import annotations

from alembic import op

revision = "20260831_0023"
down_revision = "20260831_0022"
branch_labels = None
depends_on = None

_INDEX = "uq_agent_runs_workspace_actor_type_idempotency"


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS "
        f"{_INDEX} "
        "ON agent_runs (workspace_id, actor_user_id, run_type, idempotency_key) "
        "WHERE idempotency_key IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {_INDEX}")
