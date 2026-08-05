"""Application service for profiling workflows.

The service is the API-facing orchestrator: validate source type, inspect schema,
plan metrics, execute DuckDB profiling, then normalize the result for responses.
"""

from __future__ import annotations

from pathlib import Path

from src.models.schemas import (
    DatabaseConnectionConfig,
    DatabaseConnectionStatus,
    DatabasePreviewResult,
    DatabaseTablesResult,
    DatabaseTableInfo,
    ProfileColumnsResult,
    ProfileCorrelationsResult,
    ProfileFindingsResult,
    ProfileResult,
    ProfileSchemaColumn,
    ProfileSchemaResult,
)
from src.profiling.executors.database import DatabaseProfileExecutor
from src.profiling.executors.duckdb import DuckDBProfileExecutor
from src.profiling.planner import ProfilingPlanner
from src.profiling.result_normalizer import ProfileResultNormalizer


class ProfilingService:
    def __init__(self) -> None:
        self.planner = ProfilingPlanner()
        self.normalizer = ProfileResultNormalizer()

    def profile_csv_file(self, file_path: Path, source_name: str) -> ProfileResult:
        executor = DuckDBProfileExecutor()
        schema = executor.get_schema(file_path)
        plan = self.planner.build_plan(schema)
        raw_result = executor.profile_file(file_path, source_name, plan)
        return self.normalizer.normalize(raw_result)

    def inspect_csv_schema(self, file_path: Path, source_name: str) -> ProfileSchemaResult:
        executor = DuckDBProfileExecutor()
        inspection = executor.inspect_file(file_path)
        schema = inspection["schema"]
        return ProfileSchemaResult(
            source_name=source_name,
            source_type="file",
            row_count=inspection["row_count"],
            column_count=len(schema),
            columns=[
                ProfileSchemaColumn(name=column["name"], data_type=column["data_type"])
                for column in schema
            ],
        )

    def profile_csv_columns(self, file_path: Path, source_name: str) -> ProfileColumnsResult:
        full_result = self.profile_csv_file(file_path, source_name)
        return ProfileColumnsResult(
            source_name=full_result.source.name,
            source_type=full_result.source.type,
            row_count=full_result.dataset_summary.row_count,
            column_count=full_result.dataset_summary.column_count,
            columns=full_result.columns,
        )

    def profile_csv_correlations(self, file_path: Path, source_name: str) -> ProfileCorrelationsResult:
        full_result = self.profile_csv_file(file_path, source_name)
        return ProfileCorrelationsResult(
            source_name=full_result.source.name,
            source_type=full_result.source.type,
            correlations=full_result.relationships.correlations,
        )

    def profile_csv_findings(self, file_path: Path, source_name: str) -> ProfileFindingsResult:
        full_result = self.profile_csv_file(file_path, source_name)
        return ProfileFindingsResult(
            source_name=full_result.source.name,
            source_type=full_result.source.type,
            findings=full_result.findings,
        )

    def test_database_connection(
        self,
        config: DatabaseConnectionConfig,
    ) -> DatabaseConnectionStatus:
        result = DatabaseProfileExecutor(config).test_connection()
        return DatabaseConnectionStatus(**result)

    def list_database_tables(self, config: DatabaseConnectionConfig) -> DatabaseTablesResult:
        executor = DatabaseProfileExecutor(config)
        tables = executor.list_tables()
        return DatabaseTablesResult(
            source_type=config.type,
            database=config.database,
            tables=[DatabaseTableInfo(**table) for table in tables],
        )

    def inspect_database_table(
        self,
        config: DatabaseConnectionConfig,
        table_name: str,
        schema_name: str | None = None,
    ) -> ProfileSchemaResult:
        executor = DatabaseProfileExecutor(config)
        schema = executor.get_schema(table_name, schema_name)
        with executor.engine.connect() as connection:
            row_count = connection.execute(
                executor.text(executor.query_builder.row_count_query(table_name, schema_name))
            ).fetchone()[0]
        source_name = f"{schema_name}.{table_name}" if schema_name else table_name
        return ProfileSchemaResult(
            source_name=source_name,
            source_type=config.type,
            row_count=row_count,
            column_count=len(schema),
            columns=[
                ProfileSchemaColumn(name=column["name"], data_type=column["data_type"])
                for column in schema
            ],
        )

    def preview_database_table(
        self,
        config: DatabaseConnectionConfig,
        table_name: str,
        schema_name: str | None = None,
        limit: int = 20,
    ) -> DatabasePreviewResult:
        rows = DatabaseProfileExecutor(config).preview_table(table_name, schema_name, limit)
        return DatabasePreviewResult(
            source_type=config.type,
            schema_name=schema_name,
            table_name=table_name,
            rows=rows,
        )

    def profile_database_table(
        self,
        config: DatabaseConnectionConfig,
        table_name: str,
        schema_name: str | None = None,
    ) -> ProfileResult:
        executor = DatabaseProfileExecutor(config)
        schema = executor.get_schema(table_name, schema_name)
        plan = self.planner.build_plan(schema)
        raw_result = executor.profile_table(table_name, schema_name, plan)
        return self.normalizer.normalize(raw_result)
