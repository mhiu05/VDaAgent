"""Audit cơ học verdict của grader trên mẫu PASS, FAIL và edge/safety/tool."""
from __future__ import annotations

import argparse
from pathlib import Path

from common import EVALUATIONS, publish_alias, read_json, read_jsonl, run_dir, stage_status, write_json
from graders import deterministic


def first_results(directory: Path) -> dict[str, dict]:
    output: dict[str, dict] = {}
    for item in read_jsonl(directory / "normalized_results.jsonl"):
        output.setdefault(str(item.get("case_id")), item)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    directory = run_dir(args.run_id)
    cases = {case["case_id"]: case for case in read_jsonl(EVALUATIONS / "benchmark_cases.jsonl")}
    stored_payload = read_json(directory / "scores" / "deterministic_scores.json", {})
    stored = {item["case_id"]: item for item in stored_payload.get("scores", [])}
    results = first_results(directory)
    candidates = []
    for case_id, result in results.items():
        case = cases.get(case_id)
        if not case:
            continue
        rescored = deterministic.score(case, result)
        expected = stored.get(case_id, {})
        candidates.append({"case": case, "result": result, "rescored": rescored, "stored": expected, "agreement": rescored.get("pass") == expected.get("pass")})
    passing = [item for item in candidates if item["rescored"].get("pass")][:10]
    failing = [item for item in candidates if not item["rescored"].get("pass")][:10]
    edge = [item for item in candidates if item["case"].get("query_type") in {"edge", "adversarial"} or item["case"].get("category") in {"tool usage", "privacy/safety/adversarial"}][:5]
    selected: list[dict] = []
    seen: set[str] = set()
    for item in passing + failing + edge:
        key = item["case"]["case_id"]
        if key not in seen:
            seen.add(key)
            selected.append(item)
    records = [{
        "case_id": item["case"]["case_id"], "category_vi": item["case"].get("category_vi"), "question": item["case"].get("question"),
        "expected_answer": item["case"].get("expected_answer"), "actual_answer": item["result"].get("answer"),
        "stored_verdict": item["stored"].get("pass"), "recomputed_verdict": item["rescored"].get("pass"),
        "agreement": item["agreement"], "evidence_observed": bool((item["result"].get("sources") or item["result"].get("citations") or item["result"].get("provenance"))),
        "status_code": item["result"].get("status_code"),
    } for item in selected]
    agreement_rate = round(sum(bool(item["agreement"]) for item in records) / len(records), 6) if records else None
    destination = directory / "audits" / "grader_audit.json"
    write_json(destination, {
        "language": "vi-VN", "status": "COMPLETED" if len(passing) == 10 and len(failing) == 10 and len(edge) == 5 else "PARTIAL_INSUFFICIENT_OBSERVED_CASES",
        "mo_ta": "Audit tái chấm deterministic tự động. Đây là kiểm tra nhất quán grader, không phải đánh giá thủ công độc lập.",
        "sample_counts": {"pass": len(passing), "fail": len(failing), "edge_safety_tool": len(edge), "unique_audited": len(records)},
        "grader_agreement_rate": agreement_rate, "records": records,
    })
    publish_alias(destination, EVALUATIONS / "audits" / destination.name)
    stage_status(directory, "grader_audit", "COMPLETED", exit_code=0)


if __name__ == "__main__":
    main()
