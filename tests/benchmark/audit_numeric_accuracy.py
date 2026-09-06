"""Audit toàn bộ request numeric từ raw result hiện hành, không rerun agent."""
from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal

from common import EVALUATIONS, publish_alias, read_json, read_jsonl, run_dir, scrub, stage_status, utc_now, write_json
from graders.numeric import assess_answer


def sse_category(error: object, status_code: object) -> str:
    text = str(error or "").casefold()
    if status_code == 504 or "timeout" in text:
        return "TIMEOUT"
    if "parser" in text or "json" in text:
        return "PARSER_ERROR"
    if "client" in text or "connection" in text:
        return "BENCHMARK_CLIENT_ERROR"
    if any(token in text for token in ("gemini", "provider", "quota", "authentication")):
        return "MODEL_PROVIDER_ERROR"
    if "tool" in text:
        return "TOOL_ERROR"
    if "server_error" in text or "sse" in text:
        return "PRODUCT_SSE_ERROR"
    return "UNKNOWN"


def exact_match(assessment: object, expected: object) -> bool:
    expected_decimal = Decimal(str(expected))
    return any(candidate.value == expected_decimal for candidate in assessment.candidates)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    directory = run_dir(args.run_id)
    scores_dir, audit_dir = directory / "scores", directory / "audit"
    stage_status(directory, "numeric_audit", "RUNNING")
    cases = {case["case_id"]: case for case in read_jsonl(EVALUATIONS / "benchmark_cases.jsonl")}
    results = read_jsonl(directory / "normalized_results.jsonl")
    prior = read_json(audit_dir / "numeric_accuracy_audit.json", {})
    old_scores = read_json(scores_dir / "deterministic_scores.json", {}).get("scores", [])
    old_by_attempt = {(item.get("case_id"), item.get("attempt")): item for item in old_scores if item.get("numeric")}
    numeric_rows = [
        (cases[row["case_id"]], row)
        for row in results
        if row.get("case_id") in cases
        and isinstance(cases[row["case_id"]].get("structured_ground_truth"), (int, float))
        and not isinstance(cases[row["case_id"]].get("structured_ground_truth"), bool)
    ]
    records: list[dict] = []
    sse_records: list[dict] = []
    for case, row in numeric_rows:
        assessment = assess_answer(case, str(row.get("answer") or ""))
        corrected_pass = row.get("status") == "OK" and assessment.matched
        tags: list[str] = []
        if row.get("status") != "OK":
            tags.append("SSE_EXECUTION_ERROR")
        elif not assessment.candidates:
            tags.append("ANSWER_MISSING_NUMBER")
        elif not corrected_pass:
            tags.append("ACTUAL_WRONG_NUMBER")
            if "thay đổi" in str(case.get("question") or "").casefold():
                tags.append("WRONG_METRIC_INTERPRETATION")
        else:
            prior_score = old_by_attempt.get((case["case_id"], row.get("attempt")), {})
            if not prior_score.get("pass"):
                tags.append(assessment.matched_candidate.format_tag or "NUMERIC_EXTRACTION_FAILURE")
        record = scrub({
            "case_id": case["case_id"], "attempt": row.get("attempt"), "question": case.get("question"),
            "expected_value": case.get("structured_ground_truth"), "actual_answer": row.get("answer"),
            "status": row.get("status"), "error": row.get("error"), "numeric_policy": assessment.policy,
            "evidence_observed": bool(row.get("sources") or row.get("citations") or row.get("provenance")),
            "extracted_values": [str(candidate.value) for candidate in assessment.candidates],
            "extraction_ambiguous": assessment.extraction_ambiguous,
            "original_pass": bool(old_by_attempt.get((case["case_id"], row.get("attempt")), {}).get("pass")),
            "corrected_pass": corrected_pass, "classification": tags or ["CORRECT"],
        })
        records.append(record)
    for row in results:
        if row.get("status") == "OK":
            continue
        sse_records.append(scrub({
            "case_id": row.get("case_id"), "attempt": row.get("attempt"), "status_code": row.get("status_code"),
            "observed_error": row.get("error"), "classification": sse_category(row.get("error"), row.get("status_code")),
        }))
    total = len(records)
    successful = [item for item in records if item["status"] == "OK"]
    extracted = [item for item in records if item["extracted_values"]]
    corrected = [item for item in records if item["corrected_pass"]]
    evidence_consistent = [item for item in corrected if item["evidence_observed"]]
    exact = [item for (case, _), item in zip(numeric_rows, records) if item["status"] == "OK" and exact_match(assess_answer(case, item["actual_answer"] or ""), case["structured_ground_truth"])]
    classifications = Counter(tag for item in records for tag in item["classification"] if tag != "CORRECT")
    original_accuracy = prior.get("original_numeric_accuracy")
    if original_accuracy is None:
        original_accuracy = read_json(scores_dir / "deterministic_scores.json", {}).get("numeric_accuracy")
    payload = {
        "language": "vi-VN", "run_id": args.run_id,
        "original_numeric_accuracy": original_accuracy,
        "corrected_numeric_accuracy": round(len(corrected) / total, 6) if total else None,
        "numeric_eligible_requests": total, "numeric_eligible_cases": len({item["case_id"] for item in records}),
        "correct_numeric_requests": len(corrected),
        "numeric_task_success_rate": round(len(corrected) / total, 6) if total else None,
        "numeric_answer_accuracy_given_successful_execution": round(len(corrected) / len(successful), 6) if successful else None,
        "numeric_extraction_coverage": round(len(extracted) / total, 6) if total else None,
        "numeric_extraction_coverage_given_successful_execution": round(len(extracted) / len(successful), 6) if successful else None,
        "numeric_exact_match_rate": round(len(exact) / total, 6) if total else None,
        "numeric_tolerance_match_rate": round(len(corrected) / total, 6) if total else None,
        "numeric_evidence_consistency": round(len(evidence_consistent) / len(corrected), 6) if corrected else None,
        "numeric_evidence_consistency_eligible_requests": len(corrected),
        "numeric_evidence_consistent_requests": len(evidence_consistent),
        "classification_counts": dict(sorted(classifications.items())),
        "actual_wrong_number_count": classifications["ACTUAL_WRONG_NUMBER"],
        "parser_failure_count": classifications["NUMERIC_EXTRACTION_FAILURE"] + classifications["VIETNAMESE_NUMBER_FORMAT"],
        "format_normalization_count": classifications["VIETNAMESE_NUMBER_FORMAT"],
        "percentage_normalization_count": classifications["PERCENT_NORMALIZATION"],
        "unit_normalization_count": classifications["UNIT_NORMALIZATION"],
        "sse_related_count": classifications["SSE_EXECUTION_ERROR"],
        "wrong_binding_count": classifications["WRONG_DATASET_OR_RUN_BINDING"],
        "records": records, "mo_ta": "Metric request-level giữ SSE tách khỏi câu trả lời sai; không rerun agent để audit parser.", "thoi_diem": utc_now(),
    }
    numeric_path = audit_dir / "numeric_accuracy_audit.json"
    sse_path = audit_dir / "sse_failure_audit.json"
    write_json(numeric_path, payload)
    write_json(sse_path, {
        "language": "vi-VN", "run_id": payload["run_id"], "total_sse_failures": len(sse_records),
        "classification_counts": dict(sorted(Counter(item["classification"] for item in sse_records).items())),
        "records": sse_records,
        "mo_ta": "Phân loại từ lỗi SSE quan sát được; không suy diễn nguyên nhân nội bộ khi trace không công bố error detail.",
        "thoi_diem": utc_now(),
    })
    publish_alias(numeric_path, EVALUATIONS / "audit" / numeric_path.name)
    publish_alias(sse_path, EVALUATIONS / "audit" / sse_path.name)
    stage_status(directory, "numeric_audit", "COMPLETED", exit_code=0)


if __name__ == "__main__":
    main()
