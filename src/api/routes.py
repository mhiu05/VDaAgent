import json
import re
import unicodedata
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

from fastapi import APIRouter, HTTPException, Query, Request

from src.agents.chat import chat_store
from src.agents.graph import agent
from src.agents.hitl import hitl_store
from src.agents.persistence import agent_repository
from src.agents.planning import planning_store
from src.agents.pii import mask_text
from src.agents.tools.registry import TOOL_REGISTRY
from src.agents.tracing import trace_store
from src.models.schemas import (
    AgentRun,
    AgentToolDefinition,
    AgentTraceEvent,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    Conversation,
    ConversationCreateRequest,
    DatabaseConnectionConfig,
    DatabaseConnectionStatus,
    DatabasePreviewRequest,
    DatabasePreviewResult,
    DatabaseProfileSectionsRequest,
    DatabaseQueryPreviewResult,
    DatabaseQueryRequest,
    DatabaseStatisticalTestRequest,
    DatabaseTableRequest,
    DatabaseTablesResult,
    FilePreviewResult,
    HitlDecisionRequest,
    HitlRecord,
    KnowledgeDocument,
    KnowledgeSearchResult,
    ProfileCollectionResult,
    ProfileColumnsResult,
    ProfileCorrelationsResult,
    ProfileFindingsResult,
    ProfileReportRecord,
    ProfileReportSummary,
    ProfileResult,
    ProfilingPlan,
    ProfilingPlanConfirmRequest,
    ProfilingPlanGenerateRequest,
    ReportComment,
    ReportCommentCreateRequest,
    UserRule,
    UserRuleCreateRequest,
    UserWorkspace,
    UserWorkspaceUpdateRequest,
    ProfileSchemaResult,
    ProfileSectionsResult,
    StatisticalTestBatchResult,
    StatisticalTestResult,
    StatisticalTestSpec,
)
from src.profiling.service import ProfilingService

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Chat with the agent and persist a PII-safe conversation audit copy."""
    started = perf_counter()
    try:
        conversation = chat_store.get_or_create_conversation(
            request.conversation_id,
            request.user_id,
            request.message,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    run = trace_store.start_run(conversation.id, "chat")
    report_record = None
    report_context = ""
    if request.run_id:
        report_record = agent_repository.get_profile_report(request.run_id, user_id=request.user_id)
        if report_record is None:
            raise HTTPException(status_code=404, detail="Saved report not found.")
        report_context = _build_report_chat_context(report_record)
    safe_prompt = mask_text(
        f"{request.message}\n\nSaved report context:\n{report_context}"
        if report_context
        else request.message
    )
    chat_store.add_message(
        conversation.id,
        "user",
        request.message,
        run_id=run.run_id,
        metadata={"profile_run_id": request.run_id} if request.run_id else {},
    )
    trace_store.add_event(
        run.run_id,
        event_type="chat_turn",
        component="agent_chat",
        tool_name="chat_request",
        input_summary=f"User message received ({len(request.message)} characters).",
        metadata={"conversation_id": conversation.id, "profile_run_id": request.run_id},
    )
    try:
        saved_report_answer = (
            _answer_saved_report_question(request.message, report_record)
            if report_record is not None
            else None
        )
        if saved_report_answer is not None:
            response = saved_report_answer
            analysis_summary = "Response generated from saved report metrics."
        elif report_record is not None:
            response = _saved_report_unknown_answer(request.message, report_record)
            analysis_summary = "No supported saved-report evidence matched the question."
        else:
            result = await agent.ainvoke({"query": request.message, "context": report_context})
            response = mask_text(result.get("response", "") or "No response.")
            analysis_summary = mask_text(result.get("analysis", ""))
        chat_store.add_message(conversation.id, "agent", response, run_id=run.run_id)
        duration_ms = int((perf_counter() - started) * 1000)
        trace_store.add_event(
            run.run_id,
            event_type="chat_turn",
            component="agent_chat",
            tool_name="chat_response",
            input_summary="Agent response generation.",
            output_summary=f"Assistant response stored ({len(response)} characters).",
            duration_ms=duration_ms,
        )
        trace_store.finish_run(
            run.run_id,
            "completed",
            {
                "conversation_id": conversation.id,
                "response_time_ms": duration_ms,
                "input_characters": len(request.message),
                "output_characters": len(response),
                "tool_success_rate": 1.0,
                "tool_error_rate": 0.0,
            },
        )
        return ChatResponse(
            response=response,
            analysis=analysis_summary,
            conversation_id=conversation.id,
            run_id=run.run_id,
        )
    except Exception as e:
        duration_ms = int((perf_counter() - started) * 1000)
        trace_store.add_event(
            run.run_id,
            event_type="chat_turn",
            component="agent_chat",
            tool_name="chat_response",
            input_summary="Agent response generation.",
            output_summary="Assistant response failed.",
            status="error",
            error_message=type(e).__name__,
            duration_ms=duration_ms,
        )
        trace_store.finish_run(
            run.run_id,
            "failed",
            {"conversation_id": conversation.id, "response_time_ms": duration_ms, "tool_error_rate": 1.0},
        )
        raise HTTPException(status_code=500, detail="Agent response failed. Check the run trace for details.") from e


def _build_report_chat_context(record: ProfileReportRecord) -> str:
    report = record.report
    summary = report.dataset_summary
    quality = report.quality_summary
    column_lines = []
    for column in report.columns[:80]:
        column_lines.append(
            ", ".join(
                [
                    f"name={column.name}",
                    f"type={column.data_type}",
                    f"null_count={column.null_count}",
                    f"null_ratio={column.null_ratio:.4f}",
                    f"distinct_count={column.distinct_count}",
                    f"distinct_ratio={column.distinct_ratio:.4f}",
                ]
            )
        )
    finding_lines = [
        f"{finding.severity}: {finding.column or 'dataset'} - {finding.message}"
        for finding in report.findings[:40]
    ]
    return "\n".join(
        [
            f"Report: {record.source_name}",
            f"Run ID: {record.run_id}",
            f"Source type: {record.source_type}",
            f"Rows: {summary.row_count}",
            f"Columns: {summary.column_count}",
            f"Warnings: {quality.warning_count}",
            f"Critical: {quality.critical_count}",
            "Column metrics:",
            "\n".join(column_lines) or "No column metrics.",
            "Findings:",
            "\n".join(finding_lines) or "No findings.",
        ]
    )


def _answer_saved_report_question(question: str, record: ProfileReportRecord) -> str | None:
    report = record.report
    question_lower = question.lower()
    normalized_question = _normalize_question(question)
    matched_columns = _find_columns_for_question(normalized_question, record)

    if normalized_question in {"hi", "hello", "hey", "chao", "xin chao"}:
        return (
            f"Hi. I am using saved report '{record.source_name}' "
            f"({report.dataset_summary.row_count:,} rows, {report.dataset_summary.column_count:,} columns). "
            "Ask me about nulls, categorical distributions, schema, or findings."
        )

    if _has_any(
        normalized_question,
        [
            "ban co the lam gi",
            "co the lam gi",
            "lam duoc gi",
            "giup gi",
            "help",
            "what can you do",
            "capabilities",
        ],
    ):
        return "\n".join(
            [
                f"I can answer questions using saved report '{record.source_name}' only.",
                "- Dataset size: rows, columns, source name, generated report summary.",
                "- Column metrics: data type, null count, distinct count, min/max/average when available.",
                "- Distributions: top values for categorical columns when the report stored them.",
                "- Quality evidence: findings, warnings, critical issues, PII detections, HITL-related signals.",
                "- Relationships: correlations when profiling generated them.",
                "If the selected saved report does not contain the evidence, I will say that instead of inventing an answer.",
            ]
        )

    if _has_any(normalized_question, ["bao nhieu dong", "so dong", "row count", "rows"]):
        return f"Saved report '{record.source_name}' has {report.dataset_summary.row_count:,} rows."

    if _has_any(normalized_question, ["bao nhieu cot", "so cot", "column count", "columns count", "columns", "cot trong dataset"]):
        return f"Saved report '{record.source_name}' has {report.dataset_summary.column_count:,} columns."

    if _has_any(
        normalized_question,
        [
            "tat ca thong tin",
            "toan bo thong tin",
            "full report",
            "all information",
            "everything",
            "chi tiet report",
            "thong tin ban biet",
            "thong tin ve report",
        ],
    ):
        return _format_full_report_answer(record)

    if _has_any(normalized_question, ["tong quan", "overview", "summary", "tom tat", "bao cao", "dataset", "du lieu"]):
        return "\n".join(
            [
                f"Saved report '{record.source_name}':",
                f"- Rows: {report.dataset_summary.row_count:,}",
                f"- Columns: {report.dataset_summary.column_count:,}",
                f"- Warnings: {report.quality_summary.warning_count:,}",
                f"- Critical findings: {report.quality_summary.critical_count:,}",
                f"- Info findings: {report.quality_summary.info_count:,}",
            ]
        )

    if _has_any(normalized_question, ["cardinality", "distinct", "distinct count", "do phan biet", "duy nhat"]):
        selected_columns = matched_columns or sorted(
            report.columns,
            key=lambda column: column.distinct_count,
            reverse=True,
        )
        lines = [f"Cardinality in saved report '{record.source_name}':"]
        for column in selected_columns[:12]:
            lines.append(
                f"- {column.name}: {column.distinct_count:,} distinct "
                f"({column.distinct_ratio:.1%} of rows), type={column.data_type}"
            )
        return "\n".join(lines)

    null_columns = sorted(
        [column for column in report.columns if column.null_count > 0],
        key=lambda column: column.null_ratio,
        reverse=True,
    )
    if _has_any(normalized_question, ["null", "missing", "thieu", "khuyet", "rong", "empty"]):
        if not null_columns:
            return (
                f"Saved report '{record.source_name}' has {report.dataset_summary.row_count:,} rows "
                f"and {report.dataset_summary.column_count:,} columns. No columns contain null values."
            )
        top_lines = [
            f"- {column.name}: {column.null_count:,} nulls ({column.null_ratio:.1%})"
            for column in null_columns[:8]
        ]
        return "\n".join(
            [
                f"Saved report '{record.source_name}' has {len(null_columns)} columns with null values.",
                "Highest null ratios:",
                *top_lines,
            ]
        )

    category_keywords = [
        "category",
        "categorical",
        "top value",
        "top values",
        "distribution",
        "phan bo",
        "danh muc",
        "tan suat",
        "value count",
    ]
    if _has_any(normalized_question, category_keywords):
        categorical_columns = [
            column
            for column in (matched_columns or report.columns)
            if _is_categorical_column(column, report.dataset_summary.row_count)
        ]
        if not categorical_columns:
            return (
                f"Saved report '{record.source_name}' does not include categorical top-value "
                "distributions for the requested scope."
            )
        lines = [f"Categorical distributions in saved report '{record.source_name}':"]
        for column in categorical_columns[:8]:
            values = []
            for item in column.top_values[:5]:
                label = "<null>" if item.value is None else str(item.value)
                values.append(f"{label}: {item.count:,} ({item.count / max(report.dataset_summary.row_count, 1):.1%})")
            lines.append(
                f"- {column.name} ({column.data_type}, distinct={column.distinct_count:,}): "
                + "; ".join(values)
            )
        return "\n".join(lines)

    findings_keywords = [
        "finding",
        "findings",
        "warning",
        "critical",
        "issue",
        "risk",
        "loi",
        "canh bao",
        "van de",
        "rui ro",
    ]
    if _has_any(normalized_question, findings_keywords):
        finding_lines = [
            f"- {finding.severity}: {finding.column or 'dataset'} - {finding.message}"
            for finding in report.findings[:10]
        ]
        return "\n".join(
            [
                f"Findings in saved report '{record.source_name}':",
                *(finding_lines or ["- No findings were returned."]),
            ]
        )

    if _has_any(normalized_question, ["pii", "sensitive", "nhay cam", "du lieu ca nhan", "personal"]):
        pii_columns = [
            column for column in report.columns
            if column.pii_detection
        ]
        if not pii_columns:
            return f"Saved report '{record.source_name}' does not contain PII detections."
        lines = [f"PII detections in saved report '{record.source_name}':"]
        for column in pii_columns[:10]:
            detections = "; ".join(
                f"{item.pii_type} ({item.confidence:.0%})" for item in column.pii_detection
            )
            lines.append(f"- {column.name}: {detections}")
        return "\n".join(lines)

    if _has_any(normalized_question, ["correlation", "correlations", "tuong quan", "relationship", "lien he"]):
        correlations = report.relationships.correlations
        if not correlations:
            return f"Saved report '{record.source_name}' does not contain correlation evidence."
        lines = [f"Correlations in saved report '{record.source_name}':"]
        for item in correlations[:10]:
            lines.append(
                f"- {item.left_column} vs {item.right_column}: {item.coefficient:.3f} ({item.strength})"
            )
        return "\n".join(lines)

    schema_keywords = ["schema", "cot", "data type", "datatype", "kieu du lieu", "danh sach cot"]
    if _has_any(normalized_question, schema_keywords) or matched_columns:
        selected_columns = matched_columns or report.columns[:30]
        column_lines = [_format_column_evidence(column) for column in selected_columns[:30]]
        return "\n".join(
            [
                f"Schema summary for saved report '{record.source_name}':",
                f"- Rows: {report.dataset_summary.row_count:,}",
                f"- Columns: {report.dataset_summary.column_count:,}",
                *column_lines,
            ]
        )

    return None


def _saved_report_unknown_answer(question: str, record: ProfileReportRecord) -> str:
    return (
        f"I could not find evidence in saved report '{record.source_name}' to answer that. "
        "This report contains dataset counts, column schema, null/distinct metrics, top values, "
        "findings, PII detections, and correlations when they were generated."
    )


def _format_full_report_answer(record: ProfileReportRecord) -> str:
    report = record.report
    lines = [
        f"Saved report '{record.source_name}'",
        f"- Run ID: {record.run_id}",
        f"- Source type: {record.source_type}",
        f"- Rows: {report.dataset_summary.row_count:,}",
        f"- Columns: {report.dataset_summary.column_count:,}",
        f"- Findings: {report.quality_summary.critical_count} critical, "
        f"{report.quality_summary.warning_count} warning, {report.quality_summary.info_count} info",
    ]

    null_columns = [column for column in report.columns if column.null_count > 0]
    lines.append(
        f"- Null coverage: {len(null_columns)} columns contain null values"
        if null_columns
        else "- Null coverage: no columns contain null values"
    )

    pii_columns = [column for column in report.columns if column.pii_detection]
    lines.append(
        f"- PII detections: {', '.join(column.name for column in pii_columns[:8])}"
        if pii_columns
        else "- PII detections: none stored in this report"
    )

    lines.append("")
    lines.append("Column metrics:")
    for column in report.columns[:40]:
        lines.append(_format_column_evidence(column))
    if len(report.columns) > 40:
        lines.append(f"- ... {len(report.columns) - 40} more columns are stored in the report.")

    if report.findings:
        lines.append("")
        lines.append("Findings:")
        for finding in report.findings[:12]:
            lines.append(f"- {finding.severity}: {finding.column or 'dataset'} - {finding.message}")

    if report.relationships.correlations:
        lines.append("")
        lines.append("Correlations:")
        for item in report.relationships.correlations[:10]:
            lines.append(f"- {item.left_column} vs {item.right_column}: {item.coefficient:.3f} ({item.strength})")

    return "\n".join(lines)


def _normalize_question(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(without_marks.lower().strip(" .!?:;").split())


def _has_any(text: str, keywords: list[str]) -> bool:
    tokens = set(re.findall(r"[a-z0-9_]+", text))
    for keyword in keywords:
        normalized_keyword = _normalize_question(keyword)
        if " " in normalized_keyword:
            if normalized_keyword in text:
                return True
            continue
        if normalized_keyword in tokens:
            return True
    return False


def _find_columns_for_question(normalized_question: str, record: ProfileReportRecord):
    matches = []
    padded_question = f" {normalized_question} "
    for column in record.report.columns:
        normalized_name = _normalize_question(column.name).replace("_", " ")
        compact_name = normalized_name.replace(" ", "")
        if (
            f" {normalized_name} " in padded_question
            or compact_name in normalized_question.replace(" ", "")
        ):
            matches.append(column)
    return matches


def _format_column_evidence(column) -> str:
    parts = [
        f"- {column.name}: {column.data_type}",
        f"null={column.null_count:,} ({column.null_ratio:.1%})",
        f"distinct={column.distinct_count:,}",
    ]
    if column.avg is not None:
        parts.append(f"avg={column.avg:.3g}")
    if column.min is not None:
        parts.append(f"min={column.min}")
    if column.max is not None:
        parts.append(f"max={column.max}")
    if column.top_values:
        top_values = "; ".join(
            f"{'<null>' if item.value is None else item.value}: {item.count:,}"
            for item in column.top_values[:5]
        )
        parts.append(f"top values=[{top_values}]")
    return ", ".join(parts)


def _is_numeric_type(data_type: str) -> bool:
    value = str(data_type or "").lower()
    return any(token in value for token in ["int", "float", "double", "decimal", "numeric", "real"])


def _is_categorical_column(column, row_count: int) -> bool:
    if not column.top_values or _is_numeric_type(column.data_type):
        return False
    max_distinct = max(50, int(max(row_count, 1) * 0.2))
    return column.distinct_count <= max_distinct


@router.post("/conversations", response_model=Conversation)
async def create_conversation(request: ConversationCreateRequest) -> Conversation:
    """Create a server-side conversation before the first chat turn."""
    return chat_store.create_conversation(request.user_id, request.title)


@router.get("/conversations", response_model=list[Conversation])
async def list_conversations(
    user_id: str = Query(default="anonymous", min_length=1, max_length=128),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[Conversation]:
    """List conversation summaries for one user, newest first."""
    return chat_store.list_conversations(user_id, limit=limit, offset=offset)


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessage])
async def list_conversation_messages(
    conversation_id: str,
    user_id: str = Query(default="anonymous", min_length=1, max_length=128),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[ChatMessage]:
    """Return PII-safe messages for one conversation."""
    try:
        return chat_store.list_messages(
            conversation_id,
            user_id,
            limit=limit,
            offset=offset,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/status")
async def agent_status():
    """Check agent readiness."""
    return {"status": "ready", "agent": "LangGraph Agent v1.0"}


@router.get("/users/{user_id}/workspace", response_model=UserWorkspace)
async def get_user_workspace(user_id: str) -> UserWorkspace:
    """Return or create the current user's logical workspace."""
    return agent_repository.get_or_create_user_workspace(user_id)


