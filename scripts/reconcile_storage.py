"""Conservatively compare canonical artifact metadata with object storage.

This command never deletes or rewrites production data. It reports missing
objects, stale ingestion records, and (when requested) unreferenced object
candidates for an operator to investigate.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from src.config import get_settings  # noqa: E402
from src.services.repository import get_repository  # noqa: E402
from src.services.storage import get_object_storage  # noqa: E402


def _emit(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, default=str, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-id")
    parser.add_argument("--dataset-id")
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--stale-hours", type=int, default=3)
    parser.add_argument("--scan-objects", action="store_true", help="Also list unreferenced object candidates.")
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 1000:
        parser.error("--batch-size must be between 1 and 1000")
    if args.stale_hours < 1:
        parser.error("--stale-hours must be positive")
    if args.scan_objects and args.dataset_id and not args.workspace_id:
        parser.error("--scan-objects with --dataset-id also requires --workspace-id")

    settings = get_settings()
    repository = get_repository(settings)
    adapter = get_object_storage(settings)
    artifacts = repository.list_dataset_artifacts(
        workspace_id=args.workspace_id,
        dataset_id=args.dataset_id,
        statuses={"pending", "ready"},
        limit=args.batch_size,
    )
    findings = 0
    for artifact in artifacts:
        observed = adapter.stat(str(artifact["object_key"]))
        if observed is None:
            findings += 1
            _emit(
                "db_record_object_missing",
                artifact_id=str(artifact["id"]),
                dataset_id=str(artifact["dataset_id"]),
                workspace_id=str(artifact["workspace_id"]),
                artifact_status=str(artifact["status"]),
            )
        elif artifact["status"] != "ready":
            findings += 1
            _emit(
                "object_present_not_finalized",
                artifact_id=str(artifact["id"]),
                dataset_id=str(artifact["dataset_id"]),
                workspace_id=str(artifact["workspace_id"]),
                artifact_status=str(artifact["status"]),
                size_bytes=observed.size_bytes,
            )
    stale = repository.list_stale_dataset_ingestions(
        stale_before=datetime.now(UTC) - timedelta(hours=args.stale_hours),
        workspace_id=args.workspace_id,
        limit=args.batch_size,
    )
    for ingestion in stale:
        findings += 1
        _emit(
            "stale_ingestion",
            ingestion_id=str(ingestion["id"]),
            dataset_id=str(ingestion.get("dataset_id") or ""),
            workspace_id=str(ingestion["workspace_id"]),
            status=str(ingestion["status"]),
            updated_at=ingestion["updated_at"],
        )
    if args.scan_objects:
        known_keys: set[str] = set()
        cursor: str | None = None
        while True:
            page = repository.list_dataset_artifacts(
                workspace_id=args.workspace_id,
                dataset_id=args.dataset_id,
                after_id=cursor,
                limit=1000,
            )
            if not page:
                break
            known_keys.update(str(row["object_key"]) for row in page)
            cursor = str(page[-1]["id"])
        prefix = "workspaces"
        if args.workspace_id:
            prefix += f"/{args.workspace_id}/datasets"
        if args.dataset_id:
            prefix += f"/{args.dataset_id}"
        for object_key in adapter.list_objects(prefix):
            if object_key not in known_keys:
                findings += 1
                _emit("unreferenced_object_candidate", object_key=object_key)
    _emit(
        "reconciliation_finished",
        artifacts_checked=len(artifacts),
        stale_ingestions=len(stale),
        findings=findings,
        destructive_actions=0,
    )


if __name__ == "__main__":
    main()
