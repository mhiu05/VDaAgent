"""Canonicalize legacy Google Drive datasets outside Alembic transactions.

The command is read-only by default. Use ``--execute`` after reviewing its
JSON-lines dry-run output. Reservations and object keys are idempotent, so a
stopped batch can resume from the last reported dataset id.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from src.config import get_settings  # noqa: E402
from src.services.ingestion import DatasetIngestionService  # noqa: E402
from src.services.repository import get_repository  # noqa: E402


def _emit(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, default=str, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Copy and finalize selected datasets.")
    parser.add_argument("--dry-run", action="store_true", help="Explicit alias for the safe default.")
    parser.add_argument("--workspace-id")
    parser.add_argument("--dataset-id")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--resume-after", help="Continue with dataset ids lexically after this id.")
    args = parser.parse_args()
    if args.execute and args.dry_run:
        parser.error("Choose either --execute or --dry-run.")
    if not 1 <= args.batch_size <= 1000:
        parser.error("--batch-size must be between 1 and 1000")

    settings = get_settings()
    if args.execute and settings.canonical_storage_provider != "supabase":
        parser.error("--execute requires CANONICAL_STORAGE_PROVIDER=supabase")
    repository = get_repository(settings)
    datasets = repository.list_legacy_drive_datasets(
        workspace_id=args.workspace_id,
        dataset_id=args.dataset_id,
        after_id=args.resume_after,
        limit=args.batch_size,
    )
    _emit("batch_started", mode="execute" if args.execute else "dry_run", selected=len(datasets))
    succeeded = 0
    failed = 0
    service = DatasetIngestionService(repository=repository, settings=settings) if args.execute else None
    for dataset in datasets:
        fields = {"dataset_id": str(dataset["id"]), "workspace_id": str(dataset["workspace_id"])}
        if not service:
            _emit("candidate", **fields)
            continue
        try:
            artifact = service.canonicalize_legacy_drive_dataset(
                dataset, workspace_id=str(dataset["workspace_id"])
            )
            succeeded += 1
            _emit("canonicalized", **fields, artifact_id=str(artifact["id"]))
        except Exception as exc:  # continue the bounded operational batch
            failed += 1
            _emit("failed", **fields, error_type=type(exc).__name__, error=str(exc)[:300])
    _emit(
        "batch_finished",
        selected=len(datasets),
        succeeded=succeeded,
        failed=failed,
        resume_after=str(datasets[-1]["id"]) if datasets else args.resume_after,
    )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
