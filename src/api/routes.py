import json
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

from fastapi import APIRouter, HTTPException, Query, Request

from src.agents.chat import chat_store
from src.agents.graph import agent
from src.agents.hitl import hitl_store
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
    ProfileCollectionResult,
    ProfileColumnsResult,
    ProfileCorrelationsResult,
    ProfileFindingsResult,
    ProfileResult,
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
    safe_prompt = mask_text(request.message)
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
        result = await agent.ainvoke({"query": safe_prompt})
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


@router.get("/agent/tools", response_model=list[AgentToolDefinition])
async def list_agent_tools() -> list[AgentToolDefinition]:
    """List deterministic tools available to the profiling agent workflow."""
    return TOOL_REGISTRY


@router.get("/agent/runs", response_model=list[AgentRun])
async def list_agent_runs(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AgentRun]:
    """List recent agent runs for the observability dashboard."""
    return trace_store.list_runs(limit=limit, offset=offset)


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
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[HitlRecord]:
    """List HITL governance records."""
    return hitl_store.list_records(status=status, run_id=run_id, limit=limit, offset=offset)


@router.post("/hitl/{record_id}/approve", response_model=HitlRecord)
async def approve_hitl_record(record_id: str, request: HitlDecisionRequest) -> HitlRecord:
    """Approve one HITL governance record."""
    record = hitl_store.decide(record_id, "approved", request)
    if record is None:
        raise HTTPException(status_code=404, detail="HITL record not found.")
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
            return ProfilingService().profile_csv_files(saved_files)
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
            return ProfilingService().profile_excel_workbook(workbook_path, filename, temp_path)
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
async def profile_database_table(request: DatabaseTableRequest) -> ProfileResult:
    """Profile a database table with query pushdown."""
    try:
        return ProfilingService().profile_database_table(
            request.connection,
            request.table_name,
            request.schema_name,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/query", response_model=ProfileResult)
async def profile_database_query(request: DatabaseQueryRequest) -> ProfileResult:
    """Profile the result of a read-only database query."""
    try:
        return ProfilingService().profile_database_query(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile/database/sections", response_model=ProfileSectionsResult)
async def profile_database_sections(request: DatabaseProfileSectionsRequest) -> ProfileSectionsResult:
    """Profile a database table and return selected sections."""
    try:
        return ProfilingService().profile_database_sections(
            request.connection,
            request.table_name,
            request.schema_name,
            request.sections,
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
                return service.profile_csv_columns(file_path, filename)
            if section == "correlations":
                return service.profile_csv_correlations(file_path, filename)
            if section == "findings":
                return service.profile_csv_findings(file_path, filename)
            if section == "sections":
                return service.profile_csv_sections(
                    file_path,
                    filename,
                    _parse_sections(_required_form_text(form, "sections")),
                )
            return service.profile_csv_file(file_path, filename)
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
