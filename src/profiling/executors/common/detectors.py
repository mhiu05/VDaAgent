"""Rule-based value and PII detectors shared by executors."""

from __future__ import annotations

import re
from typing import Any


def detect_regex_patterns(values: list[Any]) -> list[dict[str, Any]]:
    patterns = {
        "email": re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"),
        "phone": re.compile(r"^\+?[0-9][0-9 .()\-]{7,}$"),
        "url": re.compile(r"^https?://[^\s/$.?#].[^\s]*$"),
        "uuid": re.compile(
            r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
            r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        ),
        "date_like": re.compile(r"^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$"),
        "time_like": re.compile(r"^\d{1,2}:\d{2}(:\d{2})?$"),
    }
    text_values = _clean_text_values(values)
    if not text_values:
        return []

    detected = []
    for name, pattern in patterns.items():
        match_count = sum(1 for value in text_values if pattern.match(value))
        confidence = match_count / len(text_values)
        if confidence >= 0.6:
            detected.append(
                {
                    "name": name,
                    "match_count": match_count,
                    "sample_size": len(text_values),
                    "confidence": confidence,
                }
            )
    return detected


def detect_pii(column_name: str, values: list[Any]) -> list[dict[str, Any]]:
    normalized_name = column_name.lower()
    detections = []
    name_rules = {
        "email": ("email", "Column name suggests email address."),
        "phone": ("phone", "Column name suggests phone number."),
        "mobile": ("phone", "Column name suggests phone number."),
        "first_name": ("person_name", "Column name suggests a person name."),
        "firstname": ("person_name", "Column name suggests a person name."),
        "last_name": ("person_name", "Column name suggests a person name."),
        "lastname": ("person_name", "Column name suggests a person name."),
        "full_name": ("person_name", "Column name suggests a person name."),
        "fullname": ("person_name", "Column name suggests a person name."),
        "person_name": ("person_name", "Column name suggests a person name."),
        "contact_name": ("person_name", "Column name suggests a person name."),
        "address": ("address", "Column name suggests a physical address."),
        "ssn": ("national_identifier", "Column name suggests national identifier."),
        "passport": ("national_identifier", "Column name suggests passport identifier."),
        "student_id": ("person_identifier", "Column name suggests student identifier."),
        "customer_id": ("person_identifier", "Column name suggests customer identifier."),
        "user_id": ("person_identifier", "Column name suggests user identifier."),
    }
    for token, (pii_type, reason) in name_rules.items():
        if token in normalized_name:
            detections.append({"pii_type": pii_type, "confidence": 0.8, "reason": reason})
            break

    text_values = _clean_text_values(values)
    value_patterns = {
        "email": re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"),
        "phone": re.compile(r"^\+?[0-9][0-9 .()\-]{7,}$"),
    }
    for pii_type, pattern in value_patterns.items():
        if not text_values:
            continue
        match_ratio = sum(1 for value in text_values if pattern.match(value)) / len(text_values)
        if match_ratio >= 0.6:
            detections.append(
                {
                    "pii_type": pii_type,
                    "confidence": match_ratio,
                    "reason": f"Sampled values match {pii_type} pattern.",
                }
            )
    return detections


def _clean_text_values(values: list[Any]) -> list[str]:
    return [str(value).strip() for value in values if value is not None and str(value).strip()]

