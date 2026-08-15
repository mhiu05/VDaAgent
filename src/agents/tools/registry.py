"""Agent tool catalog used by workflow and observability APIs.

The current implementation wraps deterministic profiling capabilities as named
tools so each step can be traced and later replaced by richer agent tooling.
"""

from __future__ import annotations

from src.models.schemas import AgentToolDefinition

TOOL_REGISTRY = [
    AgentToolDefinition(
        name="schema_inspection",
        description="Inspect source schema, row count, column count, and datatypes.",
        input_schema={"source": "file | database table | query"},
        output_schema={"columns": "list", "row_count": "int"},
    ),
    AgentToolDefinition(
        name="column_profiling",
        description="Compute nulls, distinct counts, quantiles, top values, and outlier metrics.",
        input_schema={"columns": "list"},
        output_schema={"column_profiles": "list"},
    ),
    AgentToolDefinition(
        name="correlation_analysis",
        description="Compute pairwise Pearson correlations for eligible numeric columns.",
        input_schema={"numeric_columns": "list"},
        output_schema={"correlations": "list"},
    ),
    AgentToolDefinition(
        name="pii_detection",
        description="Detect and mask PII in column samples and top values.",
        input_schema={"columns": "list"},
        output_schema={"pii_columns": "list", "masked_value_count": "int"},
    ),
    AgentToolDefinition(
        name="hitl_proposal",
        description="Create HITL records for PII, key, duplicate identifier, and relationship candidates.",
        input_schema={"findings": "list"},
        output_schema={"hitl_records": "list"},
    ),
    AgentToolDefinition(
        name="report_generation",
        description="Generate the final safe profiling report and agent summary.",
        input_schema={"profile": "ProfileResult"},
        output_schema={"report": "ProfileResult", "agent_run": "AgentRun"},
    ),
    AgentToolDefinition(
        name="get_report_overview",
        description="Retrieve row count, column count, and quality summary from a saved profiling report.",
        input_schema={"run_id": "str"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_schema",
        description="Retrieve schema and column metrics from a saved profiling report.",
        input_schema={"run_id": "str", "column_names": "list[str] | null"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_nulls",
        description="Retrieve null and missing-value evidence from a saved profiling report.",
        input_schema={"run_id": "str"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_categorical_columns",
        description="Retrieve categorical column evidence from a saved profiling report.",
        input_schema={"run_id": "str"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_distribution",
        description="Retrieve top-value distributions from a saved profiling report.",
        input_schema={"run_id": "str", "column_names": "list[str] | null"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_findings",
        description="Retrieve data quality findings from a saved profiling report.",
        input_schema={"run_id": "str"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_pii",
        description="Retrieve PII detections from a saved profiling report.",
        input_schema={"run_id": "str"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_correlations",
        description="Retrieve correlation evidence from a saved profiling report.",
        input_schema={"run_id": "str"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_cardinality",
        description="Retrieve distinct-count/cardinality evidence from a saved profiling report.",
        input_schema={"run_id": "str", "column_names": "list[str] | null"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="get_full_report",
        description="Retrieve a broad saved-report summary with metrics and findings.",
        input_schema={"run_id": "str"},
        output_schema={"intent": "str", "facts": "list", "status": "answered | not_found"},
    ),
    AgentToolDefinition(
        name="search_requirement_documents",
        description="Search uploaded requirement or policy documents for planning evidence.",
        input_schema={"user_id": "str", "query": "str", "limit": "int"},
        output_schema={"matches": "list[KnowledgeSearchResult]"},
    ),
    AgentToolDefinition(
        name="create_profiling_plan",
        description="Create a structured profiling plan from selected sections, requirements, and questions.",
        input_schema={"selected_sections": "list", "items": "list", "clarification_questions": "list"},
        output_schema={"plan": "ProfilingPlan"},
    ),
    AgentToolDefinition(
        name="create_database_plan",
        description="Recommend database tables from available tables and requirement evidence.",
        input_schema={"recommended_tables": "list", "questions": "list", "evidence": "list"},
        output_schema={"recommendation": "DatabasePlanRecommendation"},
    ),
]
