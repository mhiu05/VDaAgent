import pytest
from langchain_core.messages import AIMessage

from src.agents.planning_agent import ProfilingPlanToolCallingAgent
from src.models.schemas import (
    DatabasePlanGenerateRequest,
    DatabaseTableInfo,
    ProfilingPlanGenerateRequest,
)


@pytest.mark.asyncio
async def test_planning_agent_creates_profile_plan_with_tool_call():
    request = ProfilingPlanGenerateRequest(
        user_id="planner-test",
        source_name="sales.csv",
        columns=["order_id", "customer_email", "amount"],
        selected_sections=["schema", "columns"],
        custom_requirements="mask pii and check nulls",
    )

    result = await ProfilingPlanToolCallingAgent().generate_plan(
        request,
        llm=_PlanningFakeLlm("profile"),
    )

    assert result.used_llm is True
    assert result.plan.source_name == "sales.csv"
    assert result.plan.items[0].id == "pii"
    assert result.plan.items[0].requires_confirmation is True
    assert any(event.tool_name == "create_profiling_plan" for event in result.used_tools)


@pytest.mark.asyncio
async def test_planning_agent_recommends_database_tables_with_tool_call():
    request = DatabasePlanGenerateRequest(
        user_id="planner-test",
        tables=[
            DatabaseTableInfo(schema="public", table="orders"),
            DatabaseTableInfo(schema="public", table="audit_log"),
        ],
        custom_requirements="profile sales orders",
        max_tables=2,
    )

    result = await ProfilingPlanToolCallingAgent().recommend_database_plan(
        request,
        llm=_PlanningFakeLlm("database"),
    )

    assert result.used_llm is True
    assert result.recommendation.recommended_tables[0].table_name == "orders"
    assert any(event.tool_name == "create_database_plan" for event in result.used_tools)


@pytest.mark.asyncio
async def test_planning_agent_falls_back_when_llm_fails():
    request = ProfilingPlanGenerateRequest(
        user_id="planner-test",
        source_name="sales.csv",
        columns=["customer_email"],
        custom_requirements="mask pii",
    )

    result = await ProfilingPlanToolCallingAgent().generate_plan(
        request,
        llm=_FailingFakeLlm(),
    )

    assert result.used_llm is False
    assert result.used_tools[0].metadata["fallback"] is True
    assert result.plan.items


class _PlanningFakeLlm:
    def __init__(self, mode):
        self.mode = mode
        self.calls = 0

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        self.calls += 1
        if self.calls > 1:
            return AIMessage(content="done")
        if self.mode == "profile":
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "create_profiling_plan",
                        "args": {
                            "selected_sections": ["schema", "columns", "findings"],
                            "items": [
                                {
                                    "id": "pii",
                                    "label": "Detect and mask PII candidates",
                                    "reason": "Requirement asks to mask PII.",
                                    "section": "findings",
                                    "requires_confirmation": True,
                                }
                            ],
                            "clarification_questions": [
                                "Which PII columns may appear unmasked in the report?"
                            ],
                        },
                        "id": "call_create_plan",
                    }
                ],
            )
        return AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "create_database_plan",
                    "args": {
                        "recommended_tables": [
                            {
                                "schema_name": "public",
                                "table_name": "orders",
                                "score": 3,
                                "reason": "Orders matches sales requirement.",
                                "matched_terms": ["orders", "sales"],
                            }
                        ],
                        "questions": ["Confirm orders is the correct business table."],
                        "evidence": ["Requirement mentions sales orders."],
                    },
                    "id": "call_create_database_plan",
                }
            ],
        )


class _FailingFakeLlm:
    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        raise RuntimeError("model unavailable")
