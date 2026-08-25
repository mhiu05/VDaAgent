from types import SimpleNamespace

import pytest
from sqlalchemy.pool import NullPool

from src.services.repository import build_engine


def test_supabase_pooler_metadata_engine_does_not_reserve_idle_sessions() -> None:
    settings = SimpleNamespace(
        database_url=(
            "postgresql+psycopg://user:password@"
            "aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
        )
    )
    engine = build_engine(settings)  # type: ignore[arg-type]
    try:
        assert isinstance(engine.pool, NullPool)
    finally:
        engine.dispose()


def test_local_metadata_engine_remains_small_and_bounded() -> None:
    settings = SimpleNamespace(
        database_url="postgresql+psycopg://user:password@127.0.0.1:5432/p170"
    )
    engine = build_engine(settings)  # type: ignore[arg-type]
    try:
        assert engine.pool.size() == 3
        assert engine.pool._max_overflow == 0
    finally:
        engine.dispose()


def _workspace_of(run_id: str) -> str:
    """Read the owning workspace of a profile run straight from the DB.

    The profile GET response intentionally omits ``workspace_id`` (it is auth
    context, not evidence), so the test resolves it through the repository
    engine the same way the app does internally.
    """
    from sqlalchemy import select

    from src.services.repository import get_repository, profile_runs

    engine = get_repository().engine
    with engine.begin() as conn:
        return conn.execute(
            select(profile_runs.c.workspace_id).where(profile_runs.c.id == run_id)
        ).scalar_one()


@pytest.mark.parametrize(
    ("mode", "decision", "expected_status"),
    [
        ("deep", "passed", "plan_review"),
        ("quick", "passed", "running"),
        ("deep", "blocked", "quality_blocked"),
    ],
)
def test_save_gate_transitions_without_nested_connection(
    reviewed_profile_run, mode, decision, expected_status
) -> None:
    """save_gate must resolve session mode on its own transaction.

    Regression for the nested ``engine.begin()`` inside ``save_gate`` (a pooled
    checkout within an open transaction) that could deadlock the bounded local
    pool and re-read the session with extra queries. Drives all three branches
    of the status decision: deep→plan_review, shallow→running, blocked wins.
    """
    from src.services.analysis_repository import get_analysis_repository

    analyses = get_analysis_repository()
    run_id = reviewed_profile_run["profile_run_id"]
    workspace_id = _workspace_of(run_id)

    session = analyses.create_session(
        {"mode": mode, "goal": f"gate-test-{mode}-{decision}"},
        profile_run_id=run_id,
        creator="qa-test",
        workspace_id=workspace_id,
    )
    session_id = session["id"]
    context = analyses.add_context(session_id, {"summary": "context"})

    gate = analyses.save_gate(
        session_id,
        context["id"],
        decision,
        issues=(
            [{"severity": "info", "message": "noted", "rule": "manual"}]
            if decision == "blocked"
            else []
        ),
    )

    assert gate["session_id"] == session_id
    if decision == "blocked":
        assert gate["issues"][0]["dimension"] == "general"
    refreshed = analyses.get_session(session_id, workspace_id=workspace_id)
    assert refreshed is not None
    assert refreshed["status"] == expected_status
