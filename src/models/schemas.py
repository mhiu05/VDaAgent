"""Pydantic request and response schemas for API endpoints."""

from pydantic import BaseModel, ConfigDict, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000, description="Message from user")


class ChatResponse(BaseModel):
    response: str = Field(..., description="Agent response")
    analysis: str = Field(default="", description="Internal analysis summary")


class DatabaseConnectionConfig(BaseModel):
    type: str = Field(..., pattern="^(sql_server|postgresql)$", description="Database type")
    host: str = Field(..., description="Database host or server")
    database: str = Field(..., description="Database name")
    username: str = Field(..., description="Database username")
    password: str = Field(..., description="Database password")
    port: int = Field(default=1433, ge=1, le=65535, description="Database port")
    driver: str | None = Field(default=None, description="Optional SQL Server ODBC driver")


class DatabaseTableRequest(BaseModel):
    connection: DatabaseConnectionConfig = Field(..., description="Database connection config")
    schema_name: str | None = Field(default=None, description="Schema name")
    table_name: str = Field(..., description="Table name")


class DatabasePreviewRequest(DatabaseTableRequest):
    limit: int = Field(default=20, ge=1, le=100, description="Preview row limit")


class DatabaseConnectionStatus(BaseModel):
    status: str = Field(..., description="Connection status")
    database_type: str = Field(..., description="Database type")
    database: str = Field(..., description="Database name")


class DatabaseTableInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_name: str = Field(..., alias="schema", description="Schema name")
    table: str = Field(..., description="Table name")


class DatabaseTablesResult(BaseModel):
    source_type: str = Field(..., description="Database type")
    database: str = Field(..., description="Database name")
    tables: list[DatabaseTableInfo] = Field(default_factory=list, description="Available tables")


class DatabasePreviewResult(BaseModel):
    source_type: str = Field(..., description="Database type")
    schema_name: str | None = Field(default=None, description="Schema name")
    table_name: str = Field(..., description="Table name")
    rows: list[dict[str, object | None]] = Field(default_factory=list, description="Preview rows")


class TopValue(BaseModel):
    value: object | None = Field(default=None, description="Observed column value")
    count: int = Field(..., ge=0, description="Number of occurrences")


class RegexPattern(BaseModel):
    name: str = Field(..., description="Detected pattern name")
    match_count: int = Field(..., ge=0, description="Number of sampled values matching the pattern")
    sample_size: int = Field(..., ge=0, description="Number of values checked")
    confidence: float = Field(..., ge=0, le=1, description="Match ratio in the checked sample")


class PiiDetection(BaseModel):
    pii_type: str = Field(..., description="Detected PII category")
    confidence: float = Field(..., ge=0, le=1, description="Rule-based confidence score")
    reason: str = Field(..., description="Why this column was flagged")


class OutlierProfile(BaseModel):
    method: str = Field(default="iqr", description="Outlier detection method")
    lower_bound: float | None = Field(default=None, description="Lower outlier threshold")
    upper_bound: float | None = Field(default=None, description="Upper outlier threshold")
    outlier_count: int = Field(default=0, ge=0, description="Number of detected outlier values")
    outlier_ratio: float = Field(default=0, ge=0, description="Outlier count divided by row count")


class ColumnProfile(BaseModel):
    name: str = Field(..., description="Column name")
    data_type: str = Field(..., description="DuckDB-inferred data type")
    null_count: int = Field(..., ge=0, description="Number of null values")
    distinct_count: int = Field(..., ge=0, description="Number of distinct values")
    null_ratio: float = Field(default=0, ge=0, le=1, description="Null count divided by row count")
    distinct_ratio: float = Field(default=0, ge=0, description="Distinct count divided by row count")
    min: object | None = Field(default=None, description="Minimum value when applicable")
    max: object | None = Field(default=None, description="Maximum value when applicable")
    avg: float | None = Field(default=None, description="Average value for numeric columns")
    stddev: float | None = Field(default=None, description="Sample standard deviation for numeric columns")
    median: float | None = Field(default=None, description="Median value for numeric columns")
    p25: float | None = Field(default=None, description="25th percentile for numeric columns")
    p75: float | None = Field(default=None, description="75th percentile for numeric columns")
    outlier: OutlierProfile | None = Field(default=None, description="IQR-based outlier summary")
    regex_patterns: list[RegexPattern] = Field(default_factory=list, description="Detected value patterns")
    pii_detection: list[PiiDetection] = Field(default_factory=list, description="Rule-based PII flags")
    sample_values: list[object | None] = Field(default_factory=list, description="Example values")
    top_values: list[TopValue] = Field(default_factory=list, description="Most frequent values")


