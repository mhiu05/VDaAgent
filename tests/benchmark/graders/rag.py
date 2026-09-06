"""Metric RAG theo từng điều kiện quan sát được, không tạo điểm giả."""
from __future__ import annotations

import math
import queue
import sys
import threading
from collections import defaultdict
from pathlib import Path
from statistics import fmean, median, stdev
from typing import Any


EVALUATOR_TIMEOUT_SECONDS = 30.0

GROUNDED_METRIC_DESCRIPTIONS = {
    "faithfulness": (
        "Supported answer claims / verifiable answer claims",
        "Claim support against exact retrieved context",
    ),
    "context_recall": (
        "Covered independent reference claims / reference claims",
        "Reference claim coverage by retrieved context",
    ),
    "context_precision": (
        "Relevant retrieved contexts / all retrieved contexts",
        "Binary retrieved-context relevance precision",
    ),
    "evidence_grounded_faithfulness": (
        "Explicitly cited supported claims / verifiable answer claims",
        "Strict citation-to-context claim support",
    ),
}

def metric(status: str, score: float | None, reason: str, method: str, **extra: Any) -> dict[str, Any]:
    return {"status": status, "score": score, "reason": reason, "method": method, **extra}


def context_precision(labels: list[bool]) -> float | None:
    """Return the fraction of retrieved contexts independently labelled relevant."""

    return sum(labels) / len(labels) if labels else None


def claim_support_ratios(claims: list[Any]) -> tuple[float | None, float | None]:
    """Return faithfulness and strict cited-supported faithfulness."""

    if not claims:
        return None, None

    def value(item: Any, field: str) -> bool:
        if isinstance(item, dict):
            return bool(item.get(field))
        return bool(getattr(item, field, False))

    supported = [value(item, "supported_by_context") for item in claims]
    explicitly_grounded = [value(item, "evidence_grounded") for item in claims]
    denominator = len(claims)
    return (
        sum(supported) / denominator,
        sum(
            support and citation
            for support, citation in zip(supported, explicitly_grounded, strict=True)
        )
        / denominator,
    )


def merge_grounded_evaluation(
    rag_payload: dict[str, Any],
    grounded: dict[str, Any],
    *,
    artifact: str,
) -> dict[str, Any]:
    """Merge a focused claim/context evaluation into the general RAG scorecard."""

    values = grounded.get("metrics")
    if grounded.get("status") != "EVALUATED" or not isinstance(values, dict):
        return rag_payload
    eligible_cases = int(grounded.get("case_count") or 0)
    confidence = grounded.get("confidence") or {}
    conservative = grounded.get("conservative_metrics") or {}
    for name, (reason, method) in GROUNDED_METRIC_DESCRIPTIONS.items():
        value = values.get(name)
        rag_payload[name] = metric(
            "EVALUATED" if isinstance(value, (int, float)) else "NOT_EVALUATED",
            value if isinstance(value, (int, float)) else None,
            reason,
            method,
            eligible_cases=eligible_cases,
            conservative_score=conservative.get(name),
            ci95=(confidence.get(name) or {}).get("ci95"),
            micro_counts=(grounded.get("micro_counts") or {}).get(name),
            artifact=artifact,
        )
    rag_payload["status"] = "EVALUATED"
    rag_payload["grounded_evaluation_scope"] = grounded.get("scope")
    rag_payload["grounded_evaluator"] = {
        "model": grounded.get("model"),
        "store": grounded.get("store"),
        "aggregation": grounded.get("aggregation"),
        "acceptance": grounded.get("acceptance"),
    }
    return rag_payload


def _safe_error(exc: Exception) -> str:
    text = str(exc).casefold()
    if isinstance(exc, TimeoutError) or "timeout" in text:
        return "VOYAGE_EMBEDDING_TIMEOUT"
    if "401" in text or "authentication" in text:
        return "VOYAGE_AUTH_FAILED"
    if "429" in text or "quota" in text:
        return "VOYAGE_RATE_LIMITED"
    return "VOYAGE_EMBEDDING_FAILED"


def _cosine(left: list[float], right: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    return numerator / (left_norm * right_norm) if left_norm and right_norm else 0.0


def _embed(client: Any, texts: list[str], model: str, input_type: str) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), 64):
        response = client.embed(texts[start : start + 64], model=model, input_type=input_type)
        vectors.extend([list(map(float, vector)) for vector in response.embeddings])
    return vectors


def _with_hard_timeout(call: Any, timeout_seconds: float) -> Any:
    """Bound evaluator wall time even when an SDK socket ignores timeouts."""

    outcomes: queue.Queue[tuple[str, Any]] = queue.Queue(maxsize=1)

    def run() -> None:
        try:
            outcomes.put(("ok", call()))
        except BaseException as exc:  # noqa: BLE001 - re-raised on the caller thread
            outcomes.put(("error", exc))

    worker = threading.Thread(target=run, name="voyage-evaluator", daemon=True)
    worker.start()
    worker.join(timeout_seconds)
    if worker.is_alive():
        raise TimeoutError(
            f"Voyage evaluator exceeded the {timeout_seconds:g}s hard deadline"
        )
    try:
        status, value = outcomes.get_nowait()
    except queue.Empty as exc:  # pragma: no cover - defensive thread failure guard
        raise RuntimeError("Voyage evaluator returned no result") from exc
    if status == "error":
        raise value
    return value


