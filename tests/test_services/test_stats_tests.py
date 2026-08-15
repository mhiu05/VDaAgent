"""Test kiểm định thống kê + hiệu chỉnh đa kiểm định (Known Limitation L1).

Chạy 6 kiểm định trên cùng dataset mà báo p thô là kết luận sai về mặt thống kê.
Các test ở đây khoá lại hành vi hiệu chỉnh và tính chất toán học của nó.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.services.stats_tests import (
    TESTS,
    benjamini_hochberg,
    bonferroni,
    chi_square,
    pearson,
    run_tests,
    shapiro_wilk,
)


# --------------------------------------------------------------------------- #
# Benjamini-Hochberg
# --------------------------------------------------------------------------- #
def test_benjamini_hochberg_preserves_input_order() -> None:
    """Kết quả phải trả về theo đúng thứ tự đầu vào, không theo thứ tự đã sort."""
    p_values = [0.04, 0.001, 0.20]
    adjusted = benjamini_hochberg(p_values, alpha=0.05)

    assert len(adjusted) == 3
    # p nhỏ nhất (0.001, ở vị trí 1) phải có p điều chỉnh nhỏ nhất.
    assert adjusted[1][0] < adjusted[0][0] < adjusted[2][0]


def test_benjamini_hochberg_never_lowers_p_value() -> None:
    p_values = [0.01, 0.02, 0.03, 0.04]
    for original, (adjusted, _) in zip(p_values, benjamini_hochberg(p_values, 0.05), strict=True):
        assert adjusted >= original


def test_benjamini_hochberg_is_monotonic() -> None:
    """p đã hiệu chỉnh phải giữ tính đơn điệu theo p thô."""
    p_values = [0.001, 0.008, 0.02, 0.04, 0.3]
    adjusted = [a for a, _ in benjamini_hochberg(p_values, 0.05)]
    assert adjusted == sorted(adjusted)


def test_benjamini_hochberg_clamps_to_one() -> None:
    adjusted = benjamini_hochberg([0.5, 0.6, 0.9], alpha=0.05)
    assert all(p <= 1.0 for p, _ in adjusted)


def test_benjamini_hochberg_is_less_conservative_than_bonferroni() -> None:
    """BH có power cao hơn Bonferroni — đó là lý do chọn nó làm mặc định."""
    p_values = [0.001, 0.01, 0.02, 0.04]
    bh = [p for p, _ in benjamini_hochberg(p_values, 0.05)]
    bonf = [p for p, _ in bonferroni(p_values, 0.05)]
    assert all(a <= b for a, b in zip(bh, bonf, strict=True))


def test_benjamini_hochberg_empty_input() -> None:
    assert benjamini_hochberg([], 0.05) == []


def test_bonferroni_multiplies_by_count() -> None:
    adjusted = bonferroni([0.01, 0.02], alpha=0.05)
    assert adjusted[0][0] == pytest.approx(0.02)
    assert adjusted[1][0] == pytest.approx(0.04)


# --------------------------------------------------------------------------- #
# Từng kiểm định
# --------------------------------------------------------------------------- #
def test_shapiro_wilk_rejects_normality_for_uniform_data() -> None:
    rng = np.random.default_rng(42)
    df = pd.DataFrame({"x": rng.uniform(0, 1, 300)})
    result = shapiro_wilk(df, ["x"], alpha=0.05)
    assert result.p_value is not None
    assert result.p_value < 0.05


def test_shapiro_wilk_accepts_normality_for_gaussian_data() -> None:
    rng = np.random.default_rng(7)
    df = pd.DataFrame({"x": rng.normal(0, 1, 300)})
    result = shapiro_wilk(df, ["x"], alpha=0.05)
    assert result.p_value is not None
    assert result.p_value > 0.05


def test_pearson_finds_perfect_linear_correlation() -> None:
    df = pd.DataFrame({"a": range(50), "b": [i * 3 for i in range(50)]})
    result = pearson(df, ["a", "b"], alpha=0.05)
    assert result.test_statistic == pytest.approx(1.0)
    assert result.p_value is not None and result.p_value < 0.05


def test_chi_square_on_independent_categories() -> None:
    df = pd.DataFrame({"g": ["a", "b"] * 60, "h": ["x", "y", "x", "y"] * 30})
    result = chi_square(df, ["g", "h"], alpha=0.05)
    assert result.p_value is not None


def test_single_test_raises_on_missing_column() -> None:
    """Gọi trực tiếp một kiểm định với cột không tồn tại thì raise KeyError.

    Việc biến lỗi thành `not_applicable` là trách nhiệm của `run_tests` (test
    dưới) — ở tầng hàm đơn lẻ, lỗi phải nổ ra để không bị bỏ qua âm thầm.
    """
    df = pd.DataFrame({"a": [1.0, 2.0, 3.0, 4.0]})
    with pytest.raises(KeyError):
        shapiro_wilk(df, ["khong_ton_tai"], alpha=0.05)


def test_run_tests_converts_missing_column_into_not_applicable() -> None:
    """Trong lô, một kiểm định lỗi không được làm sập các kiểm định còn lại."""
    df = pd.DataFrame({"a": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]})
    results = run_tests(
        df,
        [
            {"test_type": "shapiro_wilk", "columns": ["khong_ton_tai"]},
            {"test_type": "shapiro_wilk", "columns": ["a"]},
        ],
    )
    assert results[0]["conclusion"] == "not_applicable"
    assert results[0]["error"]
    # Kiểm định hợp lệ vẫn chạy bình thường.
    assert results[1]["p_value"] is not None


# --------------------------------------------------------------------------- #
# run_tests — lô nhiều kiểm định
# --------------------------------------------------------------------------- #
@pytest.fixture
def stats_frame() -> pd.DataFrame:
    rng = np.random.default_rng(11)
    return pd.DataFrame(
        {
            "age": rng.integers(18, 70, 200),
            "salary": rng.normal(20_000_000, 5_000_000, 200),
            "city": rng.choice(["HN", "DN", "SG"], 200),
            "status": ["active"] * 200,
        }
    )


def test_run_tests_adds_adjusted_p_for_multiple_tests(stats_frame: pd.DataFrame) -> None:
    results = run_tests(
        stats_frame,
        [
            {"test_type": "shapiro_wilk", "columns": ["salary"]},
            {"test_type": "shapiro_wilk", "columns": ["age"]},
            {"test_type": "pearson", "columns": ["age", "salary"]},
            {"test_type": "chi_square", "columns": ["city", "status"]},
        ],
        alpha=0.05,
        fdr_method="benjamini_hochberg",
    )
    assert len(results) == 4

    real = [r for r in results if r.get("p_value") is not None]
    assert real
    for r in real:
        assert r["p_value_adjusted"] is not None
        assert r["p_value_adjusted"] >= r["p_value"]
        assert r["significant_after_correction"] is not None


def test_run_tests_single_test_needs_no_correction(stats_frame: pd.DataFrame) -> None:
    results = run_tests(
        stats_frame, [{"test_type": "shapiro_wilk", "columns": ["salary"]}], alpha=0.05
    )
    assert len(results) == 1


def test_run_tests_unknown_type_is_reported_not_raised(stats_frame: pd.DataFrame) -> None:
    results = run_tests(stats_frame, [{"test_type": "khong_ton_tai", "columns": ["age"]}])
    assert len(results) == 1
    assert results[0]["conclusion"] == "not_applicable"
    assert results[0]["error"]


def test_run_tests_enforces_max_tests_ceiling(stats_frame: pd.DataFrame) -> None:
    """Trần `max_tests` chặn một request đòi chạy quá nhiều kiểm định."""
    requests = [{"test_type": "shapiro_wilk", "columns": ["salary"]}] * 10
    assert len(run_tests(stats_frame, requests, max_tests=3)) == 3


def test_run_tests_missing_required_column_count(stats_frame: pd.DataFrame) -> None:
    """pearson cần 2 cột — đưa 1 cột thì phải báo lỗi rõ ràng."""
    results = run_tests(stats_frame, [{"test_type": "pearson", "columns": ["age"]}])
    assert results[0]["conclusion"] == "not_applicable"
    assert results[0]["error"]


def test_registry_exposes_documented_tests() -> None:
    """6 kiểm định dùng trong smoke test phải luôn có trong registry."""
    assert {
        "shapiro_wilk",
        "pearson",
        "spearman",
        "chi_square",
        "grubbs",
        "anderson_darling",
    } <= set(TESTS)
