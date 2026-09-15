from __future__ import annotations

import json

import pytest

import scripts.retire_database_connectors as rollout
from scripts.retire_database_connectors import run_rollout


class FakeRepository:
    def __init__(self) -> None:
        self.purge_credentials: bool | None = None
        self.rows = [
            {
                "id": "connection-1",
                "workspace_id": "workspace-1",
                "kind": "mongodb",
                "status": "connected",
                "deleted_at": None,
                "dataset_count": 2,
                "credential_present": True,
            }
        ]

    def inventory_database_connectors(self) -> list[dict[str, object]]:
        return [dict(row) for row in self.rows]

    def disable_database_connectors(self, *, purge_credentials: bool = False) -> int:
        self.purge_credentials = purge_credentials
        if (
            self.rows[0]["status"] == "disabled"
            and (not purge_credentials or not self.rows[0]["credential_present"])
        ):
            return 0
        self.rows[0]["status"] = "disabled"
        if purge_credentials:
            self.rows[0]["credential_present"] = False
        return 1


def test_rollout_is_dry_run_by_default_and_never_emits_credentials(capsys) -> None:
    repository = FakeRepository()

    assert run_rollout(repository, execute=False, purge_credentials=False) == 0

    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert repository.purge_credentials is None
    assert events[0] == {
        "event": "database_connector_rollout_started",
        "mode": "dry_run",
        "purge_credentials": False,
        "selected": 1,
    }
    assert events[1]["credential_present"] is True
    assert "config_encrypted" not in events[1]
    assert events[-1]["remaining_credentials"] == 1


def test_rollout_purges_only_after_explicit_execution(capsys) -> None:
    repository = FakeRepository()

    assert run_rollout(repository, execute=True, purge_credentials=True) == 0

    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert repository.purge_credentials is True
    assert events[-1]["changed"] == 1
    assert events[-1]["remaining_credentials"] == 0

    assert run_rollout(repository, execute=True, purge_credentials=True) == 0
    repeated = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert repeated[-1]["changed"] == 0
    assert repeated[-1]["remaining_credentials"] == 0


@pytest.mark.parametrize(
    "argv,message",
    [
        (["--execute", "--dry-run"], "Choose either"),
        (["--purge-credentials"], "requires --execute"),
        (["--yes"], "only valid"),
        (["--execute", "--purge-credentials"], "requires --yes"),
    ],
)
def test_parser_rejects_every_unsafe_rollout_flag_combination(
    argv: list[str], message: str
) -> None:
    with pytest.raises(SystemExit, match=message):
        rollout.parse_args(argv)


def test_rollout_settings_prefers_migration_dsn_without_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = object()
    observed: dict[str, str] = {}

    def settings_factory(*, database_url: str) -> object:
        observed["database_url"] = database_url
        return expected

    monkeypatch.setenv("DATABASE_MIGRATION_URL", "postgresql://migration-only/test")
    monkeypatch.setattr(rollout, "Settings", settings_factory)

    assert rollout.load_rollout_settings() is expected
    assert observed == {"database_url": "postgresql://migration-only/test"}
