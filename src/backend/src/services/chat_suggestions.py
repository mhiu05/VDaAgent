"""Deterministic, profile-scoped follow-up suggestions for Chat P2.

Suggestions are generated after a validated answer leaves the critical path.
They use only aggregate Profile Run metadata and reject PII/pending columns;
there is intentionally no model-generated action path in this release.
"""

from __future__ import annotations

import re
from typing import Any

from src.models.schemas import ChatSuggestion


def _suggestion_id(reason: str, column: str | None = None) -> str:
    value = f"{reason}-{column or 'profile'}".casefold()
    return re.sub(r"[^a-z0-9_-]+", "-", value).strip("-")[:96]


def _is_numeric(stat: dict[str, Any]) -> bool:
    dtype = str(stat.get("dtype") or "").casefold()
    return any(token in dtype for token in ("int", "float", "double", "decimal", "number"))


def generate_contextual_suggestions(
    repository: Any,
    *,
    workspace_id: str,
    profile_run_id: str | None,
    limit: int = 4,
    profile_context: dict[str, Any] | None = None,
) -> list[ChatSuggestion]:
    """Return a small validated set of useful next questions.

    The workspace is deliberately an argument even though profile artifacts are
    already bound elsewhere: a profile must still resolve in the same tenant
    before its aggregate metadata influences the UI.
    """

    if not profile_run_id or limit < 1:
        return []
    context = profile_context or {}
    run = context.get("run") or repository.get_profile_run(
        profile_run_id, workspace_id=workspace_id
    )
    pending = (
        bool(context["has_pending_proposals"])
        if "has_pending_proposals" in context
        else bool(repository.pending_count(profile_run_id))
    )
    if not run or run.get("status") != "completed" or pending:
        return []
    stats = context.get("column_stats")
    if not isinstance(stats, dict):
        stats = repository.get_column_stats(profile_run_id)
    pii = {str(value).casefold() for value in repository.confirmed_pii_columns(profile_run_id)}
    known_columns = {str(name) for name in stats}
    choices: list[ChatSuggestion] = []

    def add(*, label: str, question: str, reason: str, columns: list[str] | None = None) -> None:
        referenced = [column for column in (columns or []) if column in known_columns and column.casefold() not in pii]
        # A column-specific proposal must have survived the allow-list. Generic
        # profile questions have no referenced columns and remain safe.
        if columns and len(referenced) != len(columns):
            return
        suggestion = ChatSuggestion(
            id=_suggestion_id(reason, referenced[0] if referenced else None),
            label=label,
            question=question,
            referenced_columns=referenced,
            source_reason=reason,
        )
        if not any(item.id == suggestion.id for item in choices):
            choices.append(suggestion)

    missing = sorted(
        (
            (name, float(stat.get("null_pct") or 0))
            for name, stat in stats.items()
            if isinstance(stat, dict) and name.casefold() not in pii
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    if missing and missing[0][1] >= 10:
        name, percentage = missing[0]
        add(
            label=f"Kiểm tra mức độ thiếu dữ liệu của cột {name}",
            question=f"Mức độ thiếu dữ liệu của cột {name} trong Profile Run này là bao nhiêu?",
            reason="high_missingness",
            columns=[name],
        )
        add(
            label="Liệt kê các cột có trên 10% dữ liệu thiếu",
            question="Liệt kê các cột có trên 10% dữ liệu thiếu.",
            reason="missingness_overview",
        )

    numeric = [name for name, stat in stats.items() if isinstance(stat, dict) and name.casefold() not in pii and _is_numeric(stat)]
    if numeric:
        name = numeric[0]
        add(
            label=f"Hiển thị phân phối của cột {name}",
            question=f"Hiển thị phân phối của cột {name}.",
            reason="numeric_distribution",
            columns=[name],
        )
        add(
            label="Cột số nào có outlier?",
            question="Cột số nào có outlier?",
            reason="numeric_outliers",
        )

    keys: list[dict[str, Any]] = []
    if len(choices) < limit:
        try:
            keys = repository.get_proposals(profile_run_id, kind="candidate_key").get("candidate_key", [])
        except Exception:  # Optional profile signal must not affect answer delivery.
            keys = []
    for proposal in keys:
        column = proposal.get("column_name") if isinstance(proposal, dict) else None
        if isinstance(column, str) and column in known_columns and column.casefold() not in pii:
            add(
                label=f"Kiểm tra bằng chứng candidate key của cột {column}",
                question=f"Kiểm tra bằng chứng candidate key của cột {column} và số bản ghi trùng.",
                reason="candidate_key",
                columns=[column],
            )
            break

    if not choices:
        add(
            label="Tóm tắt chất lượng của Profile Run này",
            question="Tóm tắt chất lượng của Profile Run này.",
            reason="profile_overview",
        )
    return choices[: max(1, min(limit, 4))]


__all__ = ["generate_contextual_suggestions"]
