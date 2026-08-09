"""Statistical tests for analyst workflows.

The API layer handles upload parsing; this module loads CSV data with DuckDB and
uses scipy.stats for common analyst tests.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.models.schemas import StatisticalTestResult, StatisticalTestSpec
from src.profiling.result_normalizer import json_safe


class StatisticalTestService:
    def __init__(self) -> None:
        try:
            import duckdb
        except ImportError as exc:
            raise RuntimeError("Statistical tests require `pip install duckdb`.") from exc
        try:
            from scipy import stats
        except ImportError as exc:
            raise RuntimeError("Statistical tests require `pip install scipy`.") from exc

        self.duckdb = duckdb
        self.stats = stats

    def run_csv_test(
        self,
        file_path: Path,
        source_name: str,
        test_type: str,
        alpha: float = 0.05,
        x_column: str | None = None,
        y_column: str | None = None,
        value_column: str | None = None,
        group_column: str | None = None,
    ) -> StatisticalTestResult:
        normalized_test = test_type.lower().strip()
        if normalized_test == "pearson_correlation":
            return self._pearson(file_path, source_name, alpha, x_column, y_column)
        if normalized_test == "spearman_correlation":
            return self._spearman(file_path, source_name, alpha, x_column, y_column)
        if normalized_test == "independent_t_test":
            return self._independent_t_test(file_path, source_name, alpha, value_column, group_column)
        if normalized_test == "chi_square_independence":
            return self._chi_square(file_path, source_name, alpha, x_column, y_column)
        if normalized_test == "one_way_anova":
            return self._one_way_anova(file_path, source_name, alpha, value_column, group_column)
        raise ValueError(
            "Unsupported test_type. Use pearson_correlation, spearman_correlation, "
            "independent_t_test, chi_square_independence, or one_way_anova."
        )

    def run_csv_tests(
        self,
        file_path: Path,
        source_name: str,
        tests: list[StatisticalTestSpec],
    ) -> tuple[list[StatisticalTestResult], list[dict[str, str]]]:
        results: list[StatisticalTestResult] = []
        errors: list[dict[str, str]] = []
        for test in tests:
            try:
                results.append(
                    self.run_csv_test(
                        file_path=file_path,
                        source_name=source_name,
                        test_type=test.test_type,
                        alpha=test.alpha,
                        x_column=test.x_column,
                        y_column=test.y_column,
                        value_column=test.value_column,
                        group_column=test.group_column,
                    )
                )
            except Exception as exc:
                errors.append({"test_type": test.test_type, "error": str(exc)})
        return results, errors

    def pearson_correlation(
        self,
        file_path: Path,
        source_name: str,
        x_column: str,
        y_column: str,
        alpha: float = 0.05,
    ) -> StatisticalTestResult:
        return self._pearson(file_path, source_name, alpha, x_column, y_column)

    def spearman_correlation(
        self,
        file_path: Path,
        source_name: str,
        x_column: str,
        y_column: str,
        alpha: float = 0.05,
    ) -> StatisticalTestResult:
        return self._spearman(file_path, source_name, alpha, x_column, y_column)

    def independent_t_test(
        self,
        file_path: Path,
        source_name: str,
        value_column: str,
        group_column: str,
        alpha: float = 0.05,
    ) -> StatisticalTestResult:
        return self._independent_t_test(file_path, source_name, alpha, value_column, group_column)

    def chi_square_independence(
        self,
        file_path: Path,
        source_name: str,
        x_column: str,
        y_column: str,
        alpha: float = 0.05,
    ) -> StatisticalTestResult:
        return self._chi_square(file_path, source_name, alpha, x_column, y_column)

    def one_way_anova(
        self,
        file_path: Path,
        source_name: str,
        value_column: str,
        group_column: str,
        alpha: float = 0.05,
    ) -> StatisticalTestResult:
        return self._one_way_anova(file_path, source_name, alpha, value_column, group_column)

    def _pearson(
        self,
        file_path: Path,
        source_name: str,
        alpha: float,
        x_column: str | None,
        y_column: str | None,
    ) -> StatisticalTestResult:
        x_column, y_column = self._require_columns(x_column, y_column)
        rows = self._numeric_pairs(file_path, x_column, y_column)
        x_values = [row[0] for row in rows]
        y_values = [row[1] for row in rows]
        statistic, p_value = self.stats.pearsonr(x_values, y_values)
        return self._result(
            source_name,
            "pearson_correlation",
            [x_column, y_column],
            statistic,
            p_value,
            alpha,
            len(rows),
            f"Pearson correlation tests linear association between `{x_column}` and `{y_column}`.",
        )

    def _spearman(
        self,
        file_path: Path,
        source_name: str,
        alpha: float,
        x_column: str | None,
        y_column: str | None,
    ) -> StatisticalTestResult:
        x_column, y_column = self._require_columns(x_column, y_column)
        rows = self._numeric_pairs(file_path, x_column, y_column)
        x_values = [row[0] for row in rows]
        y_values = [row[1] for row in rows]
        statistic, p_value = self.stats.spearmanr(x_values, y_values)
        return self._result(
            source_name,
            "spearman_correlation",
            [x_column, y_column],
            statistic,
            p_value,
            alpha,
            len(rows),
            f"Spearman correlation tests monotonic association between `{x_column}` and `{y_column}`.",
        )

    def _independent_t_test(
        self,
        file_path: Path,
        source_name: str,
        alpha: float,
        value_column: str | None,
        group_column: str | None,
    ) -> StatisticalTestResult:
        value_column, group_column = self._require_columns(value_column, group_column)
        grouped = self._grouped_numeric_values(file_path, value_column, group_column)
        if len(grouped) != 2:
            raise ValueError("independent_t_test requires exactly 2 groups.")
        group_names = list(grouped)
        statistic, p_value = self.stats.ttest_ind(
            grouped[group_names[0]],
            grouped[group_names[1]],
            equal_var=False,
            nan_policy="omit",
        )
        groups = {str(name): len(values) for name, values in grouped.items()}
        return self._result(
            source_name,
            "independent_t_test",
            [value_column, group_column],
            statistic,
            p_value,
            alpha,
            sum(groups.values()),
            f"Welch t-test compares mean `{value_column}` across 2 groups in `{group_column}`.",
            groups,
        )

    def _chi_square(
        self,
        file_path: Path,
        source_name: str,
        alpha: float,
        x_column: str | None,
        y_column: str | None,
    ) -> StatisticalTestResult:
        x_column, y_column = self._require_columns(x_column, y_column)
        rows = self._categorical_pairs(file_path, x_column, y_column)
        contingency = self._contingency_table(rows)
        statistic, p_value, _, _ = self.stats.chi2_contingency(contingency)
        return self._result(
            source_name,
            "chi_square_independence",
            [x_column, y_column],
            statistic,
            p_value,
            alpha,
            len(rows),
            f"Chi-square test checks whether `{x_column}` and `{y_column}` are independent.",
        )

    def _one_way_anova(
        self,
        file_path: Path,
        source_name: str,
        alpha: float,
        value_column: str | None,
        group_column: str | None,
    ) -> StatisticalTestResult:
        value_column, group_column = self._require_columns(value_column, group_column)
        grouped = self._grouped_numeric_values(file_path, value_column, group_column)
        if len(grouped) < 2:
            raise ValueError("one_way_anova requires at least 2 groups.")
        statistic, p_value = self.stats.f_oneway(*grouped.values())
        groups = {str(name): len(values) for name, values in grouped.items()}
        return self._result(
            source_name,
            "one_way_anova",
            [value_column, group_column],
            statistic,
            p_value,
            alpha,
            sum(groups.values()),
            f"One-way ANOVA compares mean `{value_column}` across groups in `{group_column}`.",
            groups,
        )

    def _numeric_pairs(self, file_path: Path, x_column: str, y_column: str) -> list[tuple[float, float]]:
        query = (
            f"SELECT TRY_CAST({self._quote(x_column)} AS DOUBLE), "
            f"TRY_CAST({self._quote(y_column)} AS DOUBLE) "
            f"FROM read_csv_auto('{self._path(file_path)}', header=true, sample_size=-1) "
            f"WHERE {self._quote(x_column)} IS NOT NULL AND {self._quote(y_column)} IS NOT NULL"
        )
        rows = [(row[0], row[1]) for row in self.duckdb.sql(query).fetchall() if row[0] is not None and row[1] is not None]
        if len(rows) < 3:
            raise ValueError("Correlation tests require at least 3 non-null numeric row pairs.")
        return rows

    def _categorical_pairs(self, file_path: Path, x_column: str, y_column: str) -> list[tuple[Any, Any]]:
        query = (
            f"SELECT {self._quote(x_column)}, {self._quote(y_column)} "
            f"FROM read_csv_auto('{self._path(file_path)}', header=true, sample_size=-1) "
            f"WHERE {self._quote(x_column)} IS NOT NULL AND {self._quote(y_column)} IS NOT NULL"
        )
        rows = self.duckdb.sql(query).fetchall()
        if not rows:
            raise ValueError("Chi-square test requires non-null categorical pairs.")
        return rows

    def _grouped_numeric_values(
        self,
        file_path: Path,
        value_column: str,
        group_column: str,
    ) -> dict[Any, list[float]]:
        query = (
            f"SELECT {self._quote(group_column)}, TRY_CAST({self._quote(value_column)} AS DOUBLE) "
            f"FROM read_csv_auto('{self._path(file_path)}', header=true, sample_size=-1) "
            f"WHERE {self._quote(group_column)} IS NOT NULL AND {self._quote(value_column)} IS NOT NULL"
        )
        grouped: dict[Any, list[float]] = {}
        for group, value in self.duckdb.sql(query).fetchall():
            if value is None:
                continue
            grouped.setdefault(group, []).append(value)
        grouped = {group: values for group, values in grouped.items() if len(values) >= 2}
        if not grouped:
            raise ValueError("Grouped tests require at least one group with 2 numeric values.")
        return grouped

    def _contingency_table(self, rows: list[tuple[Any, Any]]) -> list[list[int]]:
        x_values = sorted({json_safe(row[0]) for row in rows}, key=str)
        y_values = sorted({json_safe(row[1]) for row in rows}, key=str)
        table = []
        for x_value in x_values:
            table.append(
                [
                    sum(1 for row in rows if json_safe(row[0]) == x_value and json_safe(row[1]) == y_value)
                    for y_value in y_values
                ]
            )
        return table

    def _result(
        self,
        source_name: str,
        test_type: str,
        columns: list[str],
        statistic: float,
        p_value: float,
        alpha: float,
        sample_size: int,
        base_interpretation: str,
        groups: dict[str, int] | None = None,
    ) -> StatisticalTestResult:
        significant = p_value < alpha
        interpretation = (
            f"{base_interpretation} p-value={p_value:.4g}; "
            f"{'statistically significant' if significant else 'not statistically significant'} "
            f"at alpha={alpha}."
        )
        return StatisticalTestResult(
            source_name=source_name,
            test_type=test_type,
            columns=columns,
            statistic=float(statistic),
            p_value=float(p_value),
            alpha=alpha,
            significant=significant,
            sample_size=sample_size,
            groups=groups or {},
            interpretation=interpretation,
        )

    def _require_columns(self, left: str | None, right: str | None) -> tuple[str, str]:
        if not left or not right:
            raise ValueError("This test requires two column fields.")
        return left, right

    def _quote(self, identifier: str) -> str:
        return f'"{identifier.replace(chr(34), chr(34) + chr(34))}"'

    def _path(self, file_path: Path) -> str:
        return str(file_path.resolve()).replace("\\", "/").replace("'", "''")
