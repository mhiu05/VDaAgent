"""Chấm các assertion xác định; không dùng LLM để thay thế ground truth."""
from __future__ import annotations

import re
from typing import Any

from graders.numeric import assess_answer, extract_candidates


INSUFFICIENT_EVIDENCE_TOKENS = (
    "cannot", "can't", "not able", "insufficient", "không thể", "không có đủ",
    "chưa có đủ", "chưa đủ bằng chứng", "ngoài phạm vi", "không cung cấp",
)


def has_insufficient_evidence(answer: str) -> bool:
    return any(token in answer for token in INSUFFICIENT_EVIDENCE_TOKENS)


def boolean_answer_matches(answer: str, expected: bool) -> bool:
    """Accept an explicit leading yes/no answer, never an abstention phrase."""
    if has_insufficient_evidence(answer):
        return False
    positive = bool(re.search(r"^\s*(?:có|đúng|yes|true)\b", answer))
    negative = bool(re.search(r"^\s*(?:không|no|false|sai)\b", answer))
    return positive if expected else negative


def numeric_candidates(answer: str) -> list[float]:
    """Compatibility helper for audit code; grading uses ``assess_answer``."""
    return [float(candidate.value) for candidate in extract_candidates(answer, "aggregate")]


def score(case: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    answer = str(result.get("answer") or "").casefold()
    expected = case.get("structured_ground_truth", case.get("expected_answer"))
    status = result.get("status") == "OK"
    if case.get("requires_abstention"):
        passed = has_insufficient_evidence(answer) and status
    elif case.get("requires_clarification"):
        passed = ("?" in answer or any(token in answer for token in ("which", "clarify", "please specify", "làm rõ", "cụ thể", "vui lòng", "bạn có thể", "cần thêm thông tin"))) and status
    elif expected is None:
        passed = status and bool(answer)
    elif isinstance(expected, bool):
        passed = status and boolean_answer_matches(answer, expected)
    elif isinstance(expected, (int, float)):
        numeric_assessment = assess_answer(case, answer)
        passed = status and numeric_assessment.matched
    else:
        passed = status and str(expected).casefold() in answer
    payload = {"case_id": case["case_id"], "attempt": result.get("attempt"), "pass": passed, "eligible": True, "numeric": isinstance(expected, (int, float)) and not isinstance(expected, bool), "status": result.get("status"), "reason": "khớp_ground_truth" if passed else "không_khớp_hoặc_lỗi"}
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        payload.update({
            "numeric_policy": numeric_assessment.policy,
            "numeric_candidate_count": len(numeric_assessment.candidates),
            "numeric_extraction_ambiguous": numeric_assessment.extraction_ambiguous,
            "numeric_matched_format": numeric_assessment.matched_candidate.format_tag if numeric_assessment.matched_candidate else None,
        })
    return payload
