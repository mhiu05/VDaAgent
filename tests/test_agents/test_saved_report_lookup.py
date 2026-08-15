from datetime import UTC, datetime

import pytest
from langchain_core.messages import AIMessage

from src.agents.report_chat_agent import SavedReportToolCallingAgent
from src.agents.saved_report_lookup import SavedReportAnswerFormatter, SavedReportLookupService
from src.models.schemas import (
    ColumnProfile,
    DatasetSummary,
    ProfileMetadata,
    ProfileRelationships,
    ProfileReportRecord,
    ProfileResult,
    ProfileSource,
    QualitySummary,
    TopValue,
)


def test_saved_report_lookup_lists_categorical_columns_without_distribution():
    record = _saved_report_record()

    evidence = SavedReportLookupService().lookup("co cot nao la category", record)
    response = SavedReportAnswerFormatter().format(evidence, record)

    assert evidence.intent == "categorical_columns"
    assert "product_category" in response
    assert "value=Electronics" not in response


def test_saved_report_lookup_returns_distribution_only_when_requested():
    record = _saved_report_record()

    evidence = SavedReportLookupService().lookup("phan bo cua cac cot category", record)
    response = SavedReportAnswerFormatter().format(evidence, record)

    assert evidence.intent == "categorical_distributions"
    assert "value=Electronics, count=1,200, ratio=24.0%" in response


@pytest.mark.asyncio
async def test_saved_report_tool_calling_agent_invokes_lookup_tool():
    record = _saved_report_record()
    llm = _ToolCallingFakeLlm()

    result = await SavedReportToolCallingAgent().answer(
        "co cot nao la category",
        record,
        llm=llm,
    )

    assert result.used_llm is True
    assert result.used_tools
    assert result.used_tools[0].tool_name == "get_categorical_columns"
    assert result.used_tools[0].metadata["intent"] == "categorical_columns"
    assert "product_category" in result.response


@pytest.mark.asyncio
async def test_saved_report_tool_calling_agent_falls_back_when_llm_fails():
    record = _saved_report_record()

    result = await SavedReportToolCallingAgent().answer(
        "co cot nao la category",
        record,
        llm=_FailingFakeLlm(),
    )

    assert result.used_llm is False
    assert result.used_tools
    assert result.used_tools[0].metadata["fallback"] is True
    assert "product_category" in result.response


class _ToolCallingFakeLlm:
    def bind_tools(self, tools):
        self.tools = tools
        return self

    async def ainvoke(self, messages):
        if not any(message.type == "tool" for message in messages):
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "get_categorical_columns",
                        "args": {},
                        "id": "call_saved_report_lookup",
                    }
                ],
            )
        tool_message = next(message for message in messages if message.type == "tool")
        return AIMessage(content=f"Tool evidence used: {tool_message.content}")


class _FailingFakeLlm:
    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        raise RuntimeError("model unavailable")


def _saved_report_record() -> ProfileReportRecord:
    now = datetime.now(UTC).isoformat()
    report = ProfileResult(
        profile_metadata=ProfileMetadata(generated_at=now),
        source=ProfileSource(name="demo.csv", type="file"),
        dataset_summary=DatasetSummary(row_count=5000, column_count=2),
        columns=[
            ColumnProfile(
                name="product_category",
                data_type="VARCHAR",
                null_count=0,
                distinct_count=4,
                null_ratio=0,
                distinct_ratio=0.0008,
                top_values=[
                    TopValue(value="Electronics", count=1200),
                    TopValue(value="Home", count=900),
                ],
            ),
            ColumnProfile(
                name="amount",
                data_type="DOUBLE",
                null_count=0,
                distinct_count=3000,
                null_ratio=0,
                distinct_ratio=0.6,
            ),
        ],
        relationships=ProfileRelationships(),
        findings=[],
        quality_summary=QualitySummary(),
    )
    return ProfileReportRecord(
        run_id="run_demo",
        user_id="anonymous",
        source_name="demo.csv",
        source_type="file",
        row_count=5000,
        column_count=2,
        warning_count=0,
        critical_count=0,
        created_at=now,
        report=report,
    )
