from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import src.services.repository as repository_module


def test_rollout_repository_never_bootstraps_development_schema(
    monkeypatch,
) -> None:
    create_all = Mock()
    monkeypatch.setattr(repository_module.metadata, "create_all", create_all)

    repository_module.Repository(
        Mock(),
        settings=SimpleNamespace(app_env="development"),
        bootstrap_schema=False,
    )

    create_all.assert_not_called()


def test_rollout_repository_uses_migration_dsn_and_read_only_engine(
    monkeypatch,
) -> None:
    engine = Mock()
    captured: dict[str, object] = {}

    def build_engine(settings, *, database_url=None, read_only=False):
        captured.update(
            settings=settings, database_url=database_url, read_only=read_only
        )
        return engine

    monkeypatch.setattr(repository_module, "build_engine", build_engine)
    settings = SimpleNamespace(
        app_env="development",
        database_url="postgresql://application/test",
        database_migration_url="postgresql://migration/test",
    )

    repository = repository_module.build_connector_rollout_repository(
        settings, execute=False
    )

    assert repository.engine is engine
    assert captured["database_url"] == "postgresql://migration/test"
    assert captured["read_only"] is True


def test_read_only_engine_sets_postgres_transaction_default(monkeypatch) -> None:
    captured: dict[str, object] = {}
    engine = Mock()

    def create_engine(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return engine

    monkeypatch.setattr(repository_module, "create_engine", create_engine)
    settings = SimpleNamespace(
        database_url="postgresql://application/test",
        perf_telemetry_enabled=False,
    )

    assert repository_module.build_engine(settings, read_only=True) is engine
    assert captured["connect_args"] == {
        "options": "-c default_transaction_read_only=on"
    }
