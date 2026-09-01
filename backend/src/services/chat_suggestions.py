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
) -> list[ChatSuggestion]:
    """Return a small validated set of useful next questions.

    The workspace is deliberately an argument even though profile artifacts are
    already bound elsewhere: a profile must still resolve in the same tenant
    before its aggregate metadata influences the UI.
    """

    if not profile_run_id or limit < 1:
        return []
    run = repository.get_profile_run(profile_run_id, workspace_id=workspace_id)
    if not run or run.get("status") != "completed" or repository.pending_count(profile_run_id):
        return []
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
            label=f"Why is {name} missing so often?",
            question=f"Why is {name} missing so often in this Profile Run?",
            reason="high_missingness",
            columns=[name],
        )
        add(
            label="Show columns with more than 10% missing values",
            question="Show columns with more than 10% missing values.",
            reason="missingness_overview",
        )

    numeric = [name for name, stat in stats.items() if isinstance(stat, dict) and name.casefold() not in pii and _is_numeric(stat)]
    if numeric:
        name = numeric[0]
        add(
            label=f"Show the distribution of {name}",
            question=f"Show the distribution of {name}.",
            reason="numeric_distribution",
            columns=[name],
        )
        add(
            label="Which numeric columns have outliers?",
            question="Which numeric columns have outliers?",
            reason="numeric_outliers",
        )

    try:
        keys = repository.get_proposals(profile_run_id, kind="candidate_key").get("candidate_key", [])
    except Exception:  # Optional profile signal must not affect answer delivery.
        keys = []
    for proposal in keys:
        column = proposal.get("column_name") if isinstance(proposal, dict) else None
        if isinstance(column, str) and column in known_columns and column.casefold() not in pii:
            add(
                label=f"Why is {column} a candidate key?",
                question=f"Why is {column} a candidate key? Check whether it has duplicates.",
                reason="candidate_key",
                columns=[column],
            )
            break

    if not choices:
        add(
            label="Summarize this Profile Run",
            question="Summarize the quality of this Profile Run.",
            reason="profile_overview",
        )
    return choices[: max(1, min(limit, 4))]


__all__ = ["generate_contextual_suggestions"]
