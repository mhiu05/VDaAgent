from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, HTTPException, Request

from src.agents.graph import agent
from src.models.schemas import (
    ChatRequest,
    ChatResponse,
    DatabaseConnectionConfig,
    DatabaseConnectionStatus,
    DatabasePreviewRequest,
    DatabasePreviewResult,
    DatabaseTableRequest,
    DatabaseTablesResult,
    ProfileColumnsResult,
    ProfileCorrelationsResult,
    ProfileFindingsResult,
    ProfileResult,
    ProfileSchemaResult,
)
from src.profiling.service import ProfilingService

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Chat with the AI agent."""
    try:
        result = await agent.ainvoke({"query": request.message})
        return ChatResponse(
            response=result.get("response", ""),
            analysis=result.get("analysis", ""),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def agent_status():
    """Check agent readiness."""
    return {"status": "ready", "agent": "LangGraph Agent v1.0"}


@router.post("/profile/file", response_model=ProfileResult)
async def profile_file(request: Request) -> ProfileResult:
    """Upload a CSV file and run DuckDB profiling end-to-end."""
    return await _run_uploaded_csv_profile(request, "full")


@router.post("/profile/file/schema", response_model=ProfileSchemaResult)
async def profile_file_schema(request: Request) -> ProfileSchemaResult:
    """Upload a CSV file and return schema-level profiling."""
    return await _run_uploaded_csv_profile(request, "schema")


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
            if section == "columns":
                return service.profile_csv_columns(file_path, filename)
            if section == "correlations":
                return service.profile_csv_correlations(file_path, filename)
            if section == "findings":
                return service.profile_csv_findings(file_path, filename)
            return service.profile_csv_file(file_path, filename)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
