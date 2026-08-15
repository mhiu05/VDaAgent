"""Tool-calling agent layer for profiling plan generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import json
from time import perf_counter
from uuid import uuid4

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool

from src.agents.pii import mask_text
from src.agents.planning import planning_store
from src.models.schemas import (
    DatabasePlanGenerateRequest,
    DatabasePlanRecommendation,
    DatabasePlanTableRecommendation,
    ProfilingPlan,
    ProfilingPlanGenerateRequest,
    ProfilingPlanItem,
)
from src.services.llm import get_llm


@dataclass
class PlanningToolEvent:
    tool_name: str
    input_summary: str
    output_summary: str
    duration_ms: int
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass
class ProfilingPlanAgentResult:
    plan: ProfilingPlan
    analysis: str
    used_tools: list[PlanningToolEvent] = field(default_factory=list)
    used_llm: bool = True


@dataclass
class DatabasePlanAgentResult:
    recommendation: DatabasePlanRecommendation
    analysis: str
    used_tools: list[PlanningToolEvent] = field(default_factory=list)
    used_llm: bool = True


class ProfilingPlanToolCallingAgent:
    """Generate profiling plans through LLM-selected tools with safe fallback."""

    async def generate_plan(
        self,
        request: ProfilingPlanGenerateRequest,
        *,
        llm=None,
    ) -> ProfilingPlanAgentResult:
        tool_events: list[PlanningToolEvent] = []

        @tool
        def search_requirement_documents(query: str, limit: int = 5) -> str:
            """Search uploaded requirement or policy documents for plan evidence."""

            started = perf_counter()
            results = planning_store.search_documents(request.user_id, query=query, limit=limit)
            payload = [result.model_dump(mode="json") for result in results]
            tool_events.append(
                PlanningToolEvent(
                    tool_name="search_requirement_documents",
                    input_summary=f"Search {len(request.document_ids)} document id(s).",
                    output_summary=f"{len(results)} matching excerpt(s).",
                    duration_ms=int((perf_counter() - started) * 1000),
                    metadata={"matches": len(results)},
                )
            )
            return json.dumps(payload, ensure_ascii=False)

        @tool
        def create_profiling_plan(
            selected_sections: list[str],
            items: list[dict],
            clarification_questions: list[str],
        ) -> str:
            """Persist a structured profiling plan selected by the agent."""

            started = perf_counter()
            allowed_sections = {"schema", "columns", "findings", "quality_summary", "correlations"}
            sections = [
                section
                for section in selected_sections
                if section in allowed_sections
            ] or request.selected_sections or ["schema", "columns", "findings"]
            plan_items = []
            for index, item in enumerate(items[:12]):
                item_id = str(item.get("id") or f"agent_item_{index + 1}")
                label = str(item.get("label") or "Review profiling requirement").strip()
                reason = str(item.get("reason") or "Selected by the planning agent.").strip()
                section = item.get("section")
                if section not in allowed_sections:
                    section = None
                plan_items.append(
                    ProfilingPlanItem(
                        id=item_id,
                        label=label[:200],
                        reason=reason[:1000],
                        section=section,
                        requires_confirmation=bool(item.get("requires_confirmation", False)),
                    )
                )
            if not plan_items:
                fallback = planning_store.generate_plan(request)
                tool_events.append(
                    PlanningToolEvent(
                        tool_name="create_profiling_plan",
                        input_summary="Agent requested empty plan.",
                        output_summary=f"fallback_plan_id={fallback.id}",
                        duration_ms=int((perf_counter() - started) * 1000),
                        metadata={"fallback": True},
                    )
                )
                return fallback.model_dump_json()

            now = datetime.now(UTC).isoformat()
            plan = ProfilingPlan(
                id=f"plan_{uuid4().hex}",
                user_id=request.user_id,
                source_name=request.source_name,
                selected_sections=sorted(set(sections)),
                custom_requirements=mask_text(request.custom_requirements),
                items=plan_items,
                clarification_questions=list(dict.fromkeys(
                    str(question).strip()
                    for question in clarification_questions[:8]
                    if str(question).strip()
                )),
                confirmed=False,
                created_at=now,
                updated_at=now,
            )
            saved = planning_store.repository.save_profiling_plan(plan)
            tool_events.append(
                PlanningToolEvent(
                    tool_name="create_profiling_plan",
                    input_summary="Persist agent-generated profiling plan.",
                    output_summary=f"plan_id={saved.id}, items={len(saved.items)}",
                    duration_ms=int((perf_counter() - started) * 1000),
                    metadata={"plan_id": saved.id, "items": len(saved.items)},
                )
            )
            return saved.model_dump_json()

        try:
            model = llm or get_llm()
            tool_bound_model = model.bind_tools([search_requirement_documents, create_profiling_plan])
            result = await _run_tool_loop(
                tool_bound_model,
                [
                    SystemMessage(content=_profiling_plan_system_prompt()),
                    HumanMessage(content=_profiling_plan_user_prompt(request)),
                ],
                {
                    "search_requirement_documents": search_requirement_documents,
                    "create_profiling_plan": create_profiling_plan,
                },
            )
        except Exception as exc:
            return self._fallback_generate_plan(request, tool_events, type(exc).__name__)

        plan_payload = _last_tool_json(result, "create_profiling_plan")
        if not plan_payload:
            return self._fallback_generate_plan(request, tool_events, "missing_create_profiling_plan_call")
        try:
            plan = ProfilingPlan.model_validate_json(plan_payload)
        except Exception as exc:
            return self._fallback_generate_plan(request, tool_events, type(exc).__name__)
        return ProfilingPlanAgentResult(
            plan=plan,
            analysis=f"LLM generated profiling plan using {len(tool_events)} tool call(s).",
            used_tools=tool_events,
        )

    async def recommend_database_plan(
        self,
        request: DatabasePlanGenerateRequest,
        *,
        llm=None,
    ) -> DatabasePlanAgentResult:
        tool_events: list[PlanningToolEvent] = []

        @tool
        def search_requirement_documents(query: str, limit: int = 5) -> str:
            """Search uploaded requirement or policy documents for table selection evidence."""

            started = perf_counter()
            results = planning_store.search_documents(request.user_id, query=query, limit=limit)
            payload = [result.model_dump(mode="json") for result in results]
            tool_events.append(
                PlanningToolEvent(
                    tool_name="search_requirement_documents",
                    input_summary=f"Search {len(request.document_ids)} document id(s).",
                    output_summary=f"{len(results)} matching excerpt(s).",
                    duration_ms=int((perf_counter() - started) * 1000),
                    metadata={"matches": len(results)},
                )
            )
            return json.dumps(payload, ensure_ascii=False)

        @tool
        def create_database_plan(
            recommended_tables: list[dict],
            questions: list[str],
            evidence: list[str],
        ) -> str:
            """Return database table recommendations selected by the agent."""

            started = perf_counter()
            available = {
                (table.schema_name, table.table): table
                for table in request.tables
            }
            recommendations = []
            for index, item in enumerate(recommended_tables[:request.max_tables]):
                schema_name = str(item.get("schema_name") or item.get("schema") or "")
                table_name = str(item.get("table_name") or item.get("table") or "")
                if (schema_name, table_name) not in available:
                    continue
                matched_terms = [str(term) for term in item.get("matched_terms", [])[:12]]
                recommendations.append(
                    DatabasePlanTableRecommendation(
                        schema_name=schema_name,
                        table_name=table_name,
                        score=float(item.get("score") or max(request.max_tables - index, 1)),
                        reason=str(item.get("reason") or "Selected by the planning agent.")[:1000],
                        matched_terms=matched_terms,
                    )
                )
            if not recommendations:
                fallback = planning_store.recommend_database_plan(request)
                tool_events.append(
                    PlanningToolEvent(
                        tool_name="create_database_plan",
                        input_summary="Agent requested no valid database tables.",
                        output_summary=f"fallback_tables={len(fallback.recommended_tables)}",
                        duration_ms=int((perf_counter() - started) * 1000),
                        metadata={"fallback": True},
                    )
                )
                return fallback.model_dump_json()
            recommendation = DatabasePlanRecommendation(
                recommended_tables=recommendations,
                questions=[
                    str(question).strip()
                    for question in questions[:8]
                    if str(question).strip()
                ],
                evidence=[
                    str(item).strip()
                    for item in evidence[:8]
                    if str(item).strip()
                ],
            )
            tool_events.append(
                PlanningToolEvent(
                    tool_name="create_database_plan",
                    input_summary="Create agent-selected database table recommendation.",
                    output_summary=f"recommended_tables={len(recommendations)}",
                    duration_ms=int((perf_counter() - started) * 1000),
                    metadata={"recommended_tables": len(recommendations)},
                )
            )
            return recommendation.model_dump_json()

        try:
            model = llm or get_llm()
            tool_bound_model = model.bind_tools([search_requirement_documents, create_database_plan])
            result = await _run_tool_loop(
                tool_bound_model,
                [
                    SystemMessage(content=_database_plan_system_prompt()),
                    HumanMessage(content=_database_plan_user_prompt(request)),
                ],
                {
                    "search_requirement_documents": search_requirement_documents,
                    "create_database_plan": create_database_plan,
                },
            )
        except Exception as exc:
            return self._fallback_database_plan(request, tool_events, type(exc).__name__)

        plan_payload = _last_tool_json(result, "create_database_plan")
        if not plan_payload:
            return self._fallback_database_plan(request, tool_events, "missing_create_database_plan_call")
        try:
            recommendation = DatabasePlanRecommendation.model_validate_json(plan_payload)
        except Exception as exc:
            return self._fallback_database_plan(request, tool_events, type(exc).__name__)
        return DatabasePlanAgentResult(
            recommendation=recommendation,
            analysis=f"LLM generated database plan using {len(tool_events)} tool call(s).",
            used_tools=tool_events,
        )

    def _fallback_generate_plan(
        self,
        request: ProfilingPlanGenerateRequest,
        tool_events: list[PlanningToolEvent],
        reason: str,
    ) -> ProfilingPlanAgentResult:
        started = perf_counter()
        plan = planning_store.generate_plan(request)
        tool_events.append(
            PlanningToolEvent(
                tool_name="fallback_generate_profiling_plan",
                input_summary="Generate deterministic profiling plan.",
                output_summary=f"plan_id={plan.id}, items={len(plan.items)}",
                duration_ms=int((perf_counter() - started) * 1000),
                metadata={"fallback": True, "reason": reason},
            )
        )
        return ProfilingPlanAgentResult(
            plan=plan,
            analysis=f"Planning agent fallback used because {reason}.",
            used_tools=tool_events,
            used_llm=False,
        )

    def _fallback_database_plan(
        self,
        request: DatabasePlanGenerateRequest,
        tool_events: list[PlanningToolEvent],
        reason: str,
    ) -> DatabasePlanAgentResult:
        started = perf_counter()
        recommendation = planning_store.recommend_database_plan(request)
        tool_events.append(
            PlanningToolEvent(
                tool_name="fallback_recommend_database_plan",
                input_summary="Generate deterministic database table recommendation.",
                output_summary=f"recommended_tables={len(recommendation.recommended_tables)}",
                duration_ms=int((perf_counter() - started) * 1000),
                metadata={"fallback": True, "reason": reason},
            )
        )
        return DatabasePlanAgentResult(
            recommendation=recommendation,
            analysis=f"Database planning agent fallback used because {reason}.",
            used_tools=tool_events,
            used_llm=False,
        )


async def _run_tool_loop(model, messages: list, tools: dict[str, object]):
    tool_outputs: list[tuple[str, str]] = []
    for _ in range(4):
        response = await model.ainvoke(messages)
        messages.append(response)
        tool_calls = getattr(response, "tool_calls", None) or []
        if not tool_calls:
            break
        for tool_call in tool_calls:
            tool_name = tool_call.get("name")
            selected_tool = tools.get(tool_name)
            if selected_tool is None:
                continue
            content = selected_tool.invoke(tool_call.get("args") or {})
            tool_outputs.append((tool_name, content))
            messages.append(
                ToolMessage(
                    content=content,
                    tool_call_id=tool_call.get("id", tool_name),
                )
            )
    return {"messages": messages, "tool_outputs": tool_outputs}


def _last_tool_json(result: dict, tool_name: str) -> str | None:
    for name, content in reversed(result.get("tool_outputs", [])):
        if name == tool_name:
            return content
    return None


def _profiling_plan_system_prompt() -> str:
    return (
        "You are a data profiling planning agent. Use tools to inspect requirement documents "
        "and create a structured profiling plan. Do not invent unavailable columns. "
        "If requirements are ambiguous, add concise clarification questions. "
        "Always call create_profiling_plan as the final tool."
    )


def _profiling_plan_user_prompt(request: ProfilingPlanGenerateRequest) -> str:
    return json.dumps(
        {
            "source_name": request.source_name,
            "columns": request.columns,
            "selected_sections": request.selected_sections,
            "custom_requirements": request.custom_requirements,
            "document_ids": request.document_ids,
            "instructions": (
                "Search documents when document_ids are present. Choose report sections and plan items "
                "from the requirements, selected columns, and requested output sections."
            ),
        },
        ensure_ascii=False,
    )


def _database_plan_system_prompt() -> str:
    return (
        "You are a database profiling planning agent. Use tools to inspect requirement documents "
        "and choose only tables from the provided available table list. "
        "Always call create_database_plan as the final tool."
    )


def _database_plan_user_prompt(request: DatabasePlanGenerateRequest) -> str:
    return json.dumps(
        {
            "available_tables": [
                {"schema_name": table.schema_name, "table_name": table.table}
                for table in request.tables
            ],
            "custom_requirements": request.custom_requirements,
            "document_ids": request.document_ids,
            "max_tables": request.max_tables,
            "instructions": (
                "Search documents when document_ids are present. Recommend only available tables, "
                "include evidence, and ask clarification questions if selection is uncertain."
            ),
        },
        ensure_ascii=False,
    )
