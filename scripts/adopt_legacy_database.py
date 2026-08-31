"""Verify and optionally adopt a pre-Alembic metadata database.

The command is deliberately opt-in: verification is read-only, while
``--stamp`` is the only mode that mutates ``alembic_version``.  It never calls
``metadata.create_all`` and it refuses partial or incompatible schemas before
writing an Alembic version.

Typical release use:

    python scripts/adopt_legacy_database.py
    python scripts/adopt_legacy_database.py --stamp
    alembic upgrade head
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from dotenv import load_dotenv
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine, make_url

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from src.services.repository import metadata  # noqa: E402


BASELINE_REVISION = "20260812_0000"
LOCK_KEY = "vdagent:legacy-adoption"
LEGACY_NULLABLE_COLUMNS = {("user_profiles", "role"), ("user_profiles", "status")}

# These are the tables and columns present before the first Alembic release.
# Later additive columns are intentionally not required; the revision chain
# owns adding them.  Types/nullability/primary keys are taken from the current
# declarations below, so one contract drives both application and verifier.
BASELINE_COLUMNS: dict[str, tuple[str, ...]] = {
    "datasets": (
        "id",
        "name",
        "source_type",
        "source_ref",
        "created_at",
        "last_profiled_at",
    ),
    "profile_runs": (
        "id",
        "dataset_id",
        "version",
        "created_at",
        "scan_mode",
        "sampling_strategy",
        "sample_size",
        "random_seed",
        "executed_query",
        "row_count",
        "duplicate_row_count",
        "duplicate_row_rate",
        "status",
        "graph_thread_id",
        "initial_question",
        "question_type",
        "answer",
        "answer_sources",
        "terminal_result",
        "last_resume_key",
        "last_resume_action",
        "last_resume_at",
        "resume_count",
        "narrative_report",
        "risk_warnings",
        "correlation_matrix",
        "quasi_identifiers",
        "is_approximate",
        "error",
    ),
    "column_stats": (
        "id",
        "profile_run_id",
        "column_name",
        "dtype",
        "null_pct",
        "null_count",
        "cardinality",
        "uniqueness_ratio",
        "min_value",
        "max_value",
        "mean",
        "median",
        "std",
        "q1",
        "q3",
        "outlier_count",
        "outlier_method",
        "min_length",
        "max_length",
        "top_k_values",
        "is_approximate",
        "margin_of_error",
    ),
    "candidate_key_proposals": (
        "id",
        "profile_run_id",
        "confidence_score",
        "evidence",
        "status",
        "confirmed_by",
        "confirmed_at",
        "created_at",
        "columns",
    ),
    "semantic_type_proposals": (
        "id",
        "profile_run_id",
        "confidence_score",
        "evidence",
        "status",
        "confirmed_by",
        "confirmed_at",
        "created_at",
        "column_name",
        "proposed_type",
        "semantic_description",
        "final_type",
    ),
    "pii_proposals": (
        "id",
        "profile_run_id",
        "confidence_score",
        "evidence",
        "status",
        "confirmed_by",
        "confirmed_at",
        "created_at",
        "column_name",
        "pii_type",
        "detection_method",
    ),
    "statistical_test_results": (
        "id",
        "profile_run_id",
        "test_type",
        "target_columns",
        "test_statistic",
        "p_value",
        "p_value_adjusted",
        "significant_after_correction",
        "conclusion",
        "interpretation",
        "alpha",
        "extra",
        "requested_by",
        "created_at",
    ),
    "drift_reports": (
        "id",
        "profile_run_id_a",
        "profile_run_id_b",
        "drift_columns",
        "summary",
        "created_at",
    ),
    "analysis_sessions": (
        "id",
        "mode",
        "status",
        "goal",
        "decision",
        "audience",
        "output",
        "time_scope",
        "population",
        "baseline",
        "creator",
        "graph_thread_id",
        "version",
        "created_at",
        "updated_at",
    ),
    "analysis_sources": (
        "id",
        "session_id",
        "dataset_id",
        "profile_run_id",
        "alias",
        "role",
    ),
    "semantic_context_versions": (
        "id",
        "session_id",
        "version",
        "context",
        "status",
        "approved_by",
        "approved_at",
        "created_at",
    ),
    "quality_gate_runs": (
        "id",
        "session_id",
        "context_version_id",
        "decision",
        "created_at",
    ),
    "quality_issues": (
        "id",
        "quality_gate_run_id",
        "rule",
        "dimension",
        "severity",
        "message",
        "evidence",
        "status",
        "resolution_note",
    ),
    "query_executions": (
        "id",
        "session_id",
        "context_version_id",
        "query_spec",
        "result",
        "result_hash",
        "is_approximate",
        "limitations",
        "duration_ms",
        "created_at",
    ),
    "retrieval_documents": (
        "doc_id",
        "text",
        "document_metadata",
        "vector",
        "created_at",
        "updated_at",
    ),
    "audit_events": ("id", "ts", "event", "fields"),
}


def _database_url() -> str:
    load_dotenv(ROOT / ".env", override=False)
    value = os.environ.get("DATABASE_MIGRATION_URL") or os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_MIGRATION_URL hoac DATABASE_URL is required")
    return value


def _type_matches(actual: Any, expected: Any) -> bool:
    """Compare portable SQLAlchemy type properties, not dialect class names."""
    if isinstance(expected, sa.String) and not isinstance(expected, sa.Text):
        return isinstance(actual, sa.String) and not isinstance(actual, sa.Text) and (
            expected.length is None or actual.length == expected.length
        )
    if isinstance(expected, sa.Text):
        return isinstance(actual, sa.Text)
    if isinstance(expected, sa.DateTime):
        return isinstance(actual, sa.DateTime) and actual.timezone == expected.timezone
    if isinstance(expected, sa.Integer):
        return isinstance(actual, sa.Integer)
    if isinstance(expected, sa.Float):
        return isinstance(actual, sa.Float)
    if isinstance(expected, sa.Boolean):
        return isinstance(actual, sa.Boolean)
    if isinstance(expected, sa.JSON):
        return isinstance(actual, sa.JSON)
    return type(actual) is type(expected)


def verify_legacy_schema(connection: sa.Connection) -> list[str]:
    """Return incompatibilities; an empty list means it is safe to adopt."""
    inspector = inspect(connection)
    tables = set(inspector.get_table_names(schema="public"))
    errors: list[str] = []

    if "alembic_version" in tables:
        versions = connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
        errors.append(
            "alembic_version already exists (versions: "
            + (", ".join(str(item) for item in versions) or "empty")
            + "); use alembic upgrade instead of legacy adoption"
        )

    # Baseline tables may legitimately be missing only columns that a later
    # revision adds. Any newer application table that already exists, however,
    # must match the complete current model before it can be trusted.
    for table_name, expected_table in metadata.tables.items():
        if table_name not in tables:
            if table_name in BASELINE_COLUMNS:
                errors.append(f"missing required legacy table public.{table_name}")
            continue
        column_names = BASELINE_COLUMNS.get(table_name, tuple(expected_table.columns.keys()))
        actual_columns = {item["name"]: item for item in inspector.get_columns(table_name, schema="public")}
        for column_name in column_names:
            actual = actual_columns.get(column_name)
            expected = expected_table.c[column_name]
            if actual is None:
                errors.append(f"missing required column public.{table_name}.{column_name}")
                continue
            if not _type_matches(actual["type"], expected.type):
                errors.append(
                    f"incompatible type public.{table_name}.{column_name}: "
                    f"found {actual['type']}, expected {expected.type}"
                )
            nullable_mismatch = bool(actual["nullable"]) != bool(expected.nullable)
            nullable_is_reconciled = (
                (table_name, column_name) in LEGACY_NULLABLE_COLUMNS
                and bool(actual["nullable"])
                and not bool(expected.nullable)
            )
            if nullable_mismatch and not nullable_is_reconciled:
                errors.append(
                    f"incompatible nullability public.{table_name}.{column_name}: "
                    f"found nullable={actual['nullable']}, expected nullable={expected.nullable}"
                )
        actual_pk = set(inspector.get_pk_constraint(table_name, schema="public").get("constrained_columns") or ())
        expected_pk = {column.name for column in expected_table.primary_key.columns}
        if actual_pk != expected_pk:
            errors.append(
                f"incompatible primary key public.{table_name}: found {sorted(actual_pk)}, "
                f"expected {sorted(expected_pk)}"
            )
    return errors


def _config(connection: sa.Connection) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.attributes["connection"] = connection
    return config


def adopt(*, stamp: bool) -> None:
    engine: Engine = sa.create_engine(make_url(_database_url()), future=True, pool_pre_ping=True)
    try:
        with engine.begin() as connection:
            # Serialize verification/stamp with release migrations in this DB.
            connection.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": LOCK_KEY})
            errors = verify_legacy_schema(connection)
            if errors:
                raise RuntimeError("Legacy schema verification failed:\n- " + "\n- ".join(errors))
            print("Legacy schema verification: PASS")
            if stamp:
                command.stamp(_config(connection), BASELINE_REVISION)
                print(f"Stamped Alembic at {BASELINE_REVISION}; run `alembic upgrade head` next.")
    finally:
        engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stamp",
        action="store_true",
        help="stamp the verified database at the pre-Alembic baseline",
    )
    args = parser.parse_args()
    try:
        adopt(stamp=args.stamp)
    except Exception as exc:
        print(f"Legacy schema adoption rejected: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