def _summary(records: list[dict[str, Any]], cases: dict[str, dict]) -> dict[str, Any]:
    def summarize(items: list[dict[str, Any]]) -> dict[str, Any]:
        values = [item["score"] for item in items]
        return {
            "n": len(values), "mean": round(fmean(values), 6), "median": round(median(values), 6),
            "std": round(stdev(values), 6) if len(values) > 1 else 0.0,
            "min": round(min(values), 6), "max": round(max(values), 6),
        }
    difficulty: dict[str, list[dict[str, Any]]] = defaultdict(list)
    category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        case = cases[record["case_id"]]
        difficulty[str(case.get("difficulty_vi"))].append(record)
        category[str(case.get("category_vi"))].append(record)
    return {"overall": summarize(records), "by_difficulty": {key: summarize(value) for key, value in sorted(difficulty.items())}, "by_category": {key: summarize(value) for key, value in sorted(category.items())}}


def _answer_relevancy(cases: dict[str, dict], results: list[dict]) -> dict[str, Any]:
    eligible = [row for row in results if row.get("status") == "OK" and str(row.get("answer") or "").strip() and row.get("case_id") in cases]
    if not eligible:
        return metric("NOT_EVALUATED", None, "Không có question-answer pair thành công.", "Voyage query-document cosine")
    try:
        backend = Path(__file__).resolve().parents[3] / "backend"
        sys.path.insert(0, str(backend))
        from src.config import get_settings
        import voyageai

        settings = get_settings()
        if not settings.voyage_api_key:
            return metric("NOT_EVALUATED", None, "VOYAGE_API_KEY chưa được cấu hình.", "Voyage query-document cosine")
        client = voyageai.Client(api_key=settings.voyage_api_key)
        questions = [str(cases[row["case_id"]]["question"]) for row in eligible]
        answers = [str(row["answer"]) for row in eligible]
        query_vectors, answer_vectors = _with_hard_timeout(
            lambda: (
                _embed(client, questions, settings.retrieval_embedding_model, "query"),
                _embed(client, answers, settings.retrieval_embedding_model, "document"),
            ),
            EVALUATOR_TIMEOUT_SECONDS,
        )
        records = [
            {"case_id": row["case_id"], "attempt": row.get("attempt"), "score": round(_cosine(query, answer), 6)}
            for row, query, answer in zip(eligible, query_vectors, answer_vectors)
        ]
        return metric(
            "EVALUATED", round(fmean(item["score"] for item in records), 6),
            "Đo semantic alignment trực tiếp giữa question và answer; không cần retrieved context.",
            "Voyage voyage-3.5 query-document cosine; không so sánh trực tiếp với thang RAGAS.",
            eligible_requests=len(records), records=records, aggregation=_summary(records, cases),
            evaluator_configuration={"provider": "voyage", "model": settings.retrieval_embedding_model, "api_key_configured": True},
        )
    except Exception as exc:
        return metric("NOT_EVALUATED", None, f"Không gọi được evaluator embedding: {_safe_error(exc)}.", "Voyage query-document cosine")


def score(cases: dict[str, dict], results: list[dict], judge: dict[str, Any], trace_mapping: dict[str, Any]) -> dict[str, Any]:
    answer_relevancy = _answer_relevancy(cases, results)
    eligible_sources = [
        row
        for row in results
        if row.get("status") == "OK"
        and row.get("case_id") in cases
        and bool((cases[row["case_id"]].get("expected_evidence") or {}).get("required"))
    ]
    source_observed = [
        row
        for row in eligible_sources
        if bool(row.get("sources") or row.get("citations"))
        and (row.get("provenance") or {}).get("evidence_status") == "verified"
    ]
    source_coverage = metric(
        "EVALUATED" if eligible_sources else "NOT_EVALUATED",
        round(len(source_observed) / len(eligible_sources), 6) if eligible_sources else None,
        "Tỷ lệ response bắt buộc evidence có nguồn công khai và evidence_status=verified; case abstain/clarify/guardrail không nằm trong mẫu số.",
        "Public answer source policy theo đúng case_id/attempt",
        observed_requests=len(source_observed), eligible_requests=len(eligible_sources),
    )
    telemetry_reason = "Trace đã map chính xác theo agent_run_id nhưng không công bố retrieved chunks/context content; không thể chấm claim-to-context fidelity hoặc relevance của chunk."
    return {
        "status": "PARTIALLY_EVALUATED" if answer_relevancy.get("status") == "EVALUATED" else "NOT_EVALUATED", "language": "vi-VN",
        "answer_relevancy": answer_relevancy,
        "faithfulness": metric("NOT_EVALUATED", None, telemetry_reason, "Retrieved context thực tế"),
        "context_recall": metric("NOT_EVALUATED", None, telemetry_reason, "Retrieved chunks + expected evidence"),
        "context_precision": metric("NOT_EVALUATED", None, telemetry_reason, "Retrieved chunks + relevance labels"),
        "evidence_grounded_faithfulness": metric("NOT_EVALUATED", None, "answer_sources chỉ có tool metadata, không có nội dung evidence đã dùng để tạo claim; không coi metadata là grounding context.", "Tool/evidence content thực tế"),
        "evidence_source_coverage": source_coverage,
        "trace_mapping_status": trace_mapping.get("mapping_status"),
        "judge_status": judge.get("status"),
        "mo_ta": "Mỗi metric có status và lý do riêng; missing context không được chuyển thành 0.",
    }
