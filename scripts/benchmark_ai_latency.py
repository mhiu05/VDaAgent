"""Reproducible local control-flow benchmark for chat-agent improvements.

The benchmark deliberately uses fixed-delay local adapters. It measures the
application's own critical path (call count and serial versus concurrent work)
without sending a question, prompt, evidence, or credentials to a provider.
It is not a substitute for a staging synthetic-API benchmark.

Run from the repository root:
    .\\.venv\\Scripts\\python.exe scripts/benchmark_ai_latency.py --repeats 15
"""

from __future__ import annotations

import argparse
import asyncio
from contextlib import ExitStack
import json
import math
import sys
import time
from pathlib import Path
from statistics import median
from types import SimpleNamespace
from typing import Any, Callable
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from src.agents.nodes import qa_nodes  # noqa: E402
from src.agents import fast_paths  # noqa: E402
from src.api import analysis_routes  # noqa: E402
from src.services.chart_planner import ChartPlanCandidate  # noqa: E402
from src.services import ai_latency  # noqa: E402
from src.services.qa_validation import validate_answer_evidence  # noqa: E402

_TOOL_DELAY_SECONDS = 0.012
_RETRIEVAL_DELAY_SECONDS = 0.03
_MODEL_DELAY_SECONDS = 0.035


class _Audit:
    def log(self, *_args: Any, **_kwargs: Any) -> None:
        return None


class _Response:
    def __init__(self, content: str) -> None:
        self.content = content
        self.tool_calls: list[dict[str, Any]] = []
        self.usage_metadata = {"input_tokens": 80, "output_tokens": 20}


class _BoundLLM:
    def __init__(self, content: str) -> None:
        self.content = content

    def invoke(self, _messages: list[Any]) -> _Response:
        time.sleep(_MODEL_DELAY_SECONDS)
        return _Response(self.content)


class _BaseLLM(_BoundLLM):
    def bind_tools(self, _tools: list[Any]) -> _BoundLLM:
        return _BoundLLM(self.content)


class _Index:
    def search(self, _query: str, *, where: dict[str, Any], **_kwargs: Any) -> list[Any]:
        time.sleep(_RETRIEVAL_DELAY_SECONDS)
        knowledge_type = str(where["knowledge_type"])
        metadata: dict[str, Any] = {
            "knowledge_type": knowledge_type,
            "title": "Synthetic evidence",
        }
        if knowledge_type == "profile_report":
            metadata["profile_run_id"] = "run-1"
        else:
            metadata.update({"source_id": "synthetic", "canonical_url": "https://example.test"})
        return [
            SimpleNamespace(
                doc_id=f"synthetic:{knowledge_type}",
                text="Synthetic bounded evidence.",
                metadata=metadata,
                score=1.0,
                source="synthetic",
            )
        ]


class _CompletedFuture:
    def __init__(self, value: list[Any]) -> None:
        self.value = value

    def result(self) -> list[Any]:
        return self.value


class _SerialExecutor:
    """Benchmark-only stand-in for the P1-05A sequential retrieval path."""

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    def __enter__(self) -> _SerialExecutor:
        return self

    def __exit__(self, *_args: Any) -> None:
        return None

    def submit(self, call: Callable[[], list[Any]]) -> _CompletedFuture:
        return _CompletedFuture(call())


class _Planner:
    def invoke(self, _messages: list[Any]) -> ChartPlanCandidate:
        time.sleep(_MODEL_DELAY_SECONDS)
        return ChartPlanCandidate(
            problem="trend",
            algorithm="sum",
            x_column="order_date",
            y_column="sales",
            time_grain="month",
            title="Monthly sales",
            rationale="Synthetic explicit trend request.",
        )


class _PlannerLLM:
    def with_structured_output(self, _schema: type[ChartPlanCandidate]) -> _Planner:
        return _Planner()


class _ChartRepository:
    def get_column_stats(self, _run_id: str) -> dict[str, dict[str, Any]]:
        return {
            "order_date": {"dtype": "date"},
            "region": {"dtype": "string", "cardinality": 4},
            "email": {"dtype": "string", "pii_masked": True},
            "sales": {"dtype": "float"},
            "cost": {"dtype": "float"},
        }

    def confirmed_pii_columns(self, _run_id: str) -> set[str]:
        return {"email"}


class _RateLimiter:
    def check(self, _user_id: str) -> None:
        return None


