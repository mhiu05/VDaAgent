"""Focused, privacy-safe RAG evaluation over real QA retrieval contexts."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
import threading
import time
from pathlib import Path
from statistics import fmean
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import EVALUATIONS, publish_alias, read_json, read_jsonl, run_dir, utc_now, write_json  # noqa: E402
from graders.rag import (  # noqa: E402
    claim_support_ratios,
    context_precision,
    merge_grounded_evaluation,
)
from graders.statistics import binomial_ci  # noqa: E402
from src.agents import fast_paths as fast_paths_module  # noqa: E402
from src.agents.nodes import qa_nodes  # noqa: E402
from src.agents.state import initial_qa_state  # noqa: E402

load_dotenv(ROOT / ".env")

RAG_CASE_IDS = (
    "P170-VI-001",
    "P170-VI-002",
    "P170-VI-003",
    "P170-VI-004",
    "P170-VI-005",
    "P170-VI-006",
    "P170-VI-007",
    "P170-VI-008",
    "P170-VI-009",
    "P170-VI-010",
    "P170-VI-011",
    "P170-VI-012",
    "P170-VI-013",
    "P170-VI-014",
    "P170-VI-015",
    "P170-VI-016",
    "P170-VI-017",
    "P170-VI-018",
    "P170-VI-019",
    "P170-VI-020",
    "P170-VI-021",
    "P170-VI-022",
    "P170-VI-023",
    "P170-VI-024",
    "P170-VI-025",
    "P170-VI-026",
    "P170-VI-027",
    "P170-VI-028",
    "P170-VI-029",
    "P170-VI-031",
    "P170-VI-032",
    "P170-VI-033",
    "P170-VI-034",
    "P170-VI-035",
    "P170-VI-036",
    "P170-VI-037",
    "P170-VI-038",
    "P170-VI-039",
    "P170-VI-041",
    "P170-VI-042",
    "P170-VI-048",
    "P170-VI-049",
    "P170-VI-052",
    "P170-VI-056",
    "P170-VI-057",
    "P170-VI-072",
    "P170-VI-077",
    "P170-VI-079",
    "P170-VI-080",
    "P170-VI-083",
)
CACHE = EVALUATIONS / ".cache" / "rag"


class AnswerClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim: str
    supported_by_context: bool
    evidence_grounded: bool
    supporting_citation_ids: list[str] = Field(default_factory=list, max_length=8)


class ReferenceClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim: str
    covered_by_context: bool
    supporting_citation_ids: list[str] = Field(default_factory=list, max_length=8)


class ContextAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    citation_id: str
    relevant: bool


class RAGAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer_claims: list[AnswerClaim] = Field(default_factory=list, max_length=24)
    reference_claims: list[ReferenceClaim] = Field(default_factory=list, max_length=24)
    contexts: list[ContextAssessment] = Field(default_factory=list, max_length=12)
    reason_codes: list[str] = Field(default_factory=list, max_length=8)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _invoke_assessor(client: Any, model: str, payload: dict[str, Any]) -> tuple[RAGAssessment, bool]:
    prompt = """You are an independent RAG evaluator for a synthetic data-profiling assistant.

Use only the supplied question, reference expectation, retrieved contexts, and answer.
Atomize the answer into independently verifiable factual claims about the dataset or
the retrieved evidence. Exclude recommendations, cautions, methodological principles,
epistemic limitations (what evidence can or cannot prove), greetings, formatting, and
procedural next steps. For a sentence containing both a fact and advice, keep only the
factual proposition as an answer claim.

For each answer claim:
- supported_by_context=true only when at least one retrieved context directly supports it;
- evidence_grounded=true only when supported_by_context=true AND the answer explicitly
  cites a context that supports the claim, such as [S1]. Unsupported claims are never
  evidence-grounded merely because a citation marker is nearby.

Atomize only independent_reference_evidence into reference factual claims. Use
reference_expectation only to understand scope; do not turn its response-writing rules,
recommendations, or safety constraints into reference claims. Mark a reference claim
covered only when at least one retrieved context directly supports it.

Return one context assessment for every supplied context, in the same order. A context is
relevant only when it helps answer the question or supports a required reference claim.
Do not infer support from world knowledge. Return only the structured result.