@router.put("/users/{user_id}/workspace", response_model=UserWorkspace)
async def update_user_workspace(user_id: str, request: UserWorkspaceUpdateRequest) -> UserWorkspace:
    """Update user display profile and workspace metadata."""
    from datetime import UTC, datetime

    existing = agent_repository.get_or_create_user_workspace(user_id)
    existing.display_name = mask_text(request.display_name)
    existing.role = request.role
    existing.metadata = request.metadata
    existing.updated_at = datetime.now(UTC).isoformat()
    return agent_repository.save_user_workspace(existing)


@router.post("/knowledge/documents", response_model=KnowledgeDocument)
async def upload_knowledge_document(request: Request) -> KnowledgeDocument:
    """Upload a requirement document for RAG-style profiling plan generation."""
    form = await request.form()
    user_id = _optional_form_text(form, "user_id") or "anonymous"
    upload = form.get("file")
    if upload is None or not hasattr(upload, "filename") or not hasattr(upload, "read"):
        raise HTTPException(status_code=422, detail="Form field 'file' is required.")
    content = await upload.read()
    return planning_store.ingest_document(
        user_id=user_id,
        filename=Path(upload.filename).name,
        content_type=getattr(upload, "content_type", None) or "application/octet-stream",
        content=content,
    )


@router.get("/knowledge/documents", response_model=list[KnowledgeDocument])
async def list_knowledge_documents(
    user_id: str = Query(default="anonymous", min_length=1, max_length=128),
) -> list[KnowledgeDocument]:
    """List requirement documents for one user."""
    return planning_store.list_documents(user_id)