_SETTINGS = SimpleNamespace(
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


def _tool(name: str, _args: dict[str, Any], profile_run_id: str | None = None) -> dict[str, Any]:
    time.sleep(_TOOL_DELAY_SECONDS)
    ai_latency.record_tool(_TOOL_DELAY_SECONDS * 1000)
    if name == "get_candidate_keys":
        data = {"candidate_key": [{"columns": ["order_id"], "confidence": 1.0}]}
        artifact = "candidate_key_proposals"
    elif name == "get_column_profile":
        data = {"column_name": "order_id", "null_pct": 0, "uniqueness_ratio": 1.0}
        artifact = "column_stats"
    elif name == "get_profile_overview":
        data = {"row_count": 1_250, "column_count": 8}
        artifact = "profile_runs"
    else:
        data = {"issues": [{"column_name": "sales", "issue_type": "high_missingness"}]}
        artifact = "column_stats"
    return {
        "tool": name,
        "profile_run_id": profile_run_id,
        "data": data,
        "evidence": [{"artifact": artifact}],
        "is_approximate": False,
        "limitations": [],
    }


def _capture(operation: str, call: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    token = ai_latency.begin(operation)
    try:
        result = call()
        if result.get("evidence_status") != "verified":
            raise RuntimeError("Synthetic benchmark scenario lost verified evidence.")
        values = ai_latency.emit()
        if values is None:
            raise RuntimeError("AI latency context was not active.")
        return values
    finally:
        ai_latency.reset(token)


def _candidate_key(mode: str) -> dict[str, Any]:
    with ExitStack() as stack:
        stack.enter_context(patch.object(qa_nodes, "get_settings", lambda: _SETTINGS))
        stack.enter_context(
            patch.object(
                qa_nodes, "get_llm", lambda: _BaseLLM("Candidate key evidence. [S1]")
            )
        )
        stack.enter_context(patch.object(qa_nodes, "run_tool", _tool))
        stack.enter_context(patch.object(qa_nodes, "get_audit", lambda: _Audit()))
        if mode == "before":
            stack.enter_context(
                patch.object(qa_nodes, "_deterministic_evidence_answer", lambda *_args: None)
            )
        return _capture(
            "qa_candidate_key",
            lambda: qa_nodes.qa_structured_node(
                {
                    "question": "Is order_id a candidate key?",
                    "profile_run_id": "run-1",
                    "workspace_id": "workspace-1",
                    "qa_context": {"mentioned_columns": ["order_id"]},
                    "tool_calls": 0,
                }
            ),
        )


def _quality_issue(mode: str) -> dict[str, Any]:
    with ExitStack() as stack:
        stack.enter_context(patch.object(qa_nodes, "get_settings", lambda: _SETTINGS))
        stack.enter_context(
            patch.object(
                qa_nodes, "get_llm", lambda: _BaseLLM("Quality issue evidence. [S1]")
            )
        )
        stack.enter_context(patch.object(qa_nodes, "run_tool", _tool))
        stack.enter_context(patch.object(qa_nodes, "get_audit", lambda: _Audit()))
        if mode == "before":
            stack.enter_context(
                patch.object(qa_nodes, "_deterministic_evidence_answer", lambda *_args: None)
            )
        return _capture(
            "qa_quality_issue",
            lambda: qa_nodes.qa_structured_node(
                {
                    "question": "What quality issues are present?",
                    "profile_run_id": "run-1",
                    "workspace_id": "workspace-1",
                    "qa_context": {},
                    "tool_calls": 0,
                }
            ),
        )


def _profile_fast_path(mode: str) -> dict[str, Any]:
    """Compare the former tool-plus-model wording path to P0's direct renderer."""

    question = "How many rows are in this dataset?"
    with ExitStack() as stack:
        stack.enter_context(patch.object(fast_paths, "run_tool", _tool))
        if mode == "before":
            def legacy() -> dict[str, Any]:
                tool_result = _tool("get_profile_overview", {}, "run-1")
                started = time.perf_counter()
                answer = _BaseLLM("The Profile Run contains 1,250 rows. [S1]").invoke([]).content
                ai_latency.record_model(
                    "qa_structured",
                    (time.perf_counter() - started) * 1000,
                    input_tokens=80,
                    output_tokens=20,
                )
                sources = [{
                    "type": "tool", "citation_id": "S1", "tool": "get_profile_overview",
                    "args": {}, "status": "ok", "profile_run_id": "run-1", "workspace_id": "workspace-1",
                }]
                validation = validate_answer_evidence(
                    question=question, profile_run_id="run-1", workspace_id="workspace-1",
                    sources=sources, tool_results=[{**tool_result, "workspace_id": "workspace-1"}], answer=answer,
                )
                return {"evidence_status": validation.evidence_status}

            return _capture("qa_profile_fast_path", legacy)

        def fast() -> dict[str, Any]:
            result = fast_paths.execute_fast_path(
                question=question, profile_run_id="run-1", workspace_id="workspace-1"
            )
            if result is None:
                raise RuntimeError("Synthetic fast-path scenario was not recognized.")
            validation = validate_answer_evidence(
                question=question, profile_run_id="run-1", workspace_id="workspace-1",
                sources=result["sources"], tool_results=result["tool_results"], answer=result["answer"],
            )
            return {"evidence_status": validation.evidence_status}

        return _capture("qa_profile_fast_path", fast)


def _qualitative_retrieval(mode: str) -> dict[str, Any]:
    with ExitStack() as stack:
        stack.enter_context(patch.object(qa_nodes, "get_settings", lambda: _SETTINGS))
        stack.enter_context(patch.object(qa_nodes, "get_index", lambda: _Index()))
        stack.enter_context(
            patch.object(qa_nodes, "get_llm", lambda: _BaseLLM("Grounded summary. [S1]"))
        )
        stack.enter_context(patch.object(qa_nodes, "get_audit", lambda: _Audit()))
        if mode == "before":
            stack.enter_context(patch.object(qa_nodes, "ThreadPoolExecutor", _SerialExecutor))
        return _capture(
            "qa_qualitative",
            lambda: qa_nodes.qa_vector_node(
                {
                    "question": "Summarize the quality profile.",
                    "profile_run_id": "run-1",
                    "workspace_id": "workspace-1",
                    "qa_context": {},
                    "tool_calls": 0,
                }
            ),
        )


def _chart_planner(mode: str) -> dict[str, Any]:
    async def session(_run_id: str, _context: Any) -> dict[str, Any]:
        return {
            "id": "session-1",
            "context": {
                "id": "context-1",
                "context": {
                    "dimensions": ["order_date", "region", "email"],
                    "measures": ["sales", "cost"],
                    "time_column": "order_date",
                    "ignored_columns": ["email"],
                },
            },
        }

    context = SimpleNamespace(
        workspace_id="workspace-1",
        user_id="user-1",
        workspace=SimpleNamespace(effective_permissions=[]),
    )
    with ExitStack() as stack:
        stack.enter_context(patch.object(analysis_routes, "ensure_explorer_session", session))
        stack.enter_context(patch.object(analysis_routes, "get_repository", _ChartRepository))
        stack.enter_context(patch.object(analysis_routes, "get_rate_limiter", lambda: _RateLimiter()))
        stack.enter_context(patch.object(analysis_routes, "get_audit", lambda: _Audit()))
        stack.enter_context(patch.object(analysis_routes, "start_agent_run", lambda **_kwargs: None))
        stack.enter_context(patch.object(analysis_routes, "complete_agent_run", lambda *_args, **_kwargs: None))
        stack.enter_context(patch.object(analysis_routes, "fail_agent_run", lambda *_args, **_kwargs: None))
        stack.enter_context(patch.object(analysis_routes, "get_llm", lambda: _PlannerLLM()))
        if mode == "before":
            stack.enter_context(
                patch.object(analysis_routes, "can_plan_deterministically", lambda *_args: False)
            )
        return _capture(
            "chart_planner",
            lambda: {
                "evidence_status": "verified",
                **asyncio.run(
                    analysis_routes._auto_plan_chart_impl(
                        "run-1",
                        SimpleNamespace(question="Doanh số theo tháng như thế nào?"),
                        context,
                    )
                ),
            },
        )


def _percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * quantile) - 1)]


