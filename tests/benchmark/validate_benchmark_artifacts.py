"""Xác thực artifact benchmark vi-VN trước khi bàn giao."""
from __future__ import annotations

import json
import argparse
import sys

from common import EVALUATIONS, publish_alias, read_json, read_jsonl, run_dir, stage_status, utc_now, write_json


def check(name: str, condition: bool, detail: str) -> dict:
    return {"kiem_tra": name, "trang_thai": "PASS" if condition else "FAIL", "chi_tiet": detail}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    directory = run_dir(args.run_id)
    scores_dir = directory / "scores"
    stage_status(directory, "validate", "RUNNING")
    manifest = read_json(EVALUATIONS / "benchmark_manifest.json", {})
    cases = read_jsonl(EVALUATIONS / "benchmark_cases.jsonl")
    golden = read_jsonl(EVALUATIONS / "golden_dataset.jsonl")
    normalized = read_jsonl(directory / "normalized_results.jsonl")
    metadata = read_json(directory / "execution_metadata.json", {})
    current_raw = read_jsonl(directory / "raw_results.jsonl")
    numeric_audit = read_json(directory / "audit" / "numeric_accuracy_audit.json", {})
    judge = read_json(scores_dir / "judge_scores.json", {})
    trace_mapping = read_json(directory / "langsmith_trace_mapping.json", {})
    rag = read_json(scores_dir / "rag_scores.json", {})
    rag_grounded = read_json(scores_dir / "rag_grounded_scores.json", {})
    report = (directory / "report.md").read_text(encoding="utf-8") if (directory / "report.md").exists() else ""
    datasets = ["profiling_base.csv", "profiling_edge_cases.csv", "profiling_pii.csv", "drift_v1.csv", "drift_v2.csv", "inventory.json"]
    ground_truth = ["dataset_statistics.json", "profiling_truth.json", "pii_truth.json", "drift_truth.json", "expected_evidence.json"]
    case_ids = [case.get("case_id") for case in cases]
    golden_ids = [case.get("case_id") for case in golden]
    executed_ids = {item.get("case_id") for item in normalized}
    executed_cases = [case for case in cases if case.get("case_id") in executed_ids]
    numeric_expected = any(
        isinstance(case.get("structured_ground_truth"), (int, float))
        and not isinstance(case.get("structured_ground_truth"), bool)
        for case in executed_cases
    )
    evidence_expected = any(
        bool((case.get("expected_evidence") or {}).get("required"))
        for case in executed_cases
    )
    numeric_audit_valid = (
        (directory / "audit" / "sse_failure_audit.json").exists()
        and (
            numeric_audit.get("numeric_eligible_requests", 0) > 0
            if numeric_expected
            else numeric_audit.get("numeric_eligible_requests", 0) == 0
        )
    )
    source_coverage = rag.get("evidence_source_coverage", {})
    source_coverage_valid = (
        source_coverage.get("status") == "EVALUATED"
        and source_coverage.get("eligible_requests", 0) > 0
        if evidence_expected
        else source_coverage.get("status") == "NOT_EVALUATED"
        and source_coverage.get("eligible_requests", 0) == 0
    )
    checks = [
        check("Dữ liệu tổng hợp tiếng Việt", all((EVALUATIONS / "datasets" / item).exists() for item in datasets), "Đủ 5 dataset CSV/JSON tổng hợp cho ngữ cảnh khách hàng và giao dịch Việt Nam."),
        check("Ground truth mới", all((EVALUATIONS / "ground_truth" / item).exists() for item in ground_truth), "Đủ artifact truth độc lập cho profiling, PII, drift và evidence."),
        check("Golden dataset tiếng Việt", len(golden) == 83 and golden_ids == case_ids and all(item.get("language") == "vi-VN" and item.get("question") and item.get("expected_answer") for item in golden), "83 golden case khớp case_id, có câu hỏi và đáp án kỳ vọng tiếng Việt."),
        check("Đủ 83 case", manifest.get("case_count") == 83 and len(cases) == 83 and len(set(case_ids)) == 83, "Manifest, case file và case_id duy nhất đều xác nhận 83 case."),
        check("Thực thi local tiếng Việt", bool(current_raw) and len(current_raw) == len(normalized) and all(item.get("case_id", "").startswith("P170-VI-") and item.get("language") == "vi-VN" and item.get("environment") == "local" for item in current_raw) and all(item.get("language") == "vi-VN" and item.get("environment") == "local" for item in normalized), "Raw/normalized result của đúng run_id hiện hành chỉ chứa case vi-VN local."),
        check("Score artifact", all((scores_dir / item).exists() for item in ("deterministic_scores.json", "evidence_scores.json", "safety_scores.json", "agentic_scores.json", "performance_scores.json", "rag_scores.json", "judge_scores.json", "gemini_model_catalog.json", "openai_model_catalog.json")), "Đủ deterministic, evidence, safety, agentic, performance, RAG, Judge và catalog của cả hai provider."),
        check("Audit numeric và SSE", numeric_audit_valid, "Numeric audit tách SSE khỏi sai số câu trả lời, ghi rõ mẫu số và giữ NOT_EVALUATED khi run lọc không có case số."),
        check("LLM Judge có calibration và không lưu secret", judge.get("judge_calls_attempted", 0) + judge.get("model_list_calls_attempted", 0) >= 1 and judge.get("judge_configuration", {}).get("api_key_configured") is True and judge.get("calibration", {}).get("gate_pass") is True and "api_key" not in json.dumps(judge, ensure_ascii=False).casefold().replace("api_key_configured", ""), "Judge artifact ghi provider/fallback/calibration nhưng không lưu API key; chỉ chấm case semantic sau khi calibration đạt."),
        check("LangSmith trace mapping", trace_mapping.get("status") == "EVALUATED" and trace_mapping.get("mapping_status") == "EXACT_AGENT_RUN_ID_MAPPING" and trace_mapping.get("exact_case_trace_mapping_count", 0) > 0 and (directory / "retrieval_contexts.jsonl").exists(), "Trace được map chính xác về case bằng agent_run_id; chỉ suy luận các field metadata quan sát được."),
        check("Answer Relevancy embedding", rag.get("answer_relevancy", {}).get("status") == "EVALUATED" and rag.get("answer_relevancy", {}).get("eligible_requests", 0) > 0 and source_coverage_valid, "Đo semantic question-answer bằng Voyage; source coverage chỉ EVALUATED khi run có case bắt buộc evidence, còn groundedness thiếu context giữ NOT_EVALUATED."),
        check(
            "Focused RAG grounded metrics",
            rag_grounded.get("status") == "EVALUATED"
            and rag_grounded.get("run_id") == args.run_id
            and rag_grounded.get("case_count", 0) > 0
            and rag_grounded.get("store") is False
            and rag_grounded.get("acceptance", {}).get("status") in {"PASS", "FAIL"}
            and len(rag_grounded.get("acceptance", {}).get("gates", {})) == 4
            and all(
                rag.get(name, {}).get("status") == "EVALUATED"
                and isinstance(rag.get(name, {}).get("score"), (int, float))
                for name in (
                    "faithfulness",
                    "context_recall",
                    "context_precision",
                    "evidence_grounded_faithfulness",
                )
            ),
            "Bốn metric claim/context được chấm trên focused RAG set; validation kiểm tra tính toàn vẹn và không đồng nhất metric FAIL với artifact lỗi.",
        ),
        check(
            "Báo cáo tổng hợp metric",
            report.startswith("# Báo cáo tổng hợp metrics VDaAgent")
            and "## 1. Deterministic metrics" in report
            and "## 2. LLM-as-Judge" in report
            and "### 1.1 Cách tính" in report
            and "### 2.1 Cách chọn dữ liệu và cách chấm" in report
            and "### 3.1 RAG grounded metrics" in report
            and "Wilson CI 95%" in report
            and "Acceptance tổng thể hiện là" in report
            and "| Metric | Cách tính |" in report,
            "Báo cáo có hai nhóm metric chính, công thức/mẫu số, bảng ý nghĩa và nhận xét.",
        ),
    ]
    payload = {
        "language": "vi-VN", "run_id": metadata.get("run_id"),
        "trang_thai": "PASS" if all(item["trang_thai"] == "PASS" for item in checks) else "FAIL",
        "kiem_tra": checks, "thoi_diem": utc_now(),
    }
    destination = directory / "validation_results.json"
    write_json(destination, payload)
    publish_alias(destination, EVALUATIONS / "validation_results.json")
    stage_status(directory, "validate", "COMPLETED" if payload["trang_thai"] == "PASS" else "FAILED", exit_code=0 if payload["trang_thai"] == "PASS" else 1)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if payload["trang_thai"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