@router.get("/knowledge/search", response_model=list[KnowledgeSearchResult])
async def search_knowledge_documents(
    user_id: str = Query(default="anonymous", min_length=1, max_length=128),
    query: str = Query(default="", max_length=1000),
    limit: int = Query(default=5, ge=1, le=20),
) -> list[KnowledgeSearchResult]:
    """Search user-scoped requirement documents."""
    return planning_store.search_documents(user_id, query, limit)


@router.post("/profiling/plans", response_model=ProfilingPlan)
async def generate_profiling_plan(request: ProfilingPlanGenerateRequest) -> ProfilingPlan:
    """Generate a structured profiling plan from user requirements and documents."""
    return planning_store.generate_plan(request)


@router.post("/profiling/plans/{plan_id}/confirm", response_model=ProfilingPlan)
async def confirm_profiling_plan(plan_id: str, request: ProfilingPlanConfirmRequest) -> ProfilingPlan:
    """Confirm a generated plan and persist reusable rules for future runs."""
    plan = planning_store.confirm_plan(plan_id, request.user_id, request.confirmed_items, request.answers)
    if plan is None:
        raise HTTPException(status_code=404, detail="Profiling plan not found.")
    return plan


@router.get("/users/{user_id}/rules", response_model=list[UserRule])
async def list_user_rules(user_id: str) -> list[UserRule]:
    """List reusable confirmed user rules and metadata."""
    return agent_repository.list_user_rules(user_id)


