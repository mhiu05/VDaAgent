"""P1-08 integration coverage for the initial profiling graph stages."""

from __future__ import annotations

from types import SimpleNamespace

from src.agents.nodes import profiling_nodes


class _Repo:
    def __init__(self, source_ref: str) -> None:
        self.source_ref = source_ref
        self.saved_stats: dict[str, dict] | None = None
        self.updates: list[dict] = []

    def get_profile_run(self, run_id: str) -> dict:
        assert run_id == "run-p1-08"
        return {"dataset_id": "dataset-p1-08"}

    def get_dataset(self, dataset_id: str) -> dict:
        assert dataset_id == "dataset-p1-08"
        return {"source_ref": self.source_ref}

    def transition_profile_run(self, *_: object) -> None:
        return None

    def update_profile_run(self, _run_id: str, **values: object) -> None:
        self.updates.append(dict(values))

    def save_column_stats(self, _run_id: str, stats: dict[str, dict]) -> None:
        self.saved_stats = stats


def test_initial_nodes_profile_file_backed_source_without_dataframe_cache(
    monkeypatch, tmp_path
) -> None:
    source = tmp_path / "orders.csv"
    source.write_text(
        "order_id,amount,email\n1,10.0,a@example.com\n2,25.0,b@example.com\n",
        encoding="utf-8",
    )
    repo = _Repo(str(source))
    audit = SimpleNamespace(log=lambda *_args, **_kwargs: None)
    monkeypatch.setattr(profiling_nodes, "get_repository", lambda: repo)
    monkeypatch.setattr(profiling_nodes, "get_audit", lambda: audit)
    monkeypatch.setattr(
        profiling_nodes,
        "cache_dataframe",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no initial dataframe cache")),
    )
    state = {
        "dataset_id": "dataset-p1-08",
        "profile_run_id": "run-p1-08",
        "scan_mode": "full",
        "sampling_config": None,
        "workspace_id": "workspace-p1-08",
        "requested_by": "user-p1-08",
        "tool_calls": 0,
    }

    ingested = profiling_nodes.ingest_node(state)
    persisted = profiling_nodes.compute_stats_node({**state, **ingested})

    assert ingested["row_count"] == 2
    assert ingested["stats_json"]["amount"]["mean"] == 17.5
    assert ingested["candidate_keys_raw"][0]["columns"] == ["order_id"]
    assert repo.saved_stats == ingested["stats_json"]
    assert persisted["duplicate_row_count"] == 0