class ProfileFinding(BaseModel):
    severity: str = Field(..., description="Finding severity: info, warning, or critical")
    column: str | None = Field(default=None, description="Related column when available")
    message: str = Field(..., description="Human-readable finding")


class CorrelationProfile(BaseModel):
    left_column: str = Field(..., description="First numeric column")
    right_column: str = Field(..., description="Second numeric column")
    coefficient: float = Field(..., ge=-1, le=1, description="Pearson correlation coefficient")
    strength: str = Field(..., description="Correlation strength bucket")


class ProfileSchemaColumn(BaseModel):
    name: str = Field(..., description="Column name")
    data_type: str = Field(..., description="DuckDB-inferred data type")


class ProfileSchemaResult(BaseModel):
    source_name: str = Field(..., description="Uploaded file name or source name")
    source_type: str = Field(..., description="Source type")
    row_count: int = Field(..., ge=0, description="Number of rows")
    column_count: int = Field(..., ge=0, description="Number of columns")
    columns: list[ProfileSchemaColumn] = Field(default_factory=list, description="Schema columns")


class ProfileColumnsResult(BaseModel):
    source_name: str = Field(..., description="Uploaded file name or source name")
    source_type: str = Field(..., description="Source type")
    row_count: int = Field(..., ge=0, description="Number of rows")
    column_count: int = Field(..., ge=0, description="Number of columns")
    columns: list[ColumnProfile] = Field(default_factory=list, description="Column profiles")


class ProfileCorrelationsResult(BaseModel):
    source_name: str = Field(..., description="Uploaded file name or source name")
    source_type: str = Field(..., description="Source type")
    correlations: list[CorrelationProfile] = Field(
        default_factory=list,
        description="Pairwise correlations between non-ID numeric columns",
    )


class ProfileFindingsResult(BaseModel):
    source_name: str = Field(..., description="Uploaded file name or source name")
    source_type: str = Field(..., description="Source type")
    findings: list[ProfileFinding] = Field(default_factory=list, description="Automatic findings")


class ProfileMetadata(BaseModel):
    engine: str = Field(default="duckdb", description="Profiling execution engine")
    profile_mode: str = Field(default="full", description="Profiling mode")
    sampled: bool = Field(default=False, description="Whether profiling used sampled rows")
    sample_size: int | None = Field(default=None, description="Sample size when sampled is true")
    generated_at: str = Field(..., description="ISO timestamp when profiling finished")
    profiling_version: str = Field(default="0.1.0", description="Profiling implementation version")
    outlier_method: str = Field(default="iqr", description="Outlier detection method")
    correlation_method: str = Field(default="pearson", description="Correlation method")
    hitl_required: bool = Field(default=True, description="Whether key/semantic claims need user confirmation")


class ProfileSource(BaseModel):
    name: str = Field(..., description="Uploaded file name or source name")
    type: str = Field(..., description="Source type")


class DatasetSummary(BaseModel):
    row_count: int = Field(..., ge=0, description="Number of rows")
    column_count: int = Field(..., ge=0, description="Number of columns")


class ProfileRelationships(BaseModel):
    correlations: list[CorrelationProfile] = Field(
        default_factory=list,
        description="Pairwise correlations between non-ID continuous numeric columns",
    )


class QualitySummary(BaseModel):
    critical_count: int = Field(default=0, ge=0, description="Number of critical findings")
    warning_count: int = Field(default=0, ge=0, description="Number of warning findings")
    info_count: int = Field(default=0, ge=0, description="Number of info findings")


class ProfileResult(BaseModel):
    profile_metadata: ProfileMetadata = Field(..., description="How profiling metrics were computed")
    source: ProfileSource = Field(..., description="Profiled data source")
    dataset_summary: DatasetSummary = Field(..., description="Dataset-level counts")
    columns: list[ColumnProfile] = Field(default_factory=list, description="Column profiles")
    relationships: ProfileRelationships = Field(..., description="Cross-column relationships")
    findings: list[ProfileFinding] = Field(default_factory=list, description="Automatic findings")
    quality_summary: QualitySummary = Field(..., description="Finding counts by severity")
