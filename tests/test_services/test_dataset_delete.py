"""Regression tests for workspace-scoped dataset deletion."""

from __future__ import annotations

from sqlalchemy import create_engine, event, insert, select

from src.services.repository import Repository, conversations, datasets, profile_runs, workspaces


def test_delete_dataset_detaches_active_conversation_context() -> None:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    repository = Repository(engine=engine)
    workspace_id = "workspace-delete"
    dataset_id = "dataset-delete"
    run_id = "run-delete"
    conversation_id = "conversation-delete"

    with repository.engine.begin() as conn:
        conn.execute(
            insert(workspaces).values(
                id=workspace_id,
                name="Delete test workspace",
                slug="delete-test-workspace",
                created_by_user_id="user-delete",
            )
        )
        conn.execute(
            insert(datasets).values(
                id=dataset_id,
                name="Delete test dataset",
                source_type="csv",
                source_ref="local-object:///delete-test.csv",
                workspace_id=workspace_id,
            )
        )
        conn.execute(
            insert(profile_runs).values(
                id=run_id,
                dataset_id=dataset_id,
                workspace_id=workspace_id,
                version=1,
                scan_mode="full",
                status="completed",
            )
        )
        conn.execute(
            insert(conversations).values(
                id=conversation_id,
                workspace_id=workspace_id,
                created_by_user_id="user-delete",
                title="Dataset context",
                active_dataset_id=dataset_id,
                active_profile_run_id=run_id,
            )
        )

    deleted = repository.delete_dataset(dataset_id, workspace_id=workspace_id)

    assert deleted is not None
    assert deleted["run_ids"] == [run_id]
    with repository.engine.connect() as conn:
        assert conn.execute(select(datasets.c.id).where(datasets.c.id == dataset_id)).first() is None
        assert conn.execute(select(profile_runs.c.id).where(profile_runs.c.id == run_id)).first() is None
        context = conn.execute(
            select(conversations.c.active_dataset_id, conversations.c.active_profile_run_id).where(
                conversations.c.id == conversation_id
            )
        ).one()
    assert context == (None, None)
