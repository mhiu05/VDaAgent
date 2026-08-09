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
    username: str | None = Field(default=None, description="Database username")
    password: str | None = Field(default=None, description="Database password")
    port: int = Field(default=1433, ge=1, le=65535, description="Database port")
    driver: str | None = Field(default=None, description="Optional SQL Server ODBC driver")
    auth_type: str = Field(
        default="username_password",
        pattern=(
            "^(username_password|azure_ad_token|aws_iam|gcp_service_account|"
            "client_certificate)$"
        ),
        description="Database authentication strategy",
    )
    access_token: str | None = Field(default=None, description="Pre-generated cloud access token")
    aws_region: str | None = Field(default=None, description="AWS region for IAM database auth")
    gcp_service_account_file: str | None = Field(
        default=None,
        description="Path to GCP service account JSON for Cloud SQL IAM auth",
    )
    ssl_mode: str | None = Field(default=None, description="PostgreSQL SSL mode")
    ssl_cert_path: str | None = Field(default=None, description="Client certificate path")
    ssl_key_path: str | None = Field(default=None, description="Client private key path")
    ssl_root_cert_path: str | None = Field(default=None, description="Root CA certificate path")
    encrypt: bool = Field(default=True, description="SQL Server encryption flag")
    trust_server_certificate: bool = Field(
        default=False,
        description="SQL Server TrustServerCertificate flag",
    )


class DatabaseTableRequest(BaseModel):
    connection: DatabaseConnectionConfig = Field(..., description="Database connection config")
    schema_name: str | None = Field(default=None, description="Schema name")
    table_name: str = Field(..., description="Table name")


class DatabasePreviewRequest(DatabaseTableRequest):
    limit: int = Field(default=20, ge=1, le=100, description="Preview row limit")


class DatabaseQueryRequest(BaseModel):
    connection: DatabaseConnectionConfig = Field(..., description="Database connection config")
    query: str = Field(..., min_length=1, description="Read-only SELECT query to preview or profile")
    limit: int = Field(default=50, ge=1, le=100, description="Preview row limit")


class DatabaseProfileSectionsRequest(DatabaseTableRequest):
    sections: list[str] = Field(..., description="Profile sections to return")


class DatabaseStatisticalTestRequest(DatabaseTableRequest):
    test_type: str = Field(..., description="Statistical test type")
    x_column: str | None = Field(default=None, description="X column for pairwise tests")
    y_column: str | None = Field(default=None, description="Y column for pairwise tests")
    value_column: str | None = Field(default=None, description="Numeric value column for grouped tests")
    group_column: str | None = Field(default=None, description="Group column for grouped tests")
    alpha: float = Field(default=0.05, description="Significance threshold")


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


class DatabaseQueryPreviewResult(BaseModel):
    source_type: str = Field(..., description="Database type")
    query: str = Field(..., description="Previewed SELECT query")
    row_count: int = Field(default=0, ge=0, description="Number of preview rows")
    column_count: int = Field(default=0, ge=0, description="Number of preview columns")
    columns: list["ProfileSchemaColumn"] = Field(default_factory=list, description="Query result columns")
    rows: list[dict[str, object | None]] = Field(default_factory=list, description="Preview rows")


class FilePreviewResult(BaseModel):
    source_name: str = Field(..., description="Uploaded file name")
    source_type: str = Field(default="file", description="Source type")
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


class InferredRelationship(BaseModel):
    left_source: str = Field(..., description="Left file, sheet, or table")
    left_column: str = Field(..., description="Left column")
    right_source: str = Field(..., description="Right file, sheet, or table")
    right_column: str = Field(..., description="Right column")
    relationship_type: str = Field(..., description="Inferred relationship type")
    confidence: float = Field(..., ge=0, le=1, description="Rule-based confidence")
    evidence: str = Field(..., description="Why this relationship was inferred")
    hitl_required: bool = Field(default=True, description="Human confirmation required")


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
    inferred_relationships: list[InferredRelationship] = Field(
        default_factory=list,
        description="Candidate relationships between files/sheets/tables",
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


class ProfileCollectionSummary(BaseModel):
    source_count: int = Field(..., ge=0, description="Number of profiled files or sheets")
    total_row_count: int = Field(..., ge=0, description="Total rows across sources")
    total_column_count: int = Field(..., ge=0, description="Total columns across sources")


class ProfileCollectionResult(BaseModel):
    profile_metadata: ProfileMetadata = Field(..., description="How collection profiling was computed")
    collection_type: str = Field(..., description="multi_csv or excel_workbook")
    collection_name: str = Field(..., description="Collection name")
    collection_summary: ProfileCollectionSummary = Field(..., description="Collection-level counts")
    sources: list[ProfileResult] = Field(default_factory=list, description="Per-source profile results")
    relationships: ProfileRelationships = Field(..., description="Cross-source relationships")


class ProfileSectionsResult(BaseModel):
    source_name: str = Field(..., description="Uploaded file name, sheet name, or table name")
    source_type: str = Field(..., description="Source type")
    requested_sections: list[str] = Field(default_factory=list, description="Requested sections")
    sections: dict[str, object] = Field(default_factory=dict, description="Selected profiling outputs")
    errors: list[dict[str, str]] = Field(default_factory=list, description="Invalid section messages")


class StatisticalTestResult(BaseModel):
    source_name: str = Field(..., description="Uploaded file name or source name")
    test_type: str = Field(..., description="Statistical test type")
    columns: list[str] = Field(default_factory=list, description="Columns used by the test")
    statistic: float | None = Field(default=None, description="Test statistic")
    p_value: float | None = Field(default=None, description="P-value")
    alpha: float = Field(default=0.05, description="Significance threshold")
    significant: bool | None = Field(default=None, description="Whether p_value < alpha")
    sample_size: int = Field(default=0, ge=0, description="Rows used after dropping nulls")
    groups: dict[str, int] = Field(default_factory=dict, description="Group sizes when applicable")
    effect_size: float | None = Field(default=None, description="Optional effect size")
    interpretation: str = Field(..., description="Analyst-friendly interpretation")


class StatisticalTestSpec(BaseModel):
    test_type: str = Field(..., description="Statistical test type")
    x_column: str | None = Field(default=None, description="X column for pairwise tests")
    y_column: str | None = Field(default=None, description="Y column for pairwise tests")
    value_column: str | None = Field(default=None, description="Numeric value column for grouped tests")
    group_column: str | None = Field(default=None, description="Group column for grouped tests")
    alpha: float = Field(default=0.05, description="Significance threshold")


class StatisticalTestBatchResult(BaseModel):
    source_name: str = Field(..., description="Uploaded file name or source name")
    results: list[StatisticalTestResult] = Field(default_factory=list, description="Successful tests")
    errors: list[dict[str, str]] = Field(default_factory=list, description="Failed test messages")
