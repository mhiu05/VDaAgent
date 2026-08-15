"""Kiểm định thống kê cho node `deep_analysis`.

Mọi kiểm định chạy bằng scipy — LLM chỉ đọc `p_value` / `conclusion` rồi diễn
đạt. Khi Analyst yêu cầu nhiều kiểm định trong một lượt, kết quả được hiệu chỉnh
multiple-testing bằng Benjamini-Hochberg (Known Limitation L1): chạy 20 kiểm
định ở alpha = 0.05 thì kỳ vọng ~1 kết quả "có ý nghĩa" hoàn toàn do nhiễu.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats as sps

# --------------------------------------------------------------------------- #


@dataclass
class TestResult:
    """Một kết quả kiểm định. Khớp bảng `statistical_test_results`."""

    test_type: str
    target_columns: list[str]
    test_statistic: float | None
    p_value: float | None
    conclusion: str
    interpretation: str
    alpha: float
    extra: dict[str, Any] = field(default_factory=dict)
    p_value_adjusted: float | None = None
    significant_after_correction: bool | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _fail(test_type: str, columns: list[str], message: str, alpha: float) -> TestResult:
    return TestResult(
        test_type=test_type,
        target_columns=columns,
        test_statistic=None,
        p_value=None,
        conclusion="not_applicable",
        interpretation=message,
        alpha=alpha,
        error=message,
    )


def _numeric(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        raise KeyError(f"Không có cột '{col}' trong dataset.")
    series = pd.to_numeric(df[col], errors="coerce").dropna()
    if series.empty:
        raise ValueError(f"Cột '{col}' không có giá trị số hợp lệ.")
    return series


def _conclusion(p_value: float, alpha: float) -> str:
    return "reject_h0" if p_value < alpha else "fail_to_reject"


# --------------------------------------------------------------------------- #
# Kiểm định phân phối
# --------------------------------------------------------------------------- #
def shapiro_wilk(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """H0: cột tuân theo phân phối chuẩn."""
    x = _numeric(df, columns[0])
    # scipy khuyến cáo Shapiro không đáng tin khi n > 5000 -> lấy mẫu con.
    if len(x) > 5000:
        x = x.sample(5000, random_state=42)
    stat, p = sps.shapiro(x)
    return TestResult(
        test_type="shapiro_wilk",
        target_columns=columns[:1],
        test_statistic=float(stat),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"p = {p:.4g} < {alpha} → dữ liệu KHÔNG theo phân phối chuẩn."
            if p < alpha
            else f"p = {p:.4g} ≥ {alpha} → chưa đủ bằng chứng bác bỏ phân phối chuẩn."
        ),
        alpha=alpha,
        extra={"n": len(x)},
    )


def anderson_darling(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """H0: cột theo phân phối chuẩn. Anderson-Darling trả critical value, không p."""
    x = _numeric(df, columns[0])
    result = sps.anderson(x, dist="norm")
    # So statistic với critical value ở mức 5% (index 2 trong significance_level).
    levels = list(result.significance_level)
    idx = levels.index(5.0) if 5.0 in levels else 2
    critical = float(result.critical_values[idx])
    rejected = float(result.statistic) > critical
    return TestResult(
        test_type="anderson_darling",
        target_columns=columns[:1],
        test_statistic=float(result.statistic),
        p_value=None,
        conclusion="reject_h0" if rejected else "fail_to_reject",
        interpretation=(
            f"A² = {result.statistic:.4f} {'>' if rejected else '≤'} giá trị tới hạn {critical:.4f} "
            f"ở mức 5% → {'KHÔNG' if rejected else 'chưa bác bỏ được'} phân phối chuẩn."
        ),
        alpha=alpha,
        extra={"critical_value_5pct": critical, "n": len(x)},
    )


def ks_test(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """1 cột: so với phân phối chuẩn. 2 cột: so 2 phân phối với nhau."""
    if len(columns) >= 2:
        a, b = _numeric(df, columns[0]), _numeric(df, columns[1])
        stat, p = sps.ks_2samp(a, b)
        detail = f"Hai cột '{columns[0]}' và '{columns[1]}'"
    else:
        x = _numeric(df, columns[0])
        std = x.std()
        if not std or std == 0:
            raise ValueError(f"Cột '{columns[0]}' có độ lệch chuẩn = 0, không kiểm định được.")
        stat, p = sps.kstest((x - x.mean()) / std, "norm")
        detail = f"Cột '{columns[0]}' so với phân phối chuẩn"
    return TestResult(
        test_type="ks_test",
        target_columns=columns[:2],
        test_statistic=float(stat),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"{detail}: p = {p:.4g} "
            + ("< alpha → phân phối KHÁC nhau." if p < alpha else "≥ alpha → chưa thấy khác biệt.")
        ),
        alpha=alpha,
    )


# --------------------------------------------------------------------------- #
# So sánh nhóm
# --------------------------------------------------------------------------- #
def t_test(df: pd.DataFrame, columns: list[str], alpha: float, **params: Any) -> TestResult:
    """H0: hai cột số có trung bình bằng nhau (Welch — không giả định cùng phương sai)."""
    a, b = _numeric(df, columns[0]), _numeric(df, columns[1])
    stat, p = sps.ttest_ind(a, b, equal_var=bool(params.get("equal_var", False)))
    return TestResult(
        test_type="t_test",
        target_columns=columns[:2],
        test_statistic=float(stat),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"Trung bình '{columns[0]}' = {a.mean():.4g}, '{columns[1]}' = {b.mean():.4g}; "
            f"p = {p:.4g} "
            + ("< alpha → khác biệt có ý nghĩa." if p < alpha else "≥ alpha → chưa có khác biệt.")
        ),
        alpha=alpha,
        extra={"mean_a": float(a.mean()), "mean_b": float(b.mean())},
    )


def mann_whitney(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """Phi tham số thay cho t-test khi dữ liệu không chuẩn."""
    a, b = _numeric(df, columns[0]), _numeric(df, columns[1])
    stat, p = sps.mannwhitneyu(a, b, alternative="two-sided")
    return TestResult(
        test_type="mann_whitney",
        target_columns=columns[:2],
        test_statistic=float(stat),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"Median '{columns[0]}' = {a.median():.4g}, '{columns[1]}' = {b.median():.4g}; "
            f"p = {p:.4g} "
            + ("< alpha → phân phối lệch nhau." if p < alpha else "≥ alpha → chưa thấy lệch.")
        ),
        alpha=alpha,
    )


def _grouped(df: pd.DataFrame, value_col: str, group_col: str) -> list[np.ndarray]:
    """Tách cột giá trị theo nhóm; bỏ nhóm có < 2 quan sát."""
    frame = df[[value_col, group_col]].dropna()
    frame[value_col] = pd.to_numeric(frame[value_col], errors="coerce")
    frame = frame.dropna()
    groups = [g[value_col].to_numpy() for _, g in frame.groupby(group_col) if len(g) >= 2]
    if len(groups) < 2:
        raise ValueError(f"Cần ít nhất 2 nhóm có ≥2 quan sát trong '{group_col}'.")
    return groups


def anova(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """H0: trung bình các nhóm bằng nhau. columns = [cột_giá_trị, cột_nhóm]."""
    groups = _grouped(df, columns[0], columns[1])
    stat, p = sps.f_oneway(*groups)
    return TestResult(
        test_type="anova",
        target_columns=columns[:2],
        test_statistic=float(stat),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"So sánh '{columns[0]}' giữa {len(groups)} nhóm của '{columns[1]}': p = {p:.4g} "
            + ("< alpha → có nhóm khác biệt." if p < alpha else "≥ alpha → chưa thấy khác biệt.")
        ),
        alpha=alpha,
        extra={"n_groups": len(groups)},
    )


def kruskal_wallis(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """Phi tham số thay cho ANOVA."""
    groups = _grouped(df, columns[0], columns[1])
    stat, p = sps.kruskal(*groups)
    return TestResult(
        test_type="kruskal_wallis",
        target_columns=columns[:2],
        test_statistic=float(stat),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"So sánh phân phối '{columns[0]}' giữa {len(groups)} nhóm: p = {p:.4g} "
            + ("< alpha → có nhóm lệch." if p < alpha else "≥ alpha → chưa thấy lệch.")
        ),
        alpha=alpha,
        extra={"n_groups": len(groups)},
    )


# --------------------------------------------------------------------------- #
# Liên hệ giữa hai biến
# --------------------------------------------------------------------------- #
def _paired(df: pd.DataFrame, columns: list[str]) -> tuple[pd.Series, pd.Series]:
    frame = df[[columns[0], columns[1]]].apply(pd.to_numeric, errors="coerce").dropna()
    if len(frame) < 3:
        raise ValueError("Cần ít nhất 3 cặp giá trị hợp lệ.")
    return frame[columns[0]], frame[columns[1]]


def pearson(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """H0: hệ số tương quan Pearson = 0 (quan hệ tuyến tính)."""
    a, b = _paired(df, columns)
    r, p = sps.pearsonr(a, b)
    return TestResult(
        test_type="pearson",
        target_columns=columns[:2],
        test_statistic=float(r),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"r = {r:.4f} (n = {len(a)}), p = {p:.4g} "
            + ("< alpha → tương quan có ý nghĩa." if p < alpha else "≥ alpha → chưa có ý nghĩa.")
            + " Tương quan KHÔNG đồng nghĩa nhân quả."
        ),
        alpha=alpha,
        extra={"n": len(a)},
    )


def spearman(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """Tương quan hạng — dùng khi quan hệ đơn điệu nhưng không tuyến tính."""
    a, b = _paired(df, columns)
    rho, p = sps.spearmanr(a, b)
    return TestResult(
        test_type="spearman",
        target_columns=columns[:2],
        test_statistic=float(rho),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"rho = {rho:.4f} (n = {len(a)}), p = {p:.4g} "
            + ("< alpha → tương quan hạng có ý nghĩa." if p < alpha else "≥ alpha → chưa có ý nghĩa.")
        ),
        alpha=alpha,
        extra={"n": len(a)},
    )


def chi_square(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """H0: hai biến phân loại độc lập. Kèm Cramér's V làm effect size."""
    table = pd.crosstab(df[columns[0]], df[columns[1]])
    if table.shape[0] < 2 or table.shape[1] < 2:
        raise ValueError("Bảng chéo cần tối thiểu 2x2.")
    chi2, p, dof, expected = sps.chi2_contingency(table)
    n = int(table.to_numpy().sum())
    min_dim = min(table.shape) - 1
    cramers_v = float(np.sqrt(chi2 / (n * min_dim))) if n and min_dim else None
    low_expected = int((expected < 5).sum())
    return TestResult(
        test_type="chi_square",
        target_columns=columns[:2],
        test_statistic=float(chi2),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"chi2 = {chi2:.4f}, dof = {dof}, p = {p:.4g} "
            + ("< alpha → hai biến KHÔNG độc lập." if p < alpha else "≥ alpha → chưa thấy liên hệ.")
            + (f" Cramér's V = {cramers_v:.4f}." if cramers_v is not None else "")
            + (
                f" Lưu ý: {low_expected} ô có tần số kỳ vọng < 5, kết quả có thể không đáng tin."
                if low_expected
                else ""
            )
        ),
        alpha=alpha,
        extra={"dof": int(dof), "cramers_v": cramers_v, "cells_expected_below_5": low_expected},
    )


