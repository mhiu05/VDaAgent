"""So sánh hai ProfileRun để phát hiện drift.

Ba chỉ số, chọn theo loại cột:
    - PSI (Population Stability Index) trên phân phối top-k của cột phân loại.
    - Chênh lệch tương đối của mean/std/null_pct cho cột số.
    - Cảnh báo schema: cột mới xuất hiện / cột biến mất / dtype đổi.

Tính hoàn toàn từ `column_stats` đã lưu — không cần load lại dữ liệu gốc.
"""

from __future__ import annotations

import math
from typing import Any

# Ngưỡng PSI theo thông lệ ngành credit risk.
PSI_MINOR = 0.1
PSI_MAJOR = 0.25

# Cột số: lệch tương đối vượt ngưỡng này thì báo drift.
NUMERIC_SHIFT_THRESHOLD = 0.2
NULL_PCT_SHIFT_THRESHOLD = 5.0  # điểm phần trăm


def _distribution(top_k: Any) -> dict[str, float]:
    """Đổi top_k_values thành phân phối xác suất theo giá trị."""
    if not isinstance(top_k, list):
        return {}
    counts = {
        str(item.get("value")): float(item.get("count") or 0)
        for item in top_k
        if isinstance(item, dict) and item.get("count") is not None
    }
    total = sum(counts.values())
    if total <= 0:
        return {}
    return {k: v / total for k, v in counts.items()}


def population_stability_index(expected: dict[str, float], actual: dict[str, float]) -> float | None:
    """PSI = Σ (a - e) * ln(a / e). Epsilon tránh chia 0 khi một bên thiếu giá trị."""
    if not expected or not actual:
        return None
    eps = 1e-6
    psi = 0.0
    for key in set(expected) | set(actual):
        e = max(expected.get(key, 0.0), eps)
        a = max(actual.get(key, 0.0), eps)
        psi += (a - e) * math.log(a / e)
    return round(psi, 6)


def _relative_shift(before: Any, after: Any) -> float | None:
    """Chênh lệch tương đối. Giá trị gốc = 0 thì trả None (không định nghĩa được)."""
    try:
        b, a = float(before), float(after)
    except (TypeError, ValueError):
        return None
    if b == 0:
        return None if a == 0 else 1.0
    return round(abs(a - b) / abs(b), 6)


def compare_runs(
    stats_a: list[dict[str, Any]],
    stats_b: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str]:
    """So sánh column_stats của run A (cũ) và run B (mới).

    Trả về (danh sách drift theo cột, tóm tắt bằng tiếng Việt).
    """
    by_a = {s["column_name"]: s for s in stats_a}
    by_b = {s["column_name"]: s for s in stats_b}

    drift: list[dict[str, Any]] = []

    for name in sorted(set(by_a) - set(by_b)):
        drift.append(
            {
                "column_name": name,
                "drift_type": "column_removed",
                "severity": "major",
                "detail": "Cột có ở run trước nhưng không còn ở run này.",
            }
        )
    for name in sorted(set(by_b) - set(by_a)):
        drift.append(
            {
                "column_name": name,
                "drift_type": "column_added",
                "severity": "minor",
                "detail": "Cột mới xuất hiện ở run này.",
            }
        )

    for name in sorted(set(by_a) & set(by_b)):
        a, b = by_a[name], by_b[name]

        if a.get("dtype") != b.get("dtype"):
            drift.append(
                {
                    "column_name": name,
                    "drift_type": "dtype_changed",
                    "severity": "major",
                    "detail": f"dtype đổi từ {a.get('dtype')} sang {b.get('dtype')}.",
                }
            )

        null_a, null_b = a.get("null_pct"), b.get("null_pct")
        if null_a is not None and null_b is not None:
            delta = abs(float(null_b) - float(null_a))
            if delta >= NULL_PCT_SHIFT_THRESHOLD:
                drift.append(
                    {
                        "column_name": name,
                        "drift_type": "null_rate_shift",
                        "severity": "major" if delta >= 2 * NULL_PCT_SHIFT_THRESHOLD else "minor",
                        "metric": "null_pct",
                        "before": null_a,
                        "after": null_b,
                        "detail": f"null% đổi từ {null_a:.2f}% sang {null_b:.2f}% (lệch {delta:.2f} điểm).",
                    }
                )

        for metric in ("mean", "std", "cardinality"):
            shift = _relative_shift(a.get(metric), b.get(metric))
            if shift is not None and shift >= NUMERIC_SHIFT_THRESHOLD:
                drift.append(
                    {
                        "column_name": name,
                        "drift_type": "numeric_shift",
                        "severity": "major" if shift >= 0.5 else "minor",
                        "metric": metric,
                        "before": a.get(metric),
                        "after": b.get(metric),
                        "detail": f"{metric} lệch {shift:.1%} so với run trước.",
                    }
                )

        psi = population_stability_index(
            _distribution(a.get("top_k_values")), _distribution(b.get("top_k_values"))
        )
        if psi is not None and psi >= PSI_MINOR:
            drift.append(
                {
                    "column_name": name,
                    "drift_type": "distribution_shift",
                    "severity": "major" if psi >= PSI_MAJOR else "minor",
                    "metric": "psi",
                    "psi": psi,
                    "detail": (
                        f"PSI = {psi:.4f} "
                        + (
                            "≥ 0.25 → phân phối thay đổi đáng kể."
                            if psi >= PSI_MAJOR
                            else "trong khoảng 0.1–0.25 → thay đổi nhẹ."
                        )
                    ),
                }
            )

    major = sum(1 for d in drift if d["severity"] == "major")
    minor = len(drift) - major
    if not drift:
        summary = "Không phát hiện drift đáng kể giữa hai lần profiling."
    else:
        summary = (
            f"Phát hiện {len(drift)} dấu hiệu drift ({major} nghiêm trọng, {minor} nhẹ) "
            f"trên {len({d['column_name'] for d in drift})} cột."
        )
    return drift, summary


__all__ = ["PSI_MAJOR", "PSI_MINOR", "compare_runs", "population_stability_index"]
