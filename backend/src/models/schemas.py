"""Pydantic schema cho API.

Quy ước:
- Request có validate chặt (độ dài, enum, khoảng giá trị) để chặn input xấu
  ngay ở biên, trước khi vào graph.
- Response luôn mang cờ `is_approximate` khi số liệu đến từ mẫu (ADR-006) để
  client không hiển thị số ước lượng như số chính xác.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ScanMode = Literal["full", "sample"]
ProposalKind = Literal["candidate_key", "semantic_type", "pii"]
ProposalStatus = Literal["pending", "confirmed", "rejected", "edited", "auto_confirmed"]


# --------------------------------------------------------------------------- #
# Profiling
# --------------------------------------------------------------------------- #
class SamplingConfig(BaseModel):
    """Cấu hình lấy mẫu. Ghi lại seed để tái lập được kết quả (L5)."""

    # reservoir: phân phối đều hơn. tablesample: nhanh hơn trên bảng lớn.
    strategy: Literal["reservoir", "tablesample"] = "reservoir"
    sample_size: int = Field(default=10_000, ge=100, le=10_000_000)
    random_seed: int | None = Field(default=42, ge=0)


class ProfileRequest(BaseModel):
    # dataset_id is the normal contract after an authenticated upload.  The
    # legacy ref remains temporarily available only to development/dual mode.
    dataset_id: str | None = Field(default=None, min_length=1, max_length=64)
    dataset_ref: str | None = Field(
        default=None,
        min_length=1,
        max_length=1000,
        description="Đường dẫn file CSV/Parquet, hoặc tên bảng BigQuery.",
    )
    dataset_name: str | None = Field(default=None, max_length=255)
    run_name: str | None = Field(default=None, max_length=255)
    scan_mode: ScanMode | None = Field(
        default=None, description="Bỏ trống để dùng mặc định trong config.yaml."
    )
    sampling: SamplingConfig | None = None
    question: str | None = Field(
        default=None,
        max_length=2000,
        description="Câu hỏi kèm theo; có thì chạy luôn nhánh Q&A sau khi profiling.",
    )

    @field_validator("dataset_ref")
    @classmethod
    def _no_control_chars(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if any(ord(c) < 32 for c in v):
            raise ValueError("dataset_ref chứa ký tự điều khiển không hợp lệ.")
        return v.strip()

    @field_validator("run_name")
    @classmethod
    def _normalize_run_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        normalized = v.strip()
        if not normalized:
            raise ValueError("Tên phiên profiling không được để trống.")
        if any(ord(c) < 32 for c in normalized):
            raise ValueError("Tên phiên profiling chứa ký tự điều khiển không hợp lệ.")
        return normalized


class ColumnStatOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    column_name: str
    dtype: str | None = None
    row_count: int | None = None
    null_count: int | None = None
    null_pct: float | None = None
    cardinality: int | None = None
    uniqueness_ratio: float | None = None
    # Chỉ có giá trị với cột số; cột chuỗi dùng min_length/max_length.
    min_value: float | None = None
    max_value: float | None = None
    mean: float | None = None
    median: float | None = None
    std: float | None = None
    q1: float | None = None
    q3: float | None = None
    outlier_count: int | None = None
    outlier_method: str | None = None
    min_length: int | None = None
    max_length: int | None = None
    top_k_values: Any = None
    is_approximate: bool = False
    margin_of_error: float | None = None
    pii_masked: bool = False


class ProposalOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    kind: ProposalKind | None = None
    column_name: str | None = None
    columns: list[str] | None = None
    proposed_type: str | None = None
    final_type: str | None = None
    pii_type: str | None = None
    detection_method: str | None = None
    confidence_score: float
    evidence: str
    status: ProposalStatus
    confirmed_by: str | None = None
    confirmed_at: datetime | None = None
    review_note: str | None = None


class ProfileResponse(BaseModel):
    profile_run_id: str
    dataset_id: str
    dataset_name: str | None = None
    run_name: str | None = None
    status: str
    graph_thread_id: str | None = None
    initial_question: str | None = None
    version: int | None = None
    row_count: int | None = None
    column_count: int = 0
    scan_mode: str | None = None
    random_seed: int | None = None
    executed_query: str | None = None
    is_approximate: bool = False
    narrative_report: str | None = None
    risk_warnings: list[str] = Field(default_factory=list)
    quasi_identifiers: list[str] = Field(default_factory=list)
    pending_proposals: int = 0
    auto_confirmed: list[dict[str, Any]] = Field(default_factory=list)
    column_stats: dict[str, ColumnStatOut] = Field(default_factory=dict)
    correlation_matrix: dict[str, dict[str, float]] = Field(default_factory=dict)
    proposals: dict[str, list[ProposalOut]] = Field(default_factory=dict)
    test_results: list[dict[str, Any]] = Field(default_factory=list)
    question_type: str | None = None
    answer: str | None = None
    answer_sources: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None
    # Additive runtime v2 provenance. Older clients can ignore these fields.
    agent_run_id: str | None = None
    trace_summary: dict[str, Any] | None = None


class ProfileJobError(BaseModel):
    code: str
    message: str


class ProfileJobResponse(BaseModel):
    job_id: str
    profiling_run_id: str
    dataset_id: str
    status: Literal["queued", "running", "succeeded", "failed"]
    stage: str | None = None
    attempt_count: int = 0
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    result_id: str | None = None
    error: ProfileJobError | None = None
    duplicate: bool = False


# --------------------------------------------------------------------------- #
# HITL
# --------------------------------------------------------------------------- #
class ProposalDecision(BaseModel):
    kind: ProposalKind
    proposal_id: str = Field(..., min_length=1)
    decision: Literal["confirm", "reject", "edit"]
    final_type: str | None = Field(
        default=None,
        max_length=100,
        description="Giá trị phân loại chính thức khi chỉnh semantic type hoặc PII.",
    )
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("final_type", "note", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if not isinstance(value, str):
            return value
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def validate_edit_decision(self) -> "ProposalDecision":
        if self.decision != "edit":
            return self
        if self.kind == "candidate_key":
            raise ValueError(
                "Candidate key chỉ hỗ trợ xác nhận hoặc từ chối, không có giá trị để chỉnh sửa."
            )
        if not self.final_type:
            raise ValueError("Quyết định chỉnh sửa cần giá trị phân loại chính thức.")
        if not self.note or len(self.note) < 3:
            raise ValueError("Quyết định chỉnh sửa cần lý do gồm ít nhất 3 ký tự.")
        return self


class ConfirmRequest(BaseModel):
    """Actor attribution is taken from the verified JWT, never client input."""

    action: Literal["confirm", "edit", "reject", "request_test"] | None = None
    decisions: list[ProposalDecision] = Field(default_factory=list, max_length=500)
    test_requests: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    resume: bool = Field(
        default=True, description="Chạy tiếp pipeline (summarize) sau khi xác nhận."
    )


class ConfirmResponse(BaseModel):
    profile_run_id: str
    applied: int
    pending_proposals: int
    status: str
    narrative_report: str | None = None
    risk_warnings: list[str] = Field(default_factory=list)
    graph_thread_id: str | None = None
    initial_question: str | None = None
    question_type: str | None = None
    answer: str | None = None
    answer_sources: list[dict[str, Any]] = Field(default_factory=list)
    test_results: list[dict[str, Any]] = Field(default_factory=list)
    # Snapshot after the atomic review transaction.  The client can update its
    # profile cache without racing a stale GET while the resume job is queued.
    proposals: dict[str, list[ProposalOut]] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Kiểm định thống kê
# --------------------------------------------------------------------------- #
class TestSpec(BaseModel):
    test_type: str = Field(..., min_length=1, max_length=64)
    columns: list[str] = Field(..., min_length=1, max_length=10)
    params: dict[str, Any] = Field(default_factory=dict)


class TestRequest(BaseModel):
    tests: list[TestSpec] = Field(..., min_length=1, max_length=20)
    alpha: float | None = Field(default=None, gt=0.0, lt=1.0)
    fdr_method: Literal["benjamini_hochberg", "bonferroni", "none"] | None = None


class TestResultOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    test_type: str
    target_columns: list[str]
    test_statistic: float | None = None
    p_value: float | None = None
    p_value_adjusted: float | None = None
    significant_after_correction: bool | None = None
    conclusion: str
    interpretation: str
    alpha: float | None = None
    error: str | None = None


class TestResponse(BaseModel):
    profile_run_id: str
    results: list[TestResultOut] = Field(default_factory=list)
    correction_note: str | None = None


# --------------------------------------------------------------------------- #
# Q&A
# --------------------------------------------------------------------------- #
class QAHistoryMessage(BaseModel):
    role: Literal["user", "agent"]
    text: str = Field(..., min_length=1, max_length=2000)


class QARequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    profile_run_id: str | None = Field(
        default=None, description="Bỏ trống để tìm trên toàn bộ index."
    )
    history: list[QAHistoryMessage] = Field(
        default_factory=list,
        max_length=20,
        description="Một số lượt chat gần nhất để duy trì short-term memory.",
    )
    analysis_execution_id: str | None = Field(default=None, max_length=64)
    workspace_context_version_id: str | None = Field(default=None, max_length=64)
    stream: bool = True

    @field_validator("question")
    @classmethod
    def question_must_contain_visible_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Câu hỏi không được chỉ chứa khoảng trắng.")
        return value


class ProfileReportSource(BaseModel):
    type: Literal["profile_report"]
    citation_id: str
    doc_id: str
    profile_run_id: str | None = None
    dataset_name: str | None = None
    retrieval_channel: str
    score: float


class ExternalKnowledgeSource(BaseModel):
    type: Literal["external_knowledge"]
    citation_id: str
    doc_id: str
    source_id: str
    title: str | None = None
    canonical_url: str
    retrieved_at: str | None = None
    category: str | None = None
    retrieval_channel: str
    score: float

    @field_validator("canonical_url")
    @classmethod
    def http_url_only(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("canonical_url must use HTTP(S)")
        return value


class ToolSource(BaseModel):
    type: Literal["tool"]
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    status: str
    profile_run_id: str | None = None


AnswerSource = Annotated[
    ProfileReportSource | ExternalKnowledgeSource | ToolSource,
    Field(discriminator="type"),
]


class QAResponse(BaseModel):
    question: str
    question_type: str | None = None
    answer: str
    sources: list[AnswerSource] = Field(default_factory=list)
    is_approximate: bool = False
    agent_run_id: str | None = None
    evidence_status: Literal['verified', 'profile_only', 'no_evidence'] = 'no_evidence'
    profile_run_id: str | None = None
    context_version_id: str | None = None
    analysis_execution_id: str | None = None
    verification: dict[str, Any] | None = None
    trace_summary: dict[str, Any] | None = None


# --------------------------------------------------------------------------- #
# Drift
# --------------------------------------------------------------------------- #
class DriftRequest(BaseModel):
    baseline_run_id: str = Field(..., min_length=1)
    current_run_id: str | None = Field(
        default=None, description="Bỏ trống để so với run trong URL."
    )


class DriftFinding(BaseModel):
    model_config = ConfigDict(extra="allow")

    column_name: str | None = None
    drift_type: str
    severity: Literal["major", "minor"]
    metric: str | None = None
    baseline_value: Any = None
    current_value: Any = None
    psi: float | None = None
    detail: str


class DriftResponse(BaseModel):
    baseline_run_id: str
    current_run_id: str
    summary: str
    findings: list[DriftFinding] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Dataset / hệ thống
# --------------------------------------------------------------------------- #
class DatasetOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    source_type: str | None = None
    source_ref: str | None = None
    collection_name: str | None = None
    last_profiled_at: datetime | None = None
    latest_run_id: str | None = None
    latest_run_status: str | None = None
    latest_run_stage: str | None = None
    latest_run_created_at: datetime | None = None
    latest_run_error: str | None = None


class DatasetCollectionUpdate(BaseModel):
    """Logical group label shared by a batch of uploaded datasets."""

    dataset_ids: list[str] = Field(min_length=1, max_length=100)
    collection_name: str = Field(min_length=1, max_length=255)

    @field_validator("dataset_ids")
    @classmethod
    def _unique_dataset_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values if value.strip()]
        if len(normalized) != len(values) or len(set(normalized)) != len(normalized):
            raise ValueError("Danh sách dataset không hợp lệ.")
        return normalized

    @field_validator("collection_name")
    @classmethod
    def _normalize_collection_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Tên bộ dữ liệu không được để trống.")
        if any(ord(char) < 32 for char in normalized):
            raise ValueError("Tên bộ dữ liệu chứa ký tự điều khiển không hợp lệ.")
        return normalized


class UploadResponse(BaseModel):
    """Kết quả upload file — `dataset_ref` truyền thẳng vào `POST /profile`."""

    dataset_ref: str
    dataset_id: str | None = None
    filename: str
    size_bytes: int
    suggested_name: str | None = None


DatasourceKind = Literal["mysql", "mongodb", "duckdb"]


class DatasourceRequest(BaseModel):
    kind: DatasourceKind
    config: dict[str, Any] = Field(default_factory=dict)
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(ord(char) < 32 for char in normalized):
            raise ValueError("Tên datasource không hợp lệ.")
        return normalized


class DatasourceTestResponse(BaseModel):
    ok: bool = True
    kind: DatasourceKind
    objects: list[str] = Field(default_factory=list)
    detail: str


class DatasourceConnectResponse(BaseModel):
    dataset_id: str
    name: str
    source_type: DatasourceKind
    object_name: str | None = None


class DatasourceReuseRequest(BaseModel):
    """Create a dataset from an already saved workspace datasource."""

    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(ord(char) < 32 for char in normalized):
            raise ValueError("Tên dataset không hợp lệ.")
        return normalized


class ConnectorStatus(str, Enum):
    connected = "connected"
    attention_required = "attention_required"
    expired = "expired"
    disconnected = "disconnected"


class ConnectorOut(BaseModel):
    """Safe connector metadata; secret fields are intentionally absent."""

    id: str
    provider: str
    category: Literal["data", "storage", "productivity"]
    name: str
    owner_scope: Literal["workspace", "workspace_user"]
    owner_user_id: str | None = None
    connected_by_user_id: str | None = None
    status: ConnectorStatus
    safe_target: dict[str, Any] = Field(default_factory=dict)
    last_tested_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None
    last_error_code: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    version: int = 1
    dataset_count: int = 0
    can_test: bool = False
    can_edit: bool = False
    can_disconnect: bool = False


class ConnectorListResponse(BaseModel):
    connectors: list[ConnectorOut] = Field(default_factory=list)
    available: list[dict[str, Any]] = Field(default_factory=list)


class ConnectorTestResponse(BaseModel):
    id: str | None = None
    provider: str
    ok: bool
    objects: list[str] = Field(default_factory=list)
    status: ConnectorStatus
    error_code: str | None = None
    detail: str


class ProfileRunSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    dataset_id: str
    run_name: str | None = None
    version: int | None = None
    status: str
    scan_mode: str | None = None
    row_count: int | None = None
    is_approximate: bool = False
    created_at: datetime | None = None
    error: str | None = None


class StatusResponse(BaseModel):
    app: str
    env: str
    llm_provider: str
    llm_model: str
    llm_configured: bool
    embedding_provider: str
    database: str
    checkpointer: str
    auto_confirm: bool
    confidence_threshold: float
    mask_pii_in_answers: bool
    allow_raw_export: bool
    require_api_token: bool
    indexed_documents: int = 0
    external_knowledge_enabled: bool = False
    profile_report_documents: int = 0
    external_knowledge_documents: int = 0
    corpus_revision: str | None = None
    missing_config: list[str] = Field(
        default_factory=list, description="Các biến môi trường bạn cần điền."
    )


class HealthResponse(BaseModel):
    status: str
    app: str
    env: str
    llm_configured: bool
    command_center_enabled: bool


class ErrorResponse(BaseModel):
    detail: str


__all__ = [
    "ColumnStatOut",
    "ConfirmRequest",
    "ConfirmResponse",
    "DatasourceConnectResponse",
    "DatasourceReuseRequest",
    "DatasourceRequest",
    "DatasourceTestResponse",
    "ConnectorListResponse",
    "ConnectorOut",
    "ConnectorStatus",
    "ConnectorTestResponse",
    "DatasetCollectionUpdate",
    "DatasetOut",
    "DriftFinding",
    "DriftRequest",
    "DriftResponse",
    "ErrorResponse",
    "ExternalKnowledgeSource",
    "HealthResponse",
    "ProfileReportSource",
    "ProfileRequest",
    "ProfileResponse",
    "ProfileRunSummary",
    "ProposalDecision",
    "ProposalOut",
    "QAHistoryMessage",
    "QARequest",
    "QAResponse",
    "SamplingConfig",
    "StatusResponse",
    "TestRequest",
    "TestResponse",
    "TestResultOut",
    "TestSpec",
    "ToolSource",
    "UploadResponse",
]