# --------------------------------------------------------------------------- #
# Outlier & chuỗi thời gian
# --------------------------------------------------------------------------- #
def grubbs(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """H0: không có outlier. Chỉ phát hiện MỘT outlier cực trị, cần n ≥ 7."""
    x = _numeric(df, columns[0])
    n = len(x)
    if n < 7:
        raise ValueError("Grubbs cần ít nhất 7 quan sát.")
    std = x.std(ddof=1)
    if not std or std == 0:
        raise ValueError("Độ lệch chuẩn = 0, không có outlier.")
    g = float((x - x.mean()).abs().max() / std)
    t_crit = sps.t.ppf(1 - alpha / (2 * n), n - 2)
    critical = float((n - 1) / np.sqrt(n) * np.sqrt(t_crit**2 / (n - 2 + t_crit**2)))
    rejected = g > critical
    return TestResult(
        test_type="grubbs",
        target_columns=columns[:1],
        test_statistic=g,
        p_value=None,
        conclusion="reject_h0" if rejected else "fail_to_reject",
        interpretation=(
            f"G = {g:.4f} {'>' if rejected else '≤'} giá trị tới hạn {critical:.4f} → "
            + ("có outlier cực trị." if rejected else "chưa phát hiện outlier cực trị.")
        ),
        alpha=alpha,
        extra={"critical_value": critical, "n": n},
    )


def adf_test(df: pd.DataFrame, columns: list[str], alpha: float, **_: Any) -> TestResult:
    """H0: chuỗi KHÔNG dừng (có unit root). Cần statsmodels."""
    try:
        from statsmodels.tsa.stattools import adfuller
    except ImportError as exc:  # pragma: no cover - phụ thuộc tuỳ chọn
        raise ValueError("Kiểm định ADF cần statsmodels: pip install 'p170[stats]'.") from exc

    x = _numeric(df, columns[0])
    if len(x) < 20:
        raise ValueError("ADF cần ít nhất 20 quan sát.")
    stat, p, used_lag, nobs, crit, _ = adfuller(x.to_numpy())
    return TestResult(
        test_type="adf",
        target_columns=columns[:1],
        test_statistic=float(stat),
        p_value=float(p),
        conclusion=_conclusion(p, alpha),
        interpretation=(
            f"ADF = {stat:.4f}, p = {p:.4g} "
            + ("< alpha → chuỗi DỪNG." if p < alpha else "≥ alpha → chuỗi chưa dừng.")
        ),
        alpha=alpha,
        extra={"used_lag": int(used_lag), "nobs": int(nobs), "critical_values": dict(crit)},
    )


# --------------------------------------------------------------------------- #
# Registry + hiệu chỉnh multiple testing
# --------------------------------------------------------------------------- #
TESTS: dict[str, Callable[..., TestResult]] = {
    "shapiro_wilk": shapiro_wilk,
    "anderson_darling": anderson_darling,
    "ks_test": ks_test,
    "t_test": t_test,
    "mann_whitney": mann_whitney,
    "anova": anova,
    "kruskal_wallis": kruskal_wallis,
    "pearson": pearson,
    "spearman": spearman,
    "chi_square": chi_square,
    "grubbs": grubbs,
    "adf": adf_test,
}

# Số cột tối thiểu mỗi kiểm định cần — validate trước khi chạy để báo lỗi rõ ràng.
REQUIRED_COLUMNS: dict[str, int] = {
    "shapiro_wilk": 1,
    "anderson_darling": 1,
    "ks_test": 1,
    "t_test": 2,
    "mann_whitney": 2,
    "anova": 2,
    "kruskal_wallis": 2,
    "pearson": 2,
    "spearman": 2,
    "chi_square": 2,
    "grubbs": 1,
    "adf": 1,
}


def benjamini_hochberg(p_values: list[float], alpha: float) -> list[tuple[float, bool]]:
    """Hiệu chỉnh FDR Benjamini-Hochberg.

    Trả về [(p_adjusted, significant)] theo đúng thứ tự đầu vào.
    """
    m = len(p_values)
    if m == 0:
        return []
    order = sorted(range(m), key=lambda i: p_values[i])
    adjusted = [0.0] * m
    prev = 1.0
    # Đi từ p lớn nhất về nhỏ nhất, giữ tính đơn điệu của p đã hiệu chỉnh.
    for rank, idx in enumerate(reversed(order), start=1):
        i = m - rank + 1
        value = min(prev, p_values[idx] * m / i)
        adjusted[idx] = min(1.0, value)
        prev = adjusted[idx]
    return [(adjusted[i], adjusted[i] < alpha) for i in range(m)]


def bonferroni(p_values: list[float], alpha: float) -> list[tuple[float, bool]]:
    m = len(p_values)
    if m == 0:
        return []
    return [(min(1.0, p * m), min(1.0, p * m) < alpha) for p in p_values]


def run_tests(
    df: pd.DataFrame,
    requests: list[dict[str, Any]],
    alpha: float = 0.05,
    fdr_method: str = "benjamini_hochberg",
    max_tests: int = 20,
) -> list[dict[str, Any]]:
    """Chạy danh sách kiểm định rồi hiệu chỉnh multiple testing (L1).

    Mỗi request: ``{"test_type": str, "columns": list[str], "params": dict}``.
    Kiểm định lỗi không làm sập cả lô — trả về `conclusion="not_applicable"`.
    """
    results: list[TestResult] = []

    for request in requests[:max_tests]:
        test_type = str(request.get("test_type", "")).strip()
        columns = [str(c) for c in request.get("columns", [])]
        params = request.get("params") or {}

        fn = TESTS.get(test_type)
        if fn is None:
            results.append(
                _fail(
                    test_type or "unknown",
                    columns,
                    f"Không hỗ trợ kiểm định '{test_type}'. Các lựa chọn: {', '.join(sorted(TESTS))}.",
                    alpha,
                )
            )
            continue

        needed = REQUIRED_COLUMNS.get(test_type, 1)
        if len(columns) < needed:
            results.append(
                _fail(test_type, columns, f"Kiểm định '{test_type}' cần {needed} cột.", alpha)
            )
            continue

        missing = [c for c in columns[:needed] if c not in df.columns]
        if missing:
            results.append(
                _fail(test_type, columns, f"Dataset không có cột: {', '.join(missing)}.", alpha)
            )
            continue

        try:
            results.append(fn(df, columns, alpha, **params))
        except (ValueError, KeyError, TypeError, ZeroDivisionError) as exc:
            results.append(_fail(test_type, columns, str(exc), alpha))

    # Hiệu chỉnh chỉ áp dụng cho kiểm định có p-value thật.
    indexed = [(i, r) for i, r in enumerate(results) if r.p_value is not None]
    if len(indexed) > 1 and fdr_method != "none":
        p_values = [r.p_value for _, r in indexed]
        correct = benjamini_hochberg if fdr_method == "benjamini_hochberg" else bonferroni
        for (i, _), (p_adj, significant) in zip(indexed, correct(p_values, alpha), strict=True):
            # KHÔNG round() ở đây: p điều chỉnh thường nhỏ hơn 1e-8 (shapiro_wilk
            # trên cột có outlier lớn cho p ~ 1e-10), và round(...,8) biến nó
            # thành 0.0 — đọc ra là "p = 0", đồng thời phá bất biến
            # `p_adjusted >= p_value`. Giữ nguyên float, để tầng hiển thị tự
            # format bằng %.4g.
            results[i].p_value_adjusted = p_adj
            results[i].significant_after_correction = significant
            if not significant and results[i].conclusion == "reject_h0":
                results[i].interpretation += (
                    f" Sau hiệu chỉnh {fdr_method} cho {len(p_values)} kiểm định "
                    f"(p điều chỉnh = {p_adj:.4g}), kết quả KHÔNG còn ý nghĩa thống kê."
                )

    return [r.to_dict() for r in results]


__all__ = [
    "REQUIRED_COLUMNS",
    "TESTS",
    "TestResult",
    "benjamini_hochberg",
    "bonferroni",
    "run_tests",
]
