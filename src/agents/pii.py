"""PII detection and masking utilities for safe agent-facing outputs.

This module contains deterministic rules only. It is used before data reaches
reports, traces, HITL records, or chat summaries so raw sensitive values are not
exposed by the agent platform.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from src.models.schemas import ColumnProfile, PiiDetection, TopValue

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9 .()\-]{7,}$")
IP_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")
CARD_RE = re.compile(r"^(?:\d[ -]?){13,19}$")
DATE_OF_BIRTH_RE = re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$")
EMAIL_IN_TEXT_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_IN_TEXT_RE = re.compile(r"(?<!\w)\+?[0-9][0-9 .()\-]{7,}[0-9](?!\w)")
IP_IN_TEXT_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
CARD_IN_TEXT_RE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")


@dataclass(frozen=True)
class MaskingSummary:
    masked_value_count: int
    pii_columns: list[str]


def mask_profile_columns(columns: list[ColumnProfile]) -> MaskingSummary:
    masked_count = 0
    pii_columns: list[str] = []
    for column in columns:
        detections = _merged_detections(column)
        if not detections:
            continue
        column.pii_detection = detections
        pii_columns.append(column.name)

        masked_samples = []
        for value in column.sample_values:
            masked = mask_value(value, detections[0].pii_type)
            masked_count += int(masked != value)
            masked_samples.append(masked)
        column.sample_values = masked_samples

        masked_top_values = []
        for item in column.top_values:
            masked = mask_value(item.value, detections[0].pii_type)
            masked_count += int(masked != item.value)
            masked_top_values.append(TopValue(value=masked, count=item.count))
        column.top_values = masked_top_values

    return MaskingSummary(masked_value_count=masked_count, pii_columns=pii_columns)


def mask_value(value: Any, pii_type: str | None = None) -> Any:
    if value is None:
        return None
    text = str(value)
    pii_type = pii_type or detect_value_type(text)
    if pii_type == "email":
        return _mask_email(text)
    if pii_type == "phone":
        return _mask_keep_suffix(text, 2)
    if pii_type in {"credit_card", "national_identifier", "person_identifier"}:
        return _mask_keep_suffix(text, 4)
    if pii_type in {"person_name", "address"}:
        return "[REDACTED]"
    if pii_type == "date_of_birth":
        return "****-**-**"
    if pii_type == "ip_address":
        parts = text.split(".")
        return ".".join(parts[:2] + ["*", "*"]) if len(parts) == 4 else "[REDACTED]"
    return value


def mask_text(text: str) -> str:
    """Mask common PII embedded in free-form chat before persistence or tracing."""
    masked = EMAIL_IN_TEXT_RE.sub(lambda match: _mask_email(match.group(0)), text)
    masked = IP_IN_TEXT_RE.sub(lambda match: str(mask_value(match.group(0), "ip_address")), masked)
    masked = CARD_IN_TEXT_RE.sub(lambda match: str(mask_value(match.group(0), "credit_card")), masked)
    return PHONE_IN_TEXT_RE.sub(lambda match: str(mask_value(match.group(0), "phone")), masked)


def detect_value_type(text: str) -> str | None:
    stripped = text.strip()
    if EMAIL_RE.match(stripped):
        return "email"
    if PHONE_RE.match(stripped):
        return "phone"
    if IP_RE.match(stripped):
        return "ip_address"
    if CARD_RE.match(stripped.replace(" ", "").replace("-", "")):
        return "credit_card"
    if DATE_OF_BIRTH_RE.match(stripped):
        return "date_of_birth"
    return None


def _merged_detections(column: ColumnProfile) -> list[PiiDetection]:
    detections = list(column.pii_detection)
    detected_types = {detection.pii_type for detection in detections}
    name_detection = _detect_name_based(column.name)
    if name_detection and name_detection.pii_type not in detected_types:
        detections.append(name_detection)
        detected_types.add(name_detection.pii_type)

    values = list(column.sample_values) + [item.value for item in column.top_values]
    value_counts: dict[str, int] = {}
    for value in values:
        value_type = detect_value_type(str(value)) if value is not None else None
        if value_type:
            value_counts[value_type] = value_counts.get(value_type, 0) + 1
    total = max(len([value for value in values if value is not None]), 1)
    for pii_type, count in value_counts.items():
        confidence = count / total
        if confidence >= 0.4 and pii_type not in detected_types:
            detections.append(PiiDetection(
                pii_type=pii_type,
                confidence=confidence,
                reason=f"Sampled values match {pii_type} pattern.",
            ))
    return detections


def _detect_name_based(column_name: str) -> PiiDetection | None:
    normalized = column_name.lower()
    rules = {
        "email": "email",
        "phone": "phone",
        "mobile": "phone",
        "dob": "date_of_birth",
        "birth": "date_of_birth",
        "ip_address": "ip_address",
        "ip": "ip_address",
        "credit_card": "credit_card",
        "card_number": "credit_card",
        "ssn": "national_identifier",
        "passport": "national_identifier",
        "address": "address",
        "full_name": "person_name",
        "first_name": "person_name",
        "last_name": "person_name",
        "customer_id": "person_identifier",
        "student_id": "person_identifier",
        "user_id": "person_identifier",
    }
    for token, pii_type in rules.items():
        if token in normalized:
            return PiiDetection(
                pii_type=pii_type,
                confidence=0.8,
                reason=f"Column name suggests {pii_type}.",
            )
    return None


def _mask_email(value: str) -> str:
    match = EMAIL_RE.match(value)
    if not match:
        return "[REDACTED_EMAIL]"
    local, domain = value.split("@", 1)
    prefix = local[:2] if len(local) >= 2 else local[:1]
    return f"{prefix}***@{domain}"


def _mask_keep_suffix(value: str, suffix_length: int) -> str:
    digits = re.sub(r"\D", "", value)
    if not digits:
        return "[REDACTED]"
    suffix = digits[-suffix_length:]
    return f"{'*' * max(len(digits) - suffix_length, 4)}{suffix}"
