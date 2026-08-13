"""Backfill legacy domain data into the deterministic bootstrap workspace."""

from __future__ import annotations

import argparse

from sqlalchemy import text
from src.services.repository import get_repository


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bootstrap-user-id", required=True)
    args = parser.parse_args()
    repo = get_repository()
    workspace_id = repo.ensure_bootstrap_workspace(args.bootstrap_user_id)
    with repo.engine.begin() as conn:
        for table in ("datasets", "profile_runs", "analysis_sessions"):
            conn.execute(text(f"UPDATE {table} SET workspace_id = :workspace_id WHERE workspace_id IS NULL"), {"workspace_id": workspace_id})
        # Older anonymous QA audit rows are global metadata and have no tenant
        # actor to resolve.  Scope only actor-attributed events; assigning
        # anonymous history to an arbitrary bootstrap workspace would be
        # misleading and could leak it through workspace audit views.
        conn.execute(
            text(
                "UPDATE audit_events SET workspace_id = :workspace_id "
                "WHERE workspace_id IS NULL AND actor_user_id IS NOT NULL"
            ),
            {"workspace_id": workspace_id},
        )
        # Only profile reports are tenant data; external knowledge stays global.
        conn.execute(text("UPDATE retrieval_documents SET workspace_id = :workspace_id WHERE workspace_id IS NULL AND document_metadata->>'knowledge_type' = 'profile_report'"), {"workspace_id": workspace_id})
    print(f"Backfilled legacy data into workspace {workspace_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
