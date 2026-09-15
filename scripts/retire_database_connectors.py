"""Inventory and explicitly retire MySQL, MongoDB, and DuckDB connectors.

The command is read-only by default. It never decrypts or prints connector
configuration. Use ``--execute`` to mark active legacy connectors disabled;
add ``--purge-credentials --yes`` only after the inventory has been reviewed
to irreversibly clear encrypted credentials and fingerprints.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Protocol, Sequence

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "src" / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from src.config import PROJECT_ROOT, Settings, get_settings  # noqa: E402
from src.services.repository import build_connector_rollout_repository  # noqa: E402


class ConnectorRepository(Protocol):
    def inventory_database_connectors(self) -> list[dict[str, Any]]: ...

    def disable_database_connectors(self, *, purge_credentials: bool = False) -> int: ...


def _emit(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, default=str, separators=(",", ":")))


def _inventory_fields(row: dict[str, Any]) -> dict[str, object]:
    """Return the only rollout fields safe to emit to an operator log."""

    return {
        "connection_id": str(row["id"]),
        "workspace_id": str(row["workspace_id"]),
        "kind": str(row["kind"]),
        "status": str(row["status"]),
        "deleted": row["deleted_at"] is not None,
        "dataset_count": int(row["dataset_count"]),
        "credential_present": bool(row["credential_present"]),
    }


def run_rollout(
    repository: ConnectorRepository,
    *,
    execute: bool,
    purge_credentials: bool,
) -> int:
    before = repository.inventory_database_connectors()
    _emit(
        "database_connector_rollout_started",
        mode="execute" if execute else "dry_run",
        purge_credentials=purge_credentials,
        selected=len(before),
    )
    for row in before:
        _emit("database_connector_inventory", phase="before", **_inventory_fields(row))

    if not execute:
        _emit(
            "database_connector_rollout_finished",
            mode="dry_run",
            changed=0,
            remaining_credentials=sum(
                bool(row["credential_present"]) for row in before
            ),
        )
        return 0

    changed = repository.disable_database_connectors(
        purge_credentials=purge_credentials
    )
    after = repository.inventory_database_connectors()
    for row in after:
        _emit("database_connector_inventory", phase="after", **_inventory_fields(row))
    _emit(
        "database_connector_rollout_finished",
        mode="execute",
        changed=changed,
        remaining_credentials=sum(
            bool(row["credential_present"]) for row in after
        ),
    )
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Apply state retirement.")
    parser.add_argument("--dry-run", action="store_true", help="Explicit alias for the safe default.")
    parser.add_argument(
        "--purge-credentials",
        action="store_true",
        help="Permanently clear encrypted credentials and fingerprints.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Acknowledge the irreversible credential purge.",
    )
    return parser


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    args = _parser().parse_args(argv)
    if args.execute and args.dry_run:
        raise SystemExit("Choose either --execute or --dry-run.")
    if args.purge_credentials and not args.execute:
        raise SystemExit("--purge-credentials requires --execute.")
    if args.yes and not args.purge_credentials:
        raise SystemExit("--yes is only valid with --purge-credentials.")
    if args.purge_credentials and not args.yes:
        raise SystemExit("Credential purge requires --yes after reviewing dry-run output.")
    return args


def load_rollout_settings() -> Settings:
    """Prefer the migration DSN without weakening normal app configuration.

    The API/worker still require ``DATABASE_URL``. The standalone rollout can
    use only ``DATABASE_MIGRATION_URL`` because it does not start application
    services and deliberately constructs its own non-bootstrapping repository.
    """

    migration_url = os.getenv("DATABASE_MIGRATION_URL", "").strip()
    if not migration_url:
        migration_url = str(
            dotenv_values(PROJECT_ROOT / ".env").get("DATABASE_MIGRATION_URL", "")
        ).strip()
    if migration_url:
        return Settings(database_url=migration_url)
    return get_settings()


def main() -> int:
    args = parse_args()
    settings = load_rollout_settings()
    return run_rollout(
        build_connector_rollout_repository(settings, execute=args.execute),
        execute=args.execute,
        purge_credentials=args.purge_credentials,
    )


if __name__ == "__main__":
    raise SystemExit(main())
