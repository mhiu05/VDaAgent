"""Read-only statistical-test discovery and result tools."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
from src.agents.tools.common import (
    DEFAULT_LIMIT,
    active_run,
    column_stats,
    error,
    ok,
    page,
    resolve_column,
)
from src.services.repository import get_repository
from src.services.stats_tests import REQUIRED_COLUMNS, TESTS


@tool
def list_available_tests() -> dict[str, Any]:
    """List allowed statistical tests; this tool never executes a test."""
    run_id, run = active_run("list_available_tests")
    if not run:
        return error(
            "list_available_tests", "not_found", "Active profile run was not found."
        )
    data = [
        {
            "test_type": name,
            "required_columns": REQUIRED_COLUMNS[name],
            "preconditions": "Columns must meet the test data-type and sample-size requirements.",
        }
        for name in sorted(TESTS)
    ]
    return ok(
        "list_available_tests",
        run_id,
        run,
        {"tests": data},
        artifact="stats_tests_allowlist",
    )


@tool
def get_test_results(
    test_type: str = "",
    column_name: str = "",
    conclusion: str = "",
    significance: bool | None = None,
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    """Read persisted test results with bounded filters."""
    run_id, run = active_run("get_test_results")
    if not run:
        return error(
            "get_test_results", "not_found", "Active profile run was not found."
        )
    rows = get_repository().get_test_results(run_id)
    rows = [
        row
        for row in rows
        if (not test_type or row.get("test_type") == test_type)
        and (
            not column_name
            or column_name.casefold()
            in [str(column).casefold() for column in row.get("target_columns", [])]
        )
        and (not conclusion or row.get("conclusion") == conclusion)
        and (
            significance is None
            or row.get("significant_after_correction") == significance
        )
    ]
    selected, pagination = page(rows, limit, cursor)
    return ok(
        "get_test_results",
        run_id,
        run,
        {"results": selected},
        artifact="statistical_test_results",
        page=pagination,
    )


@tool
def recommend_tests(column_names: list[str]) -> dict[str, Any]:
    """Recommend allowed tests deterministically; does not run them."""
    run_id, run = active_run("recommend_tests")
    if not run:
        return error(
            "recommend_tests", "not_found", "Active profile run was not found."
        )
    resolved = [resolve_column(column_stats(run_id), name) for name in column_names]
    if not resolved or any(item is None for item in resolved):
        return error(
            "recommend_tests", "not_found", "One or more columns were not found."
        )
    dtypes = [str(item[1].get("dtype", "")).lower() for item in resolved if item]
    numeric = all(
        any(token in dtype for token in ("int", "float", "number")) for dtype in dtypes
    )
    tests: list[str] = []
    if len(resolved) == 1 and numeric:
        tests = ["shapiro_wilk", "anderson_darling", "grubbs"]
    elif len(resolved) == 2 and numeric:
        tests = ["pearson", "spearman", "t_test", "mann_whitney"]
    elif len(resolved) == 2:
        tests = ["chi_square"]
    return ok(
        "recommend_tests",
        run_id,
        run,
        {
            "columns": [item[0] for item in resolved if item],
            "recommended_tests": tests,
            "reason": "Selected deterministically from persisted dtype metadata; analyst approval is required to execute tests.",
        },
        artifact="column_stats",
    )


TEST_TOOLS = [list_available_tests, get_test_results, recommend_tests]

__all__ = [
    "TEST_TOOLS",
    "get_test_results",
    "list_available_tests",
    "recommend_tests",
]
