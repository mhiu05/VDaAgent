import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

from src.agents.graph import agent
from src.models.schemas import (
    ChatRequest,
    ChatResponse,
    DatabaseConnectionConfig,
    DatabaseConnectionStatus,
    DatabasePreviewRequest,
    DatabasePreviewResult,
    DatabaseQueryPreviewResult,
    DatabaseQueryRequest,
    DatabaseStatisticalTestRequest,
    FilePreviewResult,
    DatabaseProfileSectionsRequest,
    DatabaseTableRequest,
    DatabaseTablesResult,
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
