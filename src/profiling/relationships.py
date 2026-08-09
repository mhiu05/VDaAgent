"""Infer candidate relationships across profiled files, sheets, or tables.

CSV/Excel sources do not carry database constraints, so every relationship here
is a HITL candidate that must be confirmed before being treated as metadata.
"""

from __future__ import annotations

from collections import defaultdict

from src.models.schemas import ColumnProfile, InferredRelationship, ProfileResult
from src.profiling.planner import is_identifier_column


def infer_relationships(profiles: list[ProfileResult]) -> list[InferredRelationship]:
    candidates: list[InferredRelationship] = []
    by_normalized_name: dict[str, list[tuple[ProfileResult, ColumnProfile]]] = defaultdict(list)

    for profile in profiles:
        for column in profile.columns:
            key = _normalize_column_name(column.name)
            if _is_relationship_candidate(column):
                by_normalized_name[key].append((profile, column))

    for grouped_columns in by_normalized_name.values():
        for index, (left_profile, left_column) in enumerate(grouped_columns):
            for right_profile, right_column in grouped_columns[index + 1 :]:
                if left_profile.source.name == right_profile.source.name:
                    continue
                candidates.append(_build_relationship(left_profile, left_column, right_profile, right_column))

    return sorted(candidates, key=lambda item: item.confidence, reverse=True)


def _build_relationship(
    left_profile: ProfileResult,
    left_column: ColumnProfile,
    right_profile: ProfileResult,
    right_column: ColumnProfile,
) -> InferredRelationship:
    left_unique = _is_unique_like(left_column)
    right_unique = _is_unique_like(right_column)
    if left_unique and not right_unique:
        relationship_type = "one_to_many"
        confidence = 0.85
    elif right_unique and not left_unique:
        relationship_type = "many_to_one"
        confidence = 0.85
    elif left_unique and right_unique:
        relationship_type = "one_to_one"
        confidence = 0.75
    else:
        relationship_type = "many_to_many_or_lookup"
        confidence = 0.55

    if is_identifier_column(left_column.name) or is_identifier_column(right_column.name):
        confidence = min(confidence + 0.1, 0.95)

    return InferredRelationship(
        left_source=left_profile.source.name,
        left_column=left_column.name,
        right_source=right_profile.source.name,
        right_column=right_column.name,
        relationship_type=relationship_type,
        confidence=confidence,
        evidence=(
            "Columns share the same normalized name and have compatible "
            "cardinality patterns; no database constraint is present."
        ),
        hitl_required=True,
    )


def _is_relationship_candidate(column: ColumnProfile) -> bool:
    if column.distinct_count == 0:
        return False
    return is_identifier_column(column.name) or _normalize_column_name(column.name).endswith("id")


def _is_unique_like(column: ColumnProfile) -> bool:
    return column.distinct_ratio >= 0.95


def _normalize_column_name(column_name: str) -> str:
    return "".join(ch for ch in column_name.lower() if ch.isalnum())