INPUT:
""" + json.dumps(payload, ensure_ascii=False, sort_keys=True)
    cache_key = _hash(json.dumps({"model": model, "prompt": prompt}, ensure_ascii=False, sort_keys=True))
    cache_path = CACHE / f"{cache_key}.json"
    if cache_path.exists():
        return RAGAssessment.model_validate(read_json(cache_path)), True
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            response = client.responses.parse(
                model=model,
                input=prompt,
                text_format=RAGAssessment,
                max_output_tokens=3000,
                reasoning={"effort": "low"},
                store=False,
            )
            parsed = getattr(response, "output_parsed", None)
            result = (
                parsed
                if isinstance(parsed, RAGAssessment)
                else RAGAssessment.model_validate(
                    parsed or json.loads(str(getattr(response, "output_text", "") or "{}"))
                )
            )
            write_json(cache_path, result.model_dump(mode="json"))
            return result, False
        except Exception as exc:  # noqa: BLE001 - bounded retry for evaluator transport
            last_error = exc
            if attempt == 3:
                raise
            time.sleep(0.5 * 2 ** (attempt - 1))
    raise last_error or RuntimeError("rag_assessor_failed")


def _run_product_answer(
    case: dict[str, Any], *, workspace_id: str, profile_run_id: str
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Run the same router/node path as production and capture selected evidence."""

    captured: dict[str, Any] = {}
    captured_tools: list[dict[str, Any]] = []
    tool_lock = threading.Lock()
    original_invoke = qa_nodes.invoke_model
    original_get_index = qa_nodes.get_index
    original_node_run_tool = qa_nodes.run_tool
    original_fast_path_run_tool = fast_paths_module.run_tool
    real_index = original_get_index()

    class CapturingIndex:
        def search(self, *args: Any, **kwargs: Any) -> list[Any]:
            hits = real_index.search(*args, **kwargs)
            knowledge_type = str((kwargs.get("where") or {}).get("knowledge_type") or "")
            captured[f"{knowledge_type}_hits"] = hits
            return hits

    def capturing_invoke(model: Any, messages: list[dict[str, Any]], **kwargs: Any) -> Any:
        for message in reversed(messages):
            if message.get("role") != "user":
                continue
            try:
                payload = json.loads(str(message.get("content") or "{}"))
            except json.JSONDecodeError:
                continue
            if isinstance(payload.get("evidence"), list):
                captured["evidence"] = payload["evidence"]
                break
        return original_invoke(model, messages, **kwargs)

    def capturing_run_tool(name: str, args: dict[str, Any], **kwargs: Any) -> Any:
        result = original_node_run_tool(name, args, **kwargs)
        with tool_lock:
            captured_tools.append(
                {
                    "tool": name,
                    "args": args,
                    "result": result,
                }
            )
        return result

    dataset_path = EVALUATIONS / "datasets" / f"{case['dataset']}.csv"
    column_names: list[str] = []
    if dataset_path.exists():
        with dataset_path.open("r", encoding="utf-8-sig", newline="") as handle:
            column_names = next(csv.reader(handle), [])

    qa_nodes.invoke_model = capturing_invoke
    qa_nodes.get_index = lambda: CapturingIndex()
    qa_nodes.run_tool = capturing_run_tool
    fast_paths_module.run_tool = capturing_run_tool
    try:
        state = initial_qa_state(
            case["question"],
            profile_run_id=profile_run_id,
            workspace_id=workspace_id,
            column_names=column_names,
            answer_detail="standard",
        )
        routed = qa_nodes.qa_router_node(state)
        routed_state = {**state, **routed}
        route = qa_nodes.classify_question_type(routed_state)
        if route == "quantitative":
            result = qa_nodes.qa_structured_node(routed_state)
        elif route == "clarify":
            result = qa_nodes.clarify_node(routed_state)
        elif route == "guardrail":
            result = qa_nodes.qa_guardrail_node(routed_state)
        else:
            result = qa_nodes.qa_vector_node(routed_state)
    finally:
        qa_nodes.invoke_model = original_invoke
        qa_nodes.get_index = original_get_index
        qa_nodes.run_tool = original_node_run_tool
        fast_paths_module.run_tool = original_fast_path_run_tool
    contexts = captured.get("evidence") or []
    if not contexts:
        used: set[int] = set()
        for source in result.get("answer_sources") or []:
            if source.get("type") != "tool" or source.get("status") != "ok":
                continue
            match_index = next(
                (
                    index
                    for index, item in enumerate(captured_tools)
                    if index not in used
                    and item["tool"] == source.get("tool")
                    and item["args"] == (source.get("args") or {})
                ),
                None,
            )
            if match_index is None:
                continue
            used.add(match_index)
            item = captured_tools[match_index]
            contexts.append(
                {
                    "citation_id": source.get("citation_id") or f"S{len(contexts) + 1}",
                    "evidence_type": "tool",
                    "title": item["tool"],
                    "url": None,
                    "text": json.dumps(
                        {
                            "tool": item["tool"],
                            "args": item["args"],
                            "result": item["result"],
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                        default=str,
                    ),
                }
            )
    if not contexts:
        settings = qa_nodes.get_settings()
        profile_hits = captured.get("profile_report_hits") or []
        knowledge_hits = qa_nodes._external_diverse(  # noqa: SLF001 - exact product evidence order
            captured.get("external_knowledge_hits") or [],
            settings.retrieval_max_chunks_per_source,
        )
        remaining = settings.guardrails_max_context_chars
        reconstructed: list[dict[str, Any]] = []
        for group, quota in (
            (profile_hits, settings.retrieval_profile_context_chars),
            (knowledge_hits, settings.retrieval_knowledge_context_chars),
        ):
            allowed = min(quota, remaining)
            for hit in group:
                if allowed <= 0 or remaining <= 0:
                    break
                text = hit.text[: min(allowed, remaining)]
                if not text:
                    continue
                metadata = hit.metadata or {}
                reconstructed.append(
                    {
                        "citation_id": f"S{len(reconstructed) + 1}",
                        "evidence_type": metadata.get("knowledge_type", "profile_report"),
                        "title": metadata.get("title") or metadata.get("dataset_name"),
                        "url": metadata.get("canonical_url"),
                        "text": text,
                    }
                )
                allowed -= len(text)
                remaining -= len(text)
        contexts = reconstructed
    if not contexts:
        raise RuntimeError(f"No retrieval evidence was captured for {case['case_id']}")
    expected_route = case.get("expected_route")
    if expected_route and result.get("qa_path") != expected_route:
        raise RuntimeError(
            f"Product route mismatch for {case['case_id']}: "
            f"expected {expected_route}, observed {result.get('qa_path')}"
        )
    return result, contexts


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    directory = run_dir(args.run_id)
    scores_dir = directory / "scores"
    metadata = read_json(directory / "execution_metadata.json", {})
    mappings = metadata.get("profile_runs") or {}
    workspace_id = str(metadata.get("workspace_id") or "")
    if not workspace_id:
        raise RuntimeError("Benchmark workspace_id is unavailable")
    all_cases = {item["case_id"]: item for item in read_jsonl(EVALUATIONS / "benchmark_cases.jsonl")}
    cases = [all_cases[case_id] for case_id in RAG_CASE_IDS]

    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    model = os.getenv("BENCHMARK_OPENAI_JUDGE_MODEL") or "gpt-5.4-mini"
    client = OpenAI(api_key=api_key)
    records: list[dict[str, Any]] = []

    for case in cases:
        profile_run_id = str(mappings.get(case["dataset"]) or "")
        if not profile_run_id:
            raise RuntimeError(f"Missing profile mapping for {case['dataset']}")
        result, contexts = _run_product_answer(
            case,
            workspace_id=workspace_id,
            profile_run_id=profile_run_id,
        )
        ordered_contexts = [
            {
                "citation_id": str(item.get("citation_id") or f"S{index}"),
                "title": item.get("title"),
                "evidence_type": item.get("evidence_type"),
                "text": str(item.get("text") or ""),
            }
            for index, item in enumerate(contexts, start=1)
        ]
        independent_reference = case.get("judge_evidence") or json.dumps(
            {
                "question_scope": case["question"],
                "structured_ground_truth": case.get("structured_ground_truth"),
                "expected_answer_contract": case.get("expected_answer"),
                "expected_params": case.get("expected_params") or {},
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        assessment, cache_hit = _invoke_assessor(
            client,
            model,
            {
                "question": case["question"],
                "reference_expectation": case.get("judge_reference") or case.get("expected_answer"),
                "independent_reference_evidence": independent_reference,
                "retrieved_contexts": ordered_contexts,
                "answer": result.get("answer"),
            },
        )
        expected_ids = [item["citation_id"] for item in ordered_contexts]
        assessed_ids = [item.citation_id for item in assessment.contexts]
        if assessed_ids != expected_ids:
            raise RuntimeError(
                f"Context assessment IDs do not match retrieval order for {case['case_id']}"
            )
        answer_claims = assessment.answer_claims
        reference_claims = assessment.reference_claims
        labels = [item.relevant for item in assessment.contexts]
        faithfulness, evidence_grounded = claim_support_ratios(answer_claims)
        context_recall = (
            sum(item.covered_by_context for item in reference_claims) / len(reference_claims)
            if reference_claims
            else None
        )
        precision = context_precision(labels)
        counts = {
            "answer_claims": len(answer_claims),
            "supported_answer_claims": sum(
                item.supported_by_context for item in answer_claims
            ),
            "cited_supported_answer_claims": sum(
                item.supported_by_context and item.evidence_grounded
                for item in answer_claims
            ),
            "reference_claims": len(reference_claims),
            "covered_reference_claims": sum(
                item.covered_by_context for item in reference_claims
            ),
            "contexts": len(labels),
            "relevant_contexts": sum(labels),
        }
        records.append(
            {
                "case_id": case["case_id"],
                "dataset": case["dataset"],
                "profile_run_id": profile_run_id,
                "question": case["question"],
                "answer": result.get("answer"),
                "qa_path": result.get("qa_path"),
                "evidence_status": result.get("evidence_status"),
                "context_count": len(ordered_contexts),
                "contexts": [
                    {
                        "citation_id": item["citation_id"],
                        "title": item.get("title"),
                        "evidence_type": item.get("evidence_type"),
                        "text_chars": len(item["text"]),
                        "text_sha256": _hash(item["text"]),
                    }
                    for item in ordered_contexts
                ],
                "assessment": assessment.model_dump(mode="json"),
                "counts": counts,
                "faithfulness": round(faithfulness, 6) if faithfulness is not None else None,
                "context_recall": round(context_recall, 6) if context_recall is not None else None,
                "context_precision": round(precision, 6) if precision is not None else None,
                "evidence_grounded_faithfulness": round(evidence_grounded, 6) if evidence_grounded is not None else None,
                "cache_hit": cache_hit,
            }
        )

    def aggregate(field: str) -> float | None:
        values = [float(item[field]) for item in records if item.get(field) is not None]
        return round(fmean(values), 6) if values else None

    macro_values = {
        "faithfulness": aggregate("faithfulness"),
        "context_recall": aggregate("context_recall"),
        "context_precision": aggregate("context_precision"),
        "evidence_grounded_faithfulness": aggregate("evidence_grounded_faithfulness"),
    }
    count_fields = {
        "faithfulness": ("supported_answer_claims", "answer_claims"),
        "context_recall": ("covered_reference_claims", "reference_claims"),
        "context_precision": ("relevant_contexts", "contexts"),
        "evidence_grounded_faithfulness": (
            "cited_supported_answer_claims",
            "answer_claims",
        ),
    }
    micro_counts = {
        name: {
            "passed": sum(item["counts"][passed] for item in records),
            "total": sum(item["counts"][total] for item in records),
        }
        for name, (passed, total) in count_fields.items()
    }
    metric_values = {
        name: (
            round(values["passed"] / values["total"], 6)
            if values["total"]
            else None
        )
        for name, values in micro_counts.items()
    }
    confidence = {
        name: binomial_ci(values["passed"], values["total"])
        for name, values in micro_counts.items()
    }
    conservative_values = {
        name: (
            interval.get("ci95", [None])[0]
            if interval.get("status") != "NOT_EVALUATED"
            else None
        )
        for name, interval in confidence.items()
    }
    thresholds = {
        "faithfulness": 0.8,
        "context_recall": 0.8,
        "context_precision": 0.6,
        "evidence_grounded_faithfulness": 0.8,
    }
    gates = {
        name: isinstance(conservative_values.get(name), (int, float))
        and float(conservative_values[name]) >= threshold
        for name, threshold in thresholds.items()
    }
    payload = {
        "schema_version": "p170-rag-eval-v2",
        "status": "EVALUATED",
        "language": "vi-VN",
        "run_id": args.run_id,
        "scope": "focused_synthetic_rag",
        "case_count": len(records),
        "model": model,
        "store": False,
        "context_capture": "product-routed exact tool results or vector evidence payload; vector fallback is reconstructed with identical product quotas and ordering from exact retrieval hits",
        "aggregation": "micro claim/context ratios; macro case means retained as diagnostics",
        "metrics": metric_values,
        "macro_metrics": macro_values,
        "micro_counts": micro_counts,
        "confidence": confidence,
        "conservative_metrics": conservative_values,
        "acceptance": {
            "status": "PASS" if all(gates.values()) else "FAIL",
            "gate_basis": "lower bound of Wilson 95% confidence interval",
            "thresholds": thresholds,
            "gates": gates,
        },
        "records": records,
        "timestamp": utc_now(),
    }
    destination = scores_dir / "rag_grounded_scores.json"
    write_json(destination, payload)
    publish_alias(destination, EVALUATIONS / "scores" / destination.name)

    rag_scores = read_json(scores_dir / "rag_scores.json", {})
    rag_scores = merge_grounded_evaluation(
        rag_scores,
        payload,
        artifact=str(destination.relative_to(ROOT)),
    )
    write_json(scores_dir / "rag_scores.json", rag_scores)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
