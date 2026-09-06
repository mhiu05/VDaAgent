"""Chuẩn hoá và so sánh số tiếng Việt cho benchmark, không dùng LLM."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any


NUMBER_PATTERN = re.compile(
    r"(?<![\w.-])(?P<number>[+-]?\d(?:[\d.,]*\d)?)(?:\s*)(?P<unit>%|phần trăm|nghìn|triệu|tỷ|đồng|vnd)?",
    re.IGNORECASE,
)
UNIT_MULTIPLIERS = {"nghìn": Decimal("1000"), "triệu": Decimal("1000000"), "tỷ": Decimal("1000000000")}
COUNT_HINTS = ("bao nhiêu dòng", "bao nhiêu cột", "bao nhiêu giá trị", "bao nhiêu nhóm", "bản ghi", "cardinality")


@dataclass(frozen=True)
class NumericCandidate:
    raw: str
    value: Decimal
    format_tag: str | None = None
    ambiguous: bool = False


@dataclass(frozen=True)
class NumericAssessment:
    policy: str
    candidates: tuple[NumericCandidate, ...]
    matched: bool
    matched_candidate: NumericCandidate | None
    extraction_ambiguous: bool


def policy_for_case(case: dict[str, Any]) -> str:
    question = str(case.get("question") or "").casefold()
    if "tỷ lệ" in question or "phần trăm" in question:
        return "percentage"
    if "tương quan" in question:
        return "correlation"
    if any(hint in question for hint in COUNT_HINTS):
        return "integer_count"
    if any(hint in question for hint in ("doanh_thu", "giam_gia", "giao_dịch", "chi tiêu", "chi_tieu")):
        return "currency_or_amount"
    return "aggregate"


def _decimal_variants(number: str, policy: str) -> tuple[list[Decimal], bool, str | None]:
    number = number.strip()
    if not number:
        return [], False, None
    if "." in number and "," in number:
        decimal_separator = "," if number.rfind(",") > number.rfind(".") else "."
        grouping_separator = "." if decimal_separator == "," else ","
        normalized = number.replace(grouping_separator, "").replace(decimal_separator, ".")
        return [Decimal(normalized)], False, "VIETNAMESE_NUMBER_FORMAT"
    separator = "," if "," in number else "." if "." in number else None
    if separator is None:
        return [Decimal(number)], False, None
    parts = number.split(separator)
    if len(parts) > 2:
        return [Decimal("".join(parts))], False, "VIETNAMESE_NUMBER_FORMAT"
    whole, fraction = parts
    decimal_value = Decimal(f"{whole}.{fraction}")
    if len(fraction) != 3:
        return [decimal_value], False, "VIETNAMESE_NUMBER_FORMAT"
    grouped_value = Decimal("".join(parts))
    if policy == "integer_count":
        return [grouped_value], False, "VIETNAMESE_NUMBER_FORMAT"
    return [decimal_value, grouped_value], True, "VIETNAMESE_NUMBER_FORMAT"


def extract_candidates(text: str, policy: str) -> list[NumericCandidate]:
    candidates: list[NumericCandidate] = []
    for match in NUMBER_PATTERN.finditer(text.casefold()):
        raw = match.group(0).strip()
        unit = (match.group("unit") or "").casefold()
        try:
            values, ambiguous, tag = _decimal_variants(match.group("number"), policy)
        except InvalidOperation:
            continue
        multiplier = UNIT_MULTIPLIERS.get(unit, Decimal("1"))
        for value in values:
            normalized = value * multiplier
            if unit in {"%", "phần trăm"}:
                normalized /= Decimal("100")
                tag = "PERCENT_NORMALIZATION"
            elif unit in UNIT_MULTIPLIERS or "đồng" in raw or "vnd" in raw:
                tag = "UNIT_NORMALIZATION" if unit in UNIT_MULTIPLIERS else tag
            candidates.append(NumericCandidate(raw=raw, value=normalized, format_tag=tag, ambiguous=ambiguous))
    return candidates


def _matches(value: Decimal, expected: Decimal, policy: str) -> bool:
    if policy == "integer_count":
        return value == expected and value == value.to_integral_value()
    numeric_value, numeric_expected = float(value), float(expected)
    if policy == "percentage":
        return math.isclose(numeric_value, numeric_expected, rel_tol=0.02, abs_tol=0.005)
    if policy == "correlation":
        return math.isclose(numeric_value, numeric_expected, rel_tol=0.02, abs_tol=0.02)
    if policy == "currency_or_amount":
        return math.isclose(numeric_value, numeric_expected, rel_tol=0.02, abs_tol=1000.0)
    return math.isclose(numeric_value, numeric_expected, rel_tol=0.02, abs_tol=0.01)


def assess_answer(case: dict[str, Any], answer: str) -> NumericAssessment:
    expected = case.get("structured_ground_truth")
    if isinstance(expected, bool) or not isinstance(expected, (int, float, Decimal)):
        raise TypeError("Numeric assessment requires a numeric non-boolean ground truth.")
    policy = policy_for_case(case)
    candidates = extract_candidates(answer, policy)
    expected_decimal = Decimal(str(expected))
    matched_candidate = next((candidate for candidate in candidates if _matches(candidate.value, expected_decimal, policy)), None)
    return NumericAssessment(
        policy=policy,
        candidates=tuple(candidates),
        matched=matched_candidate is not None,
        matched_candidate=matched_candidate,
        extraction_ambiguous=bool(candidates) and all(candidate.ambiguous for candidate in candidates),
    )


__all__ = ["NumericAssessment", "NumericCandidate", "assess_answer", "extract_candidates", "policy_for_case"]
