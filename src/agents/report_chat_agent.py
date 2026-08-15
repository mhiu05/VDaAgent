"""Tool-calling chat agent for saved profiling reports."""

from __future__ import annotations

from dataclasses import dataclass, field
from time import perf_counter

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool

from src.agents.pii import mask_text
from src.agents.saved_report_lookup import (
    SavedReportAnswerFormatter,
    SavedReportEvidence,
    SavedReportLookupService,
)
from src.models.schemas import ProfileReportRecord
from src.services.llm import get_llm


@dataclass
class SavedReportToolEvent:
    tool_name: str
    input_summary: str
    output_summary: str
    duration_ms: int
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass
class SavedReportToolAgentResult:
    response: str
    analysis: str
    used_tools: list[SavedReportToolEvent] = field(default_factory=list)
    used_llm: bool = True


class SavedReportToolCallingAgent:
    """Answer saved-report questions through an LLM tool-calling loop."""

    def __init__(
        self,
        lookup_service: SavedReportLookupService | None = None,
        formatter: SavedReportAnswerFormatter | None = None,
    ) -> None:
        self.lookup_service = lookup_service or SavedReportLookupService()
        self.formatter = formatter or SavedReportAnswerFormatter()

    async def answer(
        self,
        question: str,
        record: ProfileReportRecord,
        *,
        llm=None,
    ) -> SavedReportToolAgentResult:
        tool_events: list[SavedReportToolEvent] = []

        def tool_payload(tool_name: str, evidence: SavedReportEvidence, started: float) -> str:
            tool_events.append(
                SavedReportToolEvent(
                    tool_name=tool_name,
                    input_summary=f"Read {evidence.intent} evidence for run_id={record.run_id}.",
                    output_summary=f"intent={evidence.intent}, facts={len(evidence.facts)}",
                    duration_ms=int((perf_counter() - started) * 1000),
                    metadata={"intent": evidence.intent, "evidence_items": len(evidence.facts)},
                )
            )
            return evidence.to_tool_json()

        @tool
        def get_report_overview() -> str:
            """Get row count, column count, and quality summary for the selected report."""

            started = perf_counter()
            return tool_payload("get_report_overview", self.lookup_service.get_overview(record), started)

        @tool
        def get_schema(column_names: list[str] | None = None) -> str:
            """Get schema and column metrics. Pass column_names to scope the answer."""

            started = perf_counter()
            return tool_payload("get_schema", self.lookup_service.get_schema(record, column_names), started)

        @tool
        def get_nulls() -> str:
            """Get null or missing-value evidence from the selected report."""

            started = perf_counter()
            return tool_payload("get_nulls", self.lookup_service.get_nulls(record), started)

        @tool
        def get_categorical_columns() -> str:
            """Get categorical columns detected in the selected report."""

            started = perf_counter()
            return tool_payload(
                "get_categorical_columns",
                self.lookup_service.get_categorical_columns(record),
                started,
            )

        @tool
        def get_distribution(column_names: list[str] | None = None) -> str:
            """Get stored top-value distributions for categorical columns."""

            started = perf_counter()
            return tool_payload(
                "get_distribution",
                self.lookup_service.get_distribution(record, column_names),
                started,
            )

        @tool
        def get_findings() -> str:
            """Get data quality findings from the selected report."""

            started = perf_counter()
            return tool_payload("get_findings", self.lookup_service.get_findings(record), started)

        @tool
        def get_pii() -> str:
            """Get PII detections from the selected report."""

            started = perf_counter()
            return tool_payload("get_pii", self.lookup_service.get_pii(record), started)

        @tool
        def get_correlations() -> str:
            """Get correlation evidence from the selected report."""

            started = perf_counter()
            return tool_payload("get_correlations", self.lookup_service.get_correlations(record), started)

        @tool
        def get_cardinality(column_names: list[str] | None = None) -> str:
            """Get distinct-count/cardinality evidence. Pass column_names to scope the answer."""

            started = perf_counter()
            return tool_payload(
                "get_cardinality",
                self.lookup_service.get_cardinality(record, column_names),
                started,
            )

        @tool
        def get_full_report() -> str:
            """Get a broad saved-report summary with column metrics and findings."""

            started = perf_counter()
            return tool_payload("get_full_report", self.lookup_service.get_full_report(record), started)

        report_tools = [
            get_report_overview,
            get_schema,
            get_nulls,
            get_categorical_columns,
            get_distribution,
            get_findings,
            get_pii,
            get_correlations,
            get_cardinality,
            get_full_report,
        ]

        try:
            model = llm or get_llm()
            tool_bound_model = model.bind_tools(report_tools)
        except Exception as exc:
            return self._fallback_answer(
                question,
                record,
                tool_events,
                f"LLM tool binding failed with {type(exc).__name__}.",
            )
        messages = [
            SystemMessage(content=_system_prompt()),
            SystemMessage(
                content=(
                    f"Selected report: {record.source_name}; run_id={record.run_id}; "
                    f"rows={record.row_count}; columns={record.column_count}."
                )
            ),
            HumanMessage(content=question),
        ]

        try:
            first_response = await tool_bound_model.ainvoke(messages)
        except Exception as exc:
            return self._fallback_answer(
                question,
                record,
                tool_events,
                f"LLM tool-call request failed with {type(exc).__name__}.",
            )
        tool_calls = getattr(first_response, "tool_calls", None) or []
        if not tool_calls:
            return self._fallback_answer(
                question,
                record,
                tool_events,
                "LLM did not call a saved-report evidence tool.",
            )

        messages.append(first_response)
        tool_by_name = {selected_tool.name: selected_tool for selected_tool in report_tools}
        for tool_call in tool_calls:
            tool_name = tool_call.get("name")
            selected_tool = tool_by_name.get(tool_name)
            if selected_tool is None:
                continue
            tool_content = selected_tool.invoke(tool_call.get("args") or {})
            messages.append(
                ToolMessage(
                    content=tool_content,
                    tool_call_id=tool_call.get("id", tool_name),
                )
            )

        try:
            final_response = await tool_bound_model.ainvoke(messages)
        except Exception as exc:
            return self._fallback_answer(
                question,
                record,
                tool_events,
                f"LLM final answer request failed with {type(exc).__name__}.",
            )
        return SavedReportToolAgentResult(
            response=mask_text(str(final_response.content) or self.formatter.unknown(record)),
            analysis=f"LLM answered using {len(tool_events)} saved-report evidence tool call(s).",
            used_tools=tool_events,
        )

    def _fallback_answer(
        self,
        question: str,
        record: ProfileReportRecord,
        tool_events: list[SavedReportToolEvent],
        reason: str,
    ) -> SavedReportToolAgentResult:
        started = perf_counter()
        evidence = self.lookup_service.lookup(question, record)
        duration_ms = int((perf_counter() - started) * 1000)
        if evidence is None:
            tool_events.append(
                SavedReportToolEvent(
                    tool_name="saved_report_lookup_fallback",
                    input_summary=f"Fallback lookup saved report evidence for run_id={record.run_id}.",
                    output_summary="no matching evidence",
                    duration_ms=duration_ms,
                    metadata={"intent": "unknown", "evidence_items": 0, "fallback": True},
                )
            )
            response = self.formatter.unknown(record)
            analysis = f"{reason} Fallback found no matching evidence."
        else:
            tool_events.append(
                SavedReportToolEvent(
                    tool_name="saved_report_lookup_fallback",
                    input_summary=f"Fallback lookup saved report evidence for run_id={record.run_id}.",
                    output_summary=f"intent={evidence.intent}, facts={len(evidence.facts)}",
                    duration_ms=duration_ms,
                    metadata={
                        "intent": evidence.intent,
                        "evidence_items": len(evidence.facts),
                        "fallback": True,
                    },
                )
            )
            response = self.formatter.format(evidence, record)
            analysis = f"{reason} Fallback formatted lookup evidence for intent '{evidence.intent}'."
        return SavedReportToolAgentResult(
            response=response,
            analysis=analysis,
            used_tools=tool_events,
            used_llm=False,
        )


def _system_prompt() -> str:
    return (
        "You are the report Q&A agent in a data profiling platform. "
        "You must call the most specific saved-report evidence tool before answering. "
        "Use get_schema for schema/columns/types, get_nulls for missing values, "
        "get_categorical_columns for category column lists, get_distribution for top values, "
        "get_findings for quality findings, get_pii for sensitive data, "
        "get_correlations for relationships, get_cardinality for distinct counts, "
        "get_report_overview for row/column/quality summaries, and get_full_report for broad summary questions. "
        "Use only facts returned by tools. Do not invent values, columns, metrics, or findings. "
        "If a tool returns status not_found or an empty facts list, say the saved report does not contain evidence. "
        "Reply in the same language as the user when possible. Keep answers concise and readable."
    )
