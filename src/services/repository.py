"""Metadata store — SQLAlchemy Core trên SQLite (dev) / PostgreSQL (prod), ADR-009.

Bảng khớp ER diagram trong `docs/architecture/agent_architecture.md`:
datasets, profile_runs, column_stats, candidate_key_proposals,
semantic_type_proposals, pii_proposals, statistical_test_results, drift_reports.

Dùng SQLAlchemy Core (không ORM) vì truy vấn ở đây đơn giản và QA structured
lookup cần SQL tường minh để trace được số liệu về đúng dòng dữ liệu.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    func,
    select,
)
from sqlalchemy.engine import Engine

from src.config import Settings, get_settings

metadata = MetaData()

ProposalKind = Literal["candidate_key", "semantic_type", "pii"]
ProposalStatus = Literal["pending", "confirmed", "rejected", "auto_confirmed"]


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


datasets = Table(
    "datasets",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("name", String(255), nullable=False),
    Column("source_type", String(32), nullable=False),  # csv | parquet | bigquery
    Column("source_ref", String(1024), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("last_profiled_at", DateTime(timezone=True), nullable=True),
)

profile_runs = Table(
    "profile_runs",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("dataset_id", String(32), ForeignKey("datasets.id"), nullable=False),
    Column("version", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("scan_mode", String(16), nullable=False),
    Column("sampling_strategy", String(32), nullable=True),
    Column("sample_size", Integer, nullable=True),
    Column("random_seed", Integer, nullable=True),  # L5 — reproducibility
    Column("executed_query", String(4096), nullable=True),  # L5
    Column("row_count", Integer, nullable=True),
    Column("status", String(16), nullable=False, default="draft"),
    Column("narrative_report", String, nullable=True),
    Column("risk_warnings", JSON, nullable=True),
    Column("correlation_matrix", JSON, nullable=True),
    Column("quasi_identifiers", JSON, nullable=True),
    Column("is_approximate", Boolean, nullable=False, default=False),
    Column("error", String(1024), nullable=True),
)

column_stats = Table(
    "column_stats",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("column_name", String(255), nullable=False),
    Column("dtype", String(64), nullable=True),
    Column("null_pct", Float, nullable=True),
    Column("null_count", Integer, nullable=True),
    Column("cardinality", Integer, nullable=True),
    Column("uniqueness_ratio", Float, nullable=True),
    Column("min_value", Float, nullable=True),
    Column("max_value", Float, nullable=True),
    Column("mean", Float, nullable=True),
    Column("median", Float, nullable=True),
    Column("std", Float, nullable=True),
    Column("q1", Float, nullable=True),
    Column("q3", Float, nullable=True),
    Column("outlier_count", Integer, nullable=True),
    Column("outlier_method", String(32), nullable=True),
    Column("min_length", Integer, nullable=True),
    Column("max_length", Integer, nullable=True),
    Column("top_k_values", JSON, nullable=True),
    Column("is_approximate", Boolean, nullable=False, default=False),  # ADR-006
    Column("margin_of_error", Float, nullable=True),  # ADR-006
)

# Ba loại proposal cùng một luồng HITL (ADR-003) nên dùng chung shape cột.
def _PROPOSAL_COLUMNS() -> list[Column]:  # noqa: N802 - dùng như hằng số, gọi mỗi Table
    """Cột dùng chung cho ba bảng proposal.

    Phải là hàm chứ không phải list dùng lại: mỗi `Column` chỉ gắn được vào một
    `Table`, nên mỗi bảng cần một bộ object mới.
    """
    return [
        Column("id", String(32), primary_key=True),
        Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False),
        Column("confidence_score", Float, nullable=False),
        Column("evidence", String(2048), nullable=True),
        Column("status", String(16), nullable=False, default="pending"),
        Column("confirmed_by", String(255), nullable=True),
        Column("confirmed_at", DateTime(timezone=True), nullable=True),
        Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    ]

candidate_key_proposals = Table(
    "candidate_key_proposals",
    metadata,
    *_PROPOSAL_COLUMNS(),
    Column("columns", JSON, nullable=False),  # single hoặc composite
)

semantic_type_proposals = Table(
    "semantic_type_proposals",
    metadata,
    *_PROPOSAL_COLUMNS(),
    Column("column_name", String(255), nullable=False),
    Column("proposed_type", String(32), nullable=False),
    Column("final_type", String(32), nullable=True),  # Analyst sửa thì ghi vào đây
)

pii_proposals = Table(
    "pii_proposals",
    metadata,
    *_PROPOSAL_COLUMNS(),
    Column("column_name", String(255), nullable=False),
    Column("pii_type", String(64), nullable=True),
    Column("detection_method", String(32), nullable=False),  # heuristic|regex|NER|LLM|manual
)

statistical_test_results = Table(
    "statistical_test_results",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("test_type", String(64), nullable=False),
    Column("target_columns", JSON, nullable=False),
    Column("test_statistic", Float, nullable=True),
    Column("p_value", Float, nullable=True),
    Column("p_value_adjusted", Float, nullable=True),  # L1
    Column("significant_after_correction", Boolean, nullable=True),  # L1
    Column("conclusion", String(32), nullable=False),
    Column("interpretation", String(2048), nullable=True),
    Column("alpha", Float, nullable=True),
    Column("extra", JSON, nullable=True),
    Column("requested_by", String(255), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

drift_reports = Table(
    "drift_reports",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("profile_run_id_a", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("profile_run_id_b", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("drift_columns", JSON, nullable=False),
    Column("summary", String(2048), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

PROPOSAL_TABLES: dict[str, Table] = {
    "candidate_key": candidate_key_proposals,
    "semantic_type": semantic_type_proposals,
    "pii": pii_proposals,
}


# --------------------------------------------------------------------------- #
class Repository:
    """Truy cập metadata DB. Mọi số trong báo cáo/QA đều đọc từ đây."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        metadata.create_all(engine)

    # --- Dataset -------------------------------------------------------- #
    def upsert_dataset(self, name: str, source_type: str, source_ref: str) -> str:
        """Trả về dataset id; dataset đã tồn tại (theo source_ref) thì tái sử dụng."""
        with self.engine.begin() as conn:
            row = conn.execute(
                select(datasets.c.id).where(datasets.c.source_ref == source_ref)
            ).first()
            if row:
                return row[0]
            dataset_id = _uuid()
            conn.execute(
                datasets.insert().values(
                    id=dataset_id,
                    name=name,
                    source_type=source_type,
                    source_ref=source_ref,
                    created_at=_now(),
                )
            )
            return dataset_id

    def get_dataset(self, dataset_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(select(datasets).where(datasets.c.id == dataset_id)).mappings().first()
            return dict(row) if row else None

    def list_datasets(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(datasets).order_by(datasets.c.created_at.desc())).mappings()
            return [dict(r) for r in rows]

    # --- ProfileRun ----------------------------------------------------- #
    def create_profile_run(
        self,
        dataset_id: str,
        scan_mode: str,
        sampling_strategy: str | None = None,
        sample_size: int | None = None,
        random_seed: int | None = None,
    ) -> str:
        with self.engine.begin() as conn:
            version = (
                conn.execute(
                    select(func.coalesce(func.max(profile_runs.c.version), 0)).where(
                        profile_runs.c.dataset_id == dataset_id
                    )
                ).scalar()
                or 0
            ) + 1
            run_id = _uuid()
            conn.execute(
                profile_runs.insert().values(
                    id=run_id,
                    dataset_id=dataset_id,
                    version=version,
                    created_at=_now(),
                    scan_mode=scan_mode,
                    sampling_strategy=sampling_strategy,
                    sample_size=sample_size,
                    random_seed=random_seed,
                    status="draft",
                    is_approximate=scan_mode == "sample",
                )
            )
            return run_id

    def update_profile_run(self, run_id: str, **fields: Any) -> None:
        if not fields:
            return
        with self.engine.begin() as conn:
            conn.execute(
                profile_runs.update().where(profile_runs.c.id == run_id).values(**fields)
            )

    def get_profile_run(self, run_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = (
                conn.execute(select(profile_runs).where(profile_runs.c.id == run_id))
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def list_profile_runs(self, dataset_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        query = select(profile_runs).order_by(profile_runs.c.created_at.desc()).limit(limit)
        if dataset_id:
            query = query.where(profile_runs.c.dataset_id == dataset_id)
        with self.engine.begin() as conn:
            return [dict(r) for r in conn.execute(query).mappings()]

    def mark_profiled(self, dataset_id: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                datasets.update()
                .where(datasets.c.id == dataset_id)
                .values(last_profiled_at=_now())
            )

    # --- ColumnStat ----------------------------------------------------- #
    def save_column_stats(self, run_id: str, stats: dict[str, dict[str, Any]]) -> None:
        """Ghi thống kê từng cột. Chỉ lấy các khoá có cột tương ứng trong bảng."""
        allowed = set(column_stats.c.keys()) - {"id", "profile_run_id"}
        rows = []
        for column_name, st in stats.items():
            payload = {k: v for k, v in st.items() if k in allowed}
            payload["column_name"] = column_name
            payload.setdefault("is_approximate", False)
            rows.append({"id": _uuid(), "profile_run_id": run_id, **payload})
        if not rows:
            return
        with self.engine.begin() as conn:
            conn.execute(
                column_stats.delete().where(column_stats.c.profile_run_id == run_id)
            )
            conn.execute(column_stats.insert(), rows)

    def column_stats_rows(
        self, run_id: str, column_name: str | None = None
    ) -> list[dict[str, Any]]:
        """Thống kê từng cột dạng list — giữ cả `id` để trace về dòng DB."""
        query = select(column_stats).where(column_stats.c.profile_run_id == run_id)
        if column_name:
            query = query.where(func.lower(column_stats.c.column_name) == column_name.lower())
        with self.engine.begin() as conn:
            return [dict(r) for r in conn.execute(query).mappings()]

    def get_column_stats(
        self, run_id: str, column_name: str | None = None
    ) -> dict[str, dict[str, Any]]:
        """Thống kê từng cột, key theo tên cột — cùng shape với `compute` trả về.

        Đây là dạng mà node và tool dùng, nên tra cột theo tên là O(1).
        """
        return {
            row["column_name"]: row for row in self.column_stats_rows(run_id, column_name)
        }

    # --- Proposals ------------------------------------------------------ #
    def save_proposals(self, run_id: str, kind: ProposalKind, items: list[dict[str, Any]]) -> list[str]:
        """Ghi proposals cho một loại. Ghi đè proposals cũ của cùng run."""
        table = PROPOSAL_TABLES[kind]
        allowed = set(table.c.keys()) - {"id", "profile_run_id", "created_at"}
        rows, ids = [], []
        for item in items:
            payload = {k: v for k, v in item.items() if k in allowed}
            payload.setdefault("status", "pending")
            payload.setdefault("confidence_score", 0.0)
            proposal_id = _uuid()
            ids.append(proposal_id)
            rows.append(
                {"id": proposal_id, "profile_run_id": run_id, "created_at": _now(), **payload}
            )
        with self.engine.begin() as conn:
            conn.execute(table.delete().where(table.c.profile_run_id == run_id))
            if rows:
                conn.execute(table.insert(), rows)
        return ids

    def get_proposals(
        self,
        run_id: str,
        kind: ProposalKind | None = None,
        status: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        kinds = [kind] if kind else list(PROPOSAL_TABLES)
        out: dict[str, list[dict[str, Any]]] = {}
        with self.engine.begin() as conn:
            for k in kinds:
                table = PROPOSAL_TABLES[k]
                query = select(table).where(table.c.profile_run_id == run_id)
                if status:
                    query = query.where(table.c.status == status)
                out[k] = [
                    dict(r)
                    for r in conn.execute(query.order_by(table.c.confidence_score.desc())).mappings()
                ]
        return out

    def update_proposal(
        self,
        kind: ProposalKind,
        proposal_id: str,
        status: ProposalStatus,
        confirmed_by: str | None = None,
        final_type: str | None = None,
    ) -> bool:
        table = PROPOSAL_TABLES[kind]
        values: dict[str, Any] = {
            "status": status,
            "confirmed_by": confirmed_by,
            "confirmed_at": _now(),
        }
        if final_type is not None and "final_type" in table.c:
            values["final_type"] = final_type
        with self.engine.begin() as conn:
            result = conn.execute(
                table.update().where(table.c.id == proposal_id).values(**values)
            )
            return result.rowcount > 0

    def confirmed_pii_columns(self, run_id: str) -> set[str]:
        """Cột PII đã xác nhận — dùng để mask giá trị trong báo cáo & QA."""
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(pii_proposals.c.column_name).where(
                    pii_proposals.c.profile_run_id == run_id,
                    pii_proposals.c.status.in_(["confirmed", "auto_confirmed", "pending"]),
                )
            )
            # `pending` cũng mask: fail-closed khi Analyst chưa kịp review.
            return {r[0] for r in rows}

    def pending_count(self, run_id: str) -> int:
        total = 0
        with self.engine.begin() as conn:
            for table in PROPOSAL_TABLES.values():
                total += (
                    conn.execute(
                        select(func.count()).where(
                            table.c.profile_run_id == run_id, table.c.status == "pending"
                        )
                    ).scalar()
                    or 0
                )
        return total

    # --- Statistical tests ---------------------------------------------- #
    def save_test_results(
        self, run_id: str, results: list[dict[str, Any]], requested_by: str | None = None
    ) -> None:
        allowed = set(statistical_test_results.c.keys()) - {"id", "profile_run_id", "created_at"}
        rows = []
        for r in results:
            payload = {k: v for k, v in r.items() if k in allowed}
            payload["requested_by"] = requested_by
            # `error` không có cột riêng — gộp vào extra để không mất thông tin.
            if r.get("error"):
                extra = dict(payload.get("extra") or {})
                extra["error"] = r["error"]
                payload["extra"] = extra
            rows.append(
                {"id": _uuid(), "profile_run_id": run_id, "created_at": _now(), **payload}
            )
        if not rows:
            return
        with self.engine.begin() as conn:
            conn.execute(statistical_test_results.insert(), rows)

    def get_test_results(self, run_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(statistical_test_results)
                .where(statistical_test_results.c.profile_run_id == run_id)
                .order_by(statistical_test_results.c.created_at.asc())
            ).mappings()
            return [dict(r) for r in rows]

    # --- Drift ---------------------------------------------------------- #
    def save_drift_report(
        self, run_a: str, run_b: str, drift_columns: list[dict[str, Any]], summary: str
    ) -> str:
        report_id = _uuid()
        with self.engine.begin() as conn:
            conn.execute(
                drift_reports.insert().values(
                    id=report_id,
                    profile_run_id_a=run_a,
                    profile_run_id_b=run_b,
                    drift_columns=drift_columns,
                    summary=summary,
                    created_at=_now(),
                )
            )
        return report_id

    def get_drift_reports(self, run_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(drift_reports).where(
                    (drift_reports.c.profile_run_id_a == run_id)
                    | (drift_reports.c.profile_run_id_b == run_id)
                )
            ).mappings()
            return [dict(r) for r in rows]

    # --- Tổng hợp cho báo cáo & QA -------------------------------------- #
    def full_profile(self, run_id: str, mask_pii: bool = True) -> dict[str, Any] | None:
        """Toàn bộ hồ sơ của một run. `mask_pii=True` xoá top_k_values của cột PII."""
        run = self.get_profile_run(run_id)
        if not run:
            return None

        stats = self.column_stats_rows(run_id)
        if mask_pii:
            pii_cols = self.confirmed_pii_columns(run_id)
            for st in stats:
                if st["column_name"] in pii_cols:
                    st["top_k_values"] = None
                    st["pii_masked"] = True

        return {
            "run": run,
            "dataset": self.get_dataset(run["dataset_id"]),
            "column_stats": stats,
            "proposals": self.get_proposals(run_id),
            "test_results": self.get_test_results(run_id),
            "drift_reports": self.get_drift_reports(run_id),
        }

    def profile_summary_text(self, run_id: str) -> str:
        """Dựng văn bản mô tả run — nội dung index cho QA vector search."""
        profile = self.full_profile(run_id)
        if not profile:
            return ""
        run, dataset = profile["run"], profile["dataset"] or {}
        lines = [
            f"Dataset: {dataset.get('name', 'unknown')} ({dataset.get('source_ref', '')})",
            f"Profile run version {run['version']} — {run['created_at']}",
            f"Chế độ quét: {run['scan_mode']}; số dòng: {run.get('row_count')}"
            + (" (số liệu là ước lượng từ sampling)" if run.get("is_approximate") else ""),
        ]
        if run.get("narrative_report"):
            lines.append(run["narrative_report"])
        for warning in run.get("risk_warnings") or []:
            lines.append(f"Cảnh báo: {warning}")
        for st in profile["column_stats"]:
            lines.append(
                f"Cột {st['column_name']} ({st.get('dtype')}): null% = {st.get('null_pct')}, "
                f"cardinality = {st.get('cardinality')}, uniqueness = {st.get('uniqueness_ratio')}"
            )
        for result in profile["test_results"]:
            lines.append(
                f"Kiểm định {result['test_type']} trên {json.dumps(result['target_columns'], ensure_ascii=False)}: "
                f"{result.get('interpretation') or result['conclusion']}"
            )
        return "\n".join(lines)


# --------------------------------------------------------------------------- #
_repo: Repository | None = None


def build_engine(settings: Settings | None = None) -> Engine:
    cfg = settings or get_settings()
    cfg.data_path.mkdir(parents=True, exist_ok=True)
    url = cfg.database_url
    if url.startswith("sqlite"):
        # SQLite + FastAPI async: mỗi request có thể ở thread khác nhau.
        return create_engine(url, future=True, connect_args={"check_same_thread": False})
    return create_engine(url, future=True, pool_pre_ping=True)


def get_repository(settings: Settings | None = None) -> Repository:
    global _repo
    if _repo is None:
        _repo = Repository(build_engine(settings))
    return _repo


def reset_repository() -> None:
    """Dùng trong test để buộc tạo lại engine sau khi đổi DATABASE_URL."""
    global _repo
    _repo = None


__all__ = [
    "PROPOSAL_TABLES",
    "Repository",
    "build_engine",
    "column_stats",
    "get_repository",
    "metadata",
    "reset_repository",
]
