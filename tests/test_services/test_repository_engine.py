from types import SimpleNamespace

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
