"""Focused regression tests for P1-05B AI latency optimizations."""

from __future__ import annotations

import time
from types import SimpleNamespace
from typing import Any

import pytest
from src.agents.nodes import qa_nodes
from src.services import ai_latency
from src.services.chart_planner import can_plan_deterministically


class _Audit:
    def log(self, *_args: Any, **_kwargs: Any) -> None:
        return None


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        retrieval_profile_top_k=1,
        retrieval_knowledge_top_k=1,
        retrieval_candidate_k=2,
        retrieval_external_knowledge_enabled=True,
        retrieval_max_chunks_per_source=1,
        guardrails_max_context_chars=2_000,
        retrieval_profile_context_chars=1_000,
        retrieval_knowledge_context_chars=1_000,
        guardrails_max_output_chars=12_000,
        guardrails_max_tool_calls_per_request=10,
        llm_max_tool_rounds=6,
        guardrails_audit_question_content=False,
    )


def test_verified_candidate_key_evidence_skips_final_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class BoundLLM:
        def invoke(self, _messages: list[Any]) -> Any:
            raise AssertionError("Verified deterministic evidence must not invoke a model.")

    class BaseLLM:
        def bind_tools(self, _tools: list[Any]) -> BoundLLM:
            return BoundLLM()

    calls: list[str] = []

    def run_tool(name: str, _args: dict[str, Any], profile_run_id: str | None = None) -> dict[str, Any]:
        calls.append(name)
        if name == "get_candidate_keys":
            data = {"candidate_key": [{"columns": ["order_id"], "confidence": 1.0}]}
            artifact = "candidate_key_proposals"
        else:
            data = {"column_name": "order_id", "null_pct": 0, "uniqueness_ratio": 1.0}
            artifact = "column_stats"
        return {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": data,
            "evidence": [{"artifact": artifact}],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(qa_nodes, "get_settings", _settings)
    monkeypatch.setattr(qa_nodes, "get_llm", lambda: BaseLLM())
    monkeypatch.setattr(qa_nodes, "run_tool", run_tool)
    monkeypatch.setattr(qa_nodes, "get_audit", lambda: _Audit())

    result = qa_nodes.qa_structured_node(
        {
            "question": "Is order_id a candidate key?",
            "profile_run_id": "run-1",
            "workspace_id": "workspace-1",
            "qa_context": {"mentioned_columns": ["order_id"]},
            "tool_calls": 0,
        }
    )

    assert calls == ["get_candidate_keys", "get_column_profile"]
    assert result["evidence_status"] == "verified"
    assert result["tool_calls"] == 2
    assert "candidate key" in result["answer"].casefold()
    assert [source["citation_id"] for source in result["answer_sources"]] == ["S1", "S2"]


def test_independent_retrieval_searches_overlap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Index:
        def __init__(self) -> None:
            self.calls: list[str] = []

        def search(self, _query: str, *, where: dict[str, Any], **_kwargs: Any) -> list[Any]:
            self.calls.append(str(where["knowledge_type"]))
            time.sleep(0.06)
            metadata = {"knowledge_type": where["knowledge_type"], "title": "Synthetic"}
            if where["knowledge_type"] == "profile_report":
                metadata["profile_run_id"] = "run-1"
            else:
                metadata.update({"source_id": "synthetic", "canonical_url": "https://example.test"})
            return [
                SimpleNamespace(
                    doc_id=str(where["knowledge_type"]),
                    text="Bounded evidence.",
                    metadata=metadata,
                    score=1.0,
                    source="synthetic",
                )
            ]

    class LLM:
        def invoke(self, _messages: list[Any]) -> Any:
            return SimpleNamespace(content="Grounded summary. [S1]", tool_calls=[])

    index = Index()
    monkeypatch.setattr(qa_nodes, "get_settings", _settings)
    monkeypatch.setattr(qa_nodes, "get_index", lambda: index)
    monkeypatch.setattr(qa_nodes, "get_llm", lambda: LLM())
    monkeypatch.setattr(qa_nodes, "get_audit", lambda: _Audit())

    started = time.perf_counter()
    result = qa_nodes.qa_vector_node(
        {
            "question": "Summarize the quality profile.",
            "profile_run_id": "run-1",
            "workspace_id": "workspace-1",
            "qa_context": {},
            "tool_calls": 0,
        }
    )
    elapsed = time.perf_counter() - started

    assert sorted(index.calls) == ["external_knowledge", "profile_report"]
    assert elapsed < 0.11  # Serial 60 ms searches plus model/prompt work exceeds this.
    assert result["evidence_status"] == "verified"


@pytest.mark.parametrize(
    "question",
    [
        "Doanh số theo tháng như thế nào?",
        "Mối quan hệ giữa sales và cost là gì?",
        "Dự báo sales cho 6 tháng tới.",
        "Vẽ doanh số theo email.",
    ],
)
def test_explicit_safe_chart_intents_bypass_semantic_planner(question: str) -> None:
    context = {
        "dimensions": ["order_date", "region", "email"],
        "measures": ["sales", "cost"],
        "time_column": "order_date",
        "ignored_columns": ["email"],
    }
    stats = {
        "order_date": {"dtype": "date"},
        "region": {"dtype": "string"},
        "email": {"dtype": "string", "pii_masked": True},
        "sales": {"dtype": "float"},
        "cost": {"dtype": "float"},
    }

    assert can_plan_deterministically(question, context, stats) is True


def test_ambiguous_chart_request_retains_semantic_planner() -> None:
    assert not can_plan_deterministically(
        "Hãy tìm insight kinh doanh quan trọng nhất.",
        {"dimensions": ["region"], "measures": ["sales"]},
        {"region": {"dtype": "string"}, "sales": {"dtype": "float"}},
    )


def test_chat_latency_snapshot_has_user_journey_metrics_without_sensitive_content() -> None:
    token = ai_latency.begin("qa_stream")
    try:
        ai_latency.mark_first_status()
        ai_latency.record_tool(4.0)
        ai_latency.mark_first_evidence()
        ai_latency.mark_first_validated_output()
        ai_latency.set_dimensions(
            execution_path="deterministic_profile",
            intent="row_count",
            model="test-model",
            cache_status="not_applicable",
        )
        ai_latency.set_outcome("success")
        snapshot = ai_latency.emit()
    finally:
        ai_latency.reset(token)

    assert snapshot is not None
    assert snapshot["ttfs_ms"] is not None
    assert snapshot["ttfe_ms"] is not None
    assert snapshot["ttfva_ms"] is not None
    assert snapshot["e2e_ms"] >= snapshot["ttfs_ms"]
    assert snapshot["execution_path"] == "deterministic_profile"
    assert snapshot["tool_calls"] == 1
    serialized = str(snapshot).casefold()
    assert "prompt" not in serialized
    assert "raw_row" not in serialized


def test_latency_snapshot_records_budget_exhaustion_and_parallel_branch_policy() -> None:
    token = ai_latency.begin("qa_stream")
    try:
        ai_latency.set_budget("deterministic", 5.0)
        ai_latency.record_parallel_branch("profile_retrieval", 8.0, required=True, outcome="completed")
        ai_latency.record_parallel_branch("external_retrieval", 5.0, required=False, outcome="timeout")
        ai_latency.mark_budget_exceeded(stage="retrieval", fallback="timeout")
        snapshot = ai_latency.emit()
    finally:
        ai_latency.reset(token)

    assert snapshot is not None
    assert snapshot["budget_category"] == "deterministic"
    assert snapshot["budget_configured_ms"] == 5_000.0
    assert snapshot["budget_exceeded"] is True
    assert snapshot["timeout_stage"] == "retrieval"
    assert snapshot["fallback_selected"] == "timeout"
    assert snapshot["parallel_branches"] == [
        {"branch": "profile_retrieval", "duration_ms": 8.0, "required": True, "outcome": "completed"},
        {"branch": "external_retrieval", "duration_ms": 5.0, "required": False, "outcome": "timeout"},
    ]
