"""LangChain tools for analyst statistical tests.

These tools mirror the statistical-test API endpoints. They accept a local CSV
path because agent tools run inside the backend workspace rather than Postman.
"""

from __future__ import annotations

import json
from pathlib import Path

from langchain_core.tools import tool

from src.models.schemas import StatisticalTestSpec
from src.profiling.service import ProfilingService


@tool
def pearson_correlation_tool(file_path: str, x_column: str, y_column: str, alpha: float = 0.05) -> str:
    """Run Pearson correlation on two numeric columns in a local CSV file."""
    try:
        result = ProfilingService().run_csv_pearson_correlation(
            Path(file_path),
            Path(file_path).name,
            x_column,
            y_column,
            alpha,
        )
        return result.model_dump_json()
    except Exception as exc:
        return f"Error running pearson_correlation: {exc}"


@tool
def spearman_correlation_tool(file_path: str, x_column: str, y_column: str, alpha: float = 0.05) -> str:
    """Run Spearman correlation on two numeric columns in a local CSV file."""
    try:
        result = ProfilingService().run_csv_spearman_correlation(
            Path(file_path),
            Path(file_path).name,
            x_column,
            y_column,
            alpha,
        )
        return result.model_dump_json()
    except Exception as exc:
        return f"Error running spearman_correlation: {exc}"


@tool
def independent_t_test_tool(
    file_path: str,
    value_column: str,
    group_column: str,
    alpha: float = 0.05,
) -> str:
    """Run Welch independent t-test on a local CSV file."""
    try:
        result = ProfilingService().run_csv_independent_t_test(
            Path(file_path),
            Path(file_path).name,
            value_column,
            group_column,
            alpha,
        )
        return result.model_dump_json()
    except Exception as exc:
        return f"Error running independent_t_test: {exc}"


@tool
def chi_square_independence_tool(
    file_path: str,
    x_column: str,
    y_column: str,
    alpha: float = 0.05,
) -> str:
    """Run chi-square independence test on two categorical columns in a local CSV file."""
    try:
        result = ProfilingService().run_csv_chi_square_independence(
            Path(file_path),
            Path(file_path).name,
            x_column,
            y_column,
            alpha,
        )
        return result.model_dump_json()
    except Exception as exc:
        return f"Error running chi_square_independence: {exc}"


@tool
def one_way_anova_tool(
    file_path: str,
    value_column: str,
    group_column: str,
    alpha: float = 0.05,
) -> str:
    """Run one-way ANOVA on a local CSV file."""
    try:
        result = ProfilingService().run_csv_one_way_anova(
            Path(file_path),
            Path(file_path).name,
            value_column,
            group_column,
            alpha,
        )
        return result.model_dump_json()
    except Exception as exc:
        return f"Error running one_way_anova: {exc}"


@tool
def statistical_tests_batch_tool(file_path: str, tests_json: str) -> str:
    """Run multiple statistical tests on a local CSV file.

    `tests_json` must be a JSON array of objects matching StatisticalTestSpec.
    """
    try:
        specs = [StatisticalTestSpec(**item) for item in json.loads(tests_json)]
        result = ProfilingService().run_csv_statistical_tests(
            Path(file_path),
            Path(file_path).name,
            specs,
        )
        return result.model_dump_json()
    except Exception as exc:
        return f"Error running statistical_tests_batch: {exc}"