@router.post("/users/{user_id}/rules", response_model=UserRule)
async def create_user_rule(user_id: str, request: UserRuleCreateRequest) -> UserRule:
    """Create one reusable user-defined profiling rule."""
    from datetime import UTC, datetime
    from uuid import uuid4

    rule = UserRule(
        id=f"rule_{uuid4().hex}",
        user_id=user_id,
        source_name=request.source_name,
        column=request.column,
        rule_type=request.rule_type,
        description=mask_text(request.description),
        evidence=mask_text(request.evidence),
        created_at=datetime.now(UTC).isoformat(),
    )
    return agent_repository.save_user_rule(rule)


@router.get("/agent/tools", response_model=list[AgentToolDefinition])
async def list_agent_tools() -> list[AgentToolDefinition]:
    """List deterministic tools available to the profiling agent workflow."""
    return TOOL_REGISTRY


@router.get("/agent/runs", response_model=list[AgentRun])
async def list_agent_runs(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user_id: str | None = Query(default=None, min_length=1, max_length=128),
) -> list[AgentRun]:
    """List recent agent runs for the observability dashboard."""
    return trace_store.list_runs(limit=limit, offset=offset, user_id=user_id)


@router.get("/agent/runs/{run_id}", response_model=AgentRun)
async def get_agent_run(run_id: str) -> AgentRun:
    """Return one agent run."""
    run = trace_store.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return run