def _summary(samples: list[dict[str, Any]]) -> dict[str, Any]:
    numeric_keys = (
        "total_ms",
        "planner_ms",
        "retrieval_ms",
        "tools_ms",
        "final_llm_ms",
        "validation_ms",
        "llm_calls",
        "tool_calls",
        "input_tokens",
        "output_tokens",
    )
    result: dict[str, Any] = {"samples": len(samples)}
    for key in numeric_keys:
        values = [float(item[key]) for item in samples if item[key] is not None]
        result[key] = None if not values else {
            "p50": round(median(values), 3),
            "p95": round(_percentile(values, 0.95), 3),
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeats", type=int, default=15)
    parser.add_argument("--mode", choices=("before", "after"), default="after")
    args = parser.parse_args()
    if args.repeats < 3:
        raise SystemExit("--repeats must be at least 3")
    scenarios = {
        "candidate_key": lambda: _candidate_key(args.mode),
        "quality_issue": lambda: _quality_issue(args.mode),
        "profile_fast_path": lambda: _profile_fast_path(args.mode),
        "qualitative_retrieval": lambda: _qualitative_retrieval(args.mode),
        "chart_planner": lambda: _chart_planner(args.mode),
    }
    results = {
        name: _summary([call() for _ in range(args.repeats)])
        for name, call in scenarios.items()
    }
    print(
        json.dumps(
            {
                "benchmark": "chat-agent-local-control-flow",
                "mode": args.mode,
                "adapter_delays_ms": {
                    "tool": _TOOL_DELAY_SECONDS * 1000,
                    "retrieval": _RETRIEVAL_DELAY_SECONDS * 1000,
                    "model": _MODEL_DELAY_SECONDS * 1000,
                },
                "results": results,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
