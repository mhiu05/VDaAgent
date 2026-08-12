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
]