@router.get("/agent/runs/{run_id}/trace", response_model=list[AgentTraceEvent])
async def list_agent_run_trace(
    run_id: str,
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[AgentTraceEvent]:
    """Return trace events for one agent run."""
    return trace_store.list_events(run_id, limit=limit, offset=offset)


@router.get("/agent/traces", response_model=list[AgentTraceEvent])
async def list_agent_traces(
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[AgentTraceEvent]:
    """Return persisted trace events for the observability dashboard."""
    return trace_store.list_events(limit=limit, offset=offset)


@router.get("/hitl", response_model=list[HitlRecord])
async def list_hitl_records(
    status: str | None = None,
    run_id: str | None = None,
    user_id: str | None = Query(default=None, min_length=1, max_length=128),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[HitlRecord]:
    """List HITL governance records."""
    return hitl_store.list_records(status=status, run_id=run_id, user_id=user_id, limit=limit, offset=offset)


@router.get("/profile/reports", response_model=list[ProfileReportSummary])
async def list_profile_reports(
    user_id: str | None = Query(default=None, min_length=1, max_length=128),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[ProfileReportSummary]:
    """List persisted profile reports for the report history page."""
    return agent_repository.list_profile_reports(limit=limit, offset=offset, user_id=user_id)


@router.get("/profile/reports/{run_id}", response_model=ProfileReportRecord)
async def get_profile_report(
    run_id: str,
    user_id: str | None = Query(default=None, min_length=1, max_length=128),
) -> ProfileReportRecord:
    """Return one persisted profile report by agent run identifier."""
    report = agent_repository.get_profile_report(run_id, user_id=user_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Profile report not found.")
    return report


@router.get("/profile/reports/{run_id}/comments", response_model=list[ReportComment])
async def list_profile_report_comments(
    run_id: str,
    user_id: str | None = Query(default=None, min_length=1, max_length=128),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ReportComment]:
    """List comments attached to one profile report."""
    return agent_repository.list_report_comments(run_id, user_id=user_id, limit=limit, offset=offset)


@router.post("/profile/reports/{run_id}/comments", response_model=ReportComment)
async def add_profile_report_comment(
    run_id: str,
    request: ReportCommentCreateRequest,
) -> ReportComment:
    """Attach one analyst comment to a profile report."""
    report = agent_repository.get_profile_report(run_id, user_id=request.user_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Profile report not found.")
    return agent_repository.add_report_comment(
        run_id=run_id,
        user_id=request.user_id,
        author_name=mask_text(request.author_name),
        comment=mask_text(request.comment),
        column=request.column,
    )


@router.post("/hitl/{record_id}/approve", response_model=HitlRecord)
async def approve_hitl_record(record_id: str, request: HitlDecisionRequest) -> HitlRecord:
    """Approve one HITL governance record."""
    record = hitl_store.decide(record_id, "approved", request)
    if record is None:
        raise HTTPException(status_code=404, detail="HITL record not found.")
    from datetime import UTC, datetime
    from uuid import uuid4

    run = agent_repository.get_run(record.run_id)
    user_id = str((run.metrics if run else {}).get("user_id") or request.reviewer or "anonymous")
    agent_repository.save_user_rule(UserRule(
        id=f"rule_{uuid4().hex}",
        user_id=user_id,
        source_name=record.source,
        column=record.columns[0] if record.columns else record.table,
        rule_type=record.type,
        description=record.proposed_action,
        evidence=record.comment or record.evidence,
        created_at=datetime.now(UTC).isoformat(),
    ))
    return record


@router.post("/hitl/{record_id}/reject", response_model=HitlRecord)
async def reject_hitl_record(record_id: str, request: HitlDecisionRequest) -> HitlRecord:
    """Reject one HITL governance record."""
    record = hitl_store.decide(record_id, "rejected", request)
    if record is None:
        raise HTTPException(status_code=404, detail="HITL record not found.")
    return record


@router.post("/profile/file", response_model=ProfileResult)
async def profile_file(request: Request) -> ProfileResult:
    """Upload a CSV file and run DuckDB profiling end-to-end."""
    return await _run_uploaded_csv_profile(request, "full")


@router.post("/profile/file/schema", response_model=ProfileSchemaResult)
async def profile_file_schema(request: Request) -> ProfileSchemaResult:
    """Upload a CSV file and return schema-level profiling."""
    return await _run_uploaded_csv_profile(request, "schema")


@router.post("/profile/file/preview", response_model=FilePreviewResult)
async def preview_file_rows(request: Request) -> FilePreviewResult:
    """Upload a CSV file and return preview rows."""
    return await _run_uploaded_csv_profile(request, "preview")


@router.post("/profile/file/columns", response_model=ProfileColumnsResult)
async def profile_file_columns(request: Request) -> ProfileColumnsResult:
    """Upload a CSV file and return per-column metrics."""
    return await _run_uploaded_csv_profile(request, "columns")


@router.post("/profile/file/correlations", response_model=ProfileCorrelationsResult)
async def profile_file_correlations(request: Request) -> ProfileCorrelationsResult:
    """Upload a CSV file and return numeric correlations."""
    return await _run_uploaded_csv_profile(request, "correlations")


@router.post("/profile/file/findings", response_model=ProfileFindingsResult)
async def profile_file_findings(request: Request) -> ProfileFindingsResult:
    """Upload a CSV file and return automatic findings."""
    return await _run_uploaded_csv_profile(request, "findings")


@router.post("/profile/file/sections", response_model=ProfileSectionsResult)
async def profile_file_sections(request: Request) -> ProfileSectionsResult:
    """Upload a CSV file and return selected profiling sections."""
    return await _run_uploaded_csv_profile(request, "sections")


@router.post("/profile/files", response_model=ProfileCollectionResult)
async def profile_multiple_csv_files(request: Request) -> ProfileCollectionResult:
    """Upload multiple CSV files and infer cross-file relationships."""
    try:
        form = await request.form()
        uploads = form.getlist("files")
        if not uploads:
            raise HTTPException(status_code=422, detail="Form field 'files' is required.")

        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            saved_files = []
            for upload in uploads:
                if not hasattr(upload, "filename") or not hasattr(upload, "read"):
                    continue
                filename = Path(upload.filename).name
                if not filename.lower().endswith(".csv"):
                    raise HTTPException(status_code=400, detail="Only CSV files are supported.")
                file_path = temp_path / filename
                file_path.write_bytes(await upload.read())
                saved_files.append((file_path, filename))

            if not saved_files:
                raise HTTPException(status_code=422, detail="At least one CSV file is required.")
            user_id = _optional_form_text(form, "user_id") or "anonymous"
            return ProfilingService().profile_csv_files(saved_files, user_id=user_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/excel", response_model=ProfileCollectionResult)
async def profile_excel_workbook(request: Request) -> ProfileCollectionResult:
    """Upload an Excel workbook and profile each sheet."""
    try:
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "filename") or not hasattr(upload, "read"):
            raise HTTPException(status_code=422, detail="Form field 'file' is required.")

        filename = Path(upload.filename).name
        if not filename.lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="Only .xlsx upload is supported.")

        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            workbook_path = temp_path / filename
            workbook_path.write_bytes(await upload.read())
            user_id = _optional_form_text(form, "user_id") or "anonymous"
            return ProfilingService().profile_excel_workbook(workbook_path, filename, temp_path, user_id=user_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analysis/statistical-test/file", response_model=StatisticalTestResult)
async def run_file_statistical_test(request: Request) -> StatisticalTestResult:
    """Upload a CSV file and run one analyst statistical test."""
    try:
        return await _run_uploaded_csv_analysis(
            request,
            lambda form, file_path, filename: ProfilingService().run_csv_statistical_test(
                file_path=file_path,
                source_name=filename,
                test_type=_required_form_text(form, "test_type"),
                alpha=_form_float(form, "alpha", 0.05),
                x_column=_optional_form_text(form, "x_column"),
                y_column=_optional_form_text(form, "y_column"),
                value_column=_optional_form_text(form, "value_column"),
                group_column=_optional_form_text(form, "group_column"),
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analysis/pearson-correlation/file", response_model=StatisticalTestResult)
async def run_file_pearson_correlation(request: Request) -> StatisticalTestResult:
    """Run Pearson correlation for two numeric CSV columns."""
    return await _run_uploaded_csv_analysis(
        request,
        lambda form, file_path, filename: ProfilingService().run_csv_pearson_correlation(
            file_path,
            filename,
            _required_form_text(form, "x_column"),
            _required_form_text(form, "y_column"),
            _form_float(form, "alpha", 0.05),
        ),
    )


@router.post("/analysis/spearman-correlation/file", response_model=StatisticalTestResult)
async def run_file_spearman_correlation(request: Request) -> StatisticalTestResult:
    """Run Spearman correlation for two numeric CSV columns."""
    return await _run_uploaded_csv_analysis(
        request,
        lambda form, file_path, filename: ProfilingService().run_csv_spearman_correlation(
            file_path,
            filename,
            _required_form_text(form, "x_column"),
            _required_form_text(form, "y_column"),
            _form_float(form, "alpha", 0.05),
        ),
    )


@router.post("/analysis/independent-t-test/file", response_model=StatisticalTestResult)
async def run_file_independent_t_test(request: Request) -> StatisticalTestResult:
    """Run Welch independent t-test for one numeric column across two groups."""
    return await _run_uploaded_csv_analysis(
        request,
        lambda form, file_path, filename: ProfilingService().run_csv_independent_t_test(
            file_path,
            filename,
            _required_form_text(form, "value_column"),
            _required_form_text(form, "group_column"),
            _form_float(form, "alpha", 0.05),
        ),
    )


@router.post("/analysis/chi-square-independence/file", response_model=StatisticalTestResult)
async def run_file_chi_square_independence(request: Request) -> StatisticalTestResult:
    """Run chi-square independence test for two categorical CSV columns."""
    return await _run_uploaded_csv_analysis(
        request,
        lambda form, file_path, filename: ProfilingService().run_csv_chi_square_independence(
            file_path,
            filename,
            _required_form_text(form, "x_column"),
            _required_form_text(form, "y_column"),
            _form_float(form, "alpha", 0.05),
        ),
    )


@router.post("/analysis/one-way-anova/file", response_model=StatisticalTestResult)
async def run_file_one_way_anova(request: Request) -> StatisticalTestResult:
    """Run one-way ANOVA for one numeric column across groups."""
    return await _run_uploaded_csv_analysis(
        request,
        lambda form, file_path, filename: ProfilingService().run_csv_one_way_anova(
            file_path,
            filename,
            _required_form_text(form, "value_column"),
            _required_form_text(form, "group_column"),
            _form_float(form, "alpha", 0.05),
        ),
    )


@router.post("/analysis/statistical-tests/file", response_model=StatisticalTestBatchResult)
async def run_file_statistical_tests(request: Request) -> StatisticalTestBatchResult:
    """Upload a CSV file and run multiple selected analyst statistical tests."""
    return await _run_uploaded_csv_analysis(
        request,
        lambda form, file_path, filename: ProfilingService().run_csv_statistical_tests(
            file_path,
            filename,
            _parse_test_specs(_required_form_text(form, "tests")),
        ),
    )


@router.post("/analysis/statistical-test/database", response_model=StatisticalTestResult)
async def run_database_statistical_test(request: DatabaseStatisticalTestRequest) -> StatisticalTestResult:
    """Run one analyst statistical test against a database table."""
    try:
        return ProfilingService().run_database_statistical_test(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _run_uploaded_csv_analysis(
    request: Request,
    runner: Callable[[object, Path, str], object],
):
    try:
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "filename") or not hasattr(upload, "read"):
            raise HTTPException(status_code=422, detail="Form field 'file' is required.")

        filename = Path(upload.filename).name
        if not filename.lower().endswith(".csv"):
            raise HTTPException(status_code=400, detail="Only CSV upload is supported.")
        with TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / filename
            file_path.write_bytes(await upload.read())
            return runner(form, file_path, filename)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/test", response_model=DatabaseConnectionStatus)
async def test_database_connection(connection: DatabaseConnectionConfig) -> DatabaseConnectionStatus:
    """Test SQL Server or PostgreSQL connection."""
    try:
        return ProfilingService().test_database_connection(connection)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/tables", response_model=DatabaseTablesResult)
async def list_database_tables(connection: DatabaseConnectionConfig) -> DatabaseTablesResult:
    """List available database tables."""
    try:
        return ProfilingService().list_database_tables(connection)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/schema", response_model=ProfileSchemaResult)
async def inspect_database_table(request: DatabaseTableRequest) -> ProfileSchemaResult:
    """Inspect row count and schema for a database table."""
    try:
        return ProfilingService().inspect_database_table(
            request.connection,
            request.table_name,
            request.schema_name,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/preview", response_model=DatabasePreviewResult)
async def preview_database_table(request: DatabasePreviewRequest) -> DatabasePreviewResult:
    """Preview rows from a database table."""
    try:
        return ProfilingService().preview_database_table(
            request.connection,
            request.table_name,
            request.schema_name,
            request.limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/query/preview", response_model=DatabaseQueryPreviewResult)
async def preview_database_query(request: DatabaseQueryRequest) -> DatabaseQueryPreviewResult:
    """Preview rows and inferred schema from a read-only database query."""
    try:
        return ProfilingService().preview_database_query(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/table", response_model=ProfileResult)
async def profile_database_table(
    request: DatabaseTableRequest,
    user_id: str = Query(default="anonymous", min_length=1, max_length=128),
) -> ProfileResult:
    """Profile a database table with query pushdown."""
    try:
        return ProfilingService().profile_database_table(
            request.connection,
            request.table_name,
            request.schema_name,
            user_id=user_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/query", response_model=ProfileResult)
async def profile_database_query(
    request: DatabaseQueryRequest,
    user_id: str = Query(default="anonymous", min_length=1, max_length=128),
) -> ProfileResult:
    """Profile the result of a read-only database query."""
    try:
        return ProfilingService().profile_database_query(request, user_id=user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/sections", response_model=ProfileSectionsResult)
async def profile_database_sections(
    request: DatabaseProfileSectionsRequest,
    user_id: str = Query(default="anonymous", min_length=1, max_length=128),
) -> ProfileSectionsResult:
    """Profile a database table and return selected sections."""
    try:
        return ProfilingService().profile_database_sections(
            request.connection,
            request.table_name,
            request.schema_name,
            request.sections,
            user_id=user_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _run_uploaded_csv_profile(request: Request, section: str):
    try:
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "filename") or not hasattr(upload, "read"):
            raise HTTPException(status_code=422, detail="Form field 'file' is required.")

        filename = Path(upload.filename).name
        if not filename.lower().endswith(".csv"):
            raise HTTPException(status_code=400, detail="Only CSV upload is supported in the MVP.")

        with TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / filename
            file_path.write_bytes(await upload.read())
            service = ProfilingService()
            if section == "schema":
                return service.inspect_csv_schema(file_path, filename)
            if section == "preview":
                limit_text = _optional_form_text(form, "limit")
                return service.preview_csv_file(file_path, filename, int(limit_text or 50))
            if section == "columns":
                return service.profile_csv_columns(file_path, filename, user_id=_optional_form_text(form, "user_id") or "anonymous")
            if section == "correlations":
                return service.profile_csv_correlations(file_path, filename, user_id=_optional_form_text(form, "user_id") or "anonymous")
            if section == "findings":
                return service.profile_csv_findings(file_path, filename, user_id=_optional_form_text(form, "user_id") or "anonymous")
            if section == "sections":
                return service.profile_csv_sections(
                    file_path,
                    filename,
                    _parse_sections(_required_form_text(form, "sections")),
                    user_id=_optional_form_text(form, "user_id") or "anonymous",
                )
            return service.profile_csv_file(file_path, filename, user_id=_optional_form_text(form, "user_id") or "anonymous")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _optional_form_text(form, key: str) -> str | None:
    value = form.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _required_form_text(form, key: str) -> str:
    value = _optional_form_text(form, key)
    if value is None:
        raise HTTPException(status_code=422, detail=f"Form field '{key}' is required.")
    return value


def _form_float(form, key: str, default: float) -> float:
    value = _optional_form_text(form, key)
    if value is None:
        return default
    return float(value)


def _parse_test_specs(raw_tests: str) -> list[StatisticalTestSpec]:
    parsed = json.loads(raw_tests)
    if not isinstance(parsed, list):
        raise ValueError("Form field 'tests' must be a JSON array.")
    return [StatisticalTestSpec(**item) for item in parsed]


def _parse_sections(raw_sections: str) -> list[str]:
    try:
        parsed = json.loads(raw_sections)
    except json.JSONDecodeError:
        return [section.strip() for section in raw_sections.split(",") if section.strip()]
    if not isinstance(parsed, list):
        raise ValueError("Form field 'sections' must be a JSON array or comma-separated string.")
    return [str(section) for section in parsed]
