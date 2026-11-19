"""jobs.kind: add `user_provision`, the provisioning job of doc 12 (S2).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-17 18:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = (
    "agent_create",
    "agent_reset",
    "skill_install",
    "skill_remove",
    "package_add",
    "package_remove",
    "preset_apply",
)
NEW = (*OLD, "user_provision")


def _check(kinds: tuple[str, ...]) -> str:
    return "kind IN (" + ", ".join(f"'{k}'" for k in kinds) + ")"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_jobs_kind"), "jobs", type_="check")
    op.create_check_constraint(op.f("ck_jobs_kind"), "jobs", _check(NEW))


def downgrade() -> None:
    op.execute("DELETE FROM jobs WHERE kind = 'user_provision'")
    op.drop_constraint(op.f("ck_jobs_kind"), "jobs", type_="check")
    op.create_check_constraint(op.f("ck_jobs_kind"), "jobs", _check(OLD))
