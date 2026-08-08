"""Test engine tính toán — assert vào con số cụ thể trên frame dựng tay.

Đây là lớp quan trọng nhất để test cứng: mọi con số agent nói ra đều đến từ đây,
LLM chỉ diễn đạt lại. Sai ở đây là sai vào mặt người dùng.
"""

from __future__ import annotations

import pandas as pd

from src.services.compute import (
    compute_column_stats,
    compute_correlation_matrix,
    detect_pii,
    detect_quasi_identifiers,
    find_candidate_keys,
)


# --------------------------------------------------------------------------- #
# Thống kê cột
# --------------------------------------------------------------------------- #
def test_null_pct_and_cardinality(frame: pd.DataFrame) -> None:
    stats = compute_column_stats(frame, scan_mode="full")

    # 1 null / 10 dòng.
    assert stats["score"]["null_count"] == 1
    assert stats["score"]["null_pct"] == 10.0
    # code unique toàn bộ; flag chỉ một giá trị.
    assert stats["code"]["cardinality"] == 10
    assert stats["code"]["uniqueness_ratio"] == 1.0
    assert stats["flag"]["cardinality"] == 1


def test_numeric_summary_uses_non_null_rows(frame: pd.DataFrame) -> None:
    score = compute_column_stats(frame, scan_mode="full")["score"]
    assert score["min_value"] == 10.0
    assert score["max_value"] == 1000.0
    # 9 giá trị non-null: [10, 10, 11, 11, 12, 12, 12, 13, 1000] -> median = 12.
    assert score["median"] == 12.0
    # Median không bị outlier 1000 kéo đi, mean thì có — đây là lý do báo cáo
    # phải hiện cả hai.
    assert score["mean"] > score["median"]


def test_iqr_flags_the_extreme_value(frame: pd.DataFrame) -> None:
    """1000 giữa các giá trị 10-13 phải bị đếm là outlier."""
    score = compute_column_stats(frame, scan_mode="full", outlier_method="iqr")["score"]
    assert score["outlier_count"] == 1
    assert score["outlier_method"] == "iqr"


def test_string_column_reports_lengths_not_numeric_stats(frame: pd.DataFrame) -> None:
    code = compute_column_stats(frame, scan_mode="full")["code"]
    assert code["min_length"] == 2  # "C0"
    assert code["max_length"] == 2
    assert code["mean"] is None


def test_sample_mode_marks_numbers_as_approximate(frame: pd.DataFrame) -> None:
    """scan_mode='sample' phải gắn cờ + margin of error (ADR-006)."""
    stats = compute_column_stats(frame, scan_mode="sample")
    assert stats["score"]["is_approximate"] is True
    assert stats["score"]["margin_of_error"] is not None

    full = compute_column_stats(frame, scan_mode="full")
    assert full["score"]["is_approximate"] is False


def test_pii_columns_get_no_sample_values(frame: pd.DataFrame) -> None:
    """Cột nằm trong `pii_columns` không được giữ top_k_values (eval C-01)."""
    stats = compute_column_stats(frame, scan_mode="full", pii_columns={"code"})
    assert not stats["code"]["top_k_values"]
    assert stats["group"]["top_k_values"]  # cột thường vẫn có


# --------------------------------------------------------------------------- #
# Candidate key
# --------------------------------------------------------------------------- #
def test_candidate_key_needs_full_uniqueness_and_no_null(frame: pd.DataFrame) -> None:
    stats = compute_column_stats(frame, scan_mode="full")
    keys = find_candidate_keys(frame, stats)

    columns = [tuple(k["columns"]) for k in keys]
    assert ("code",) in columns
    # score có null, flag trùng lặp -> không thể là key đơn.
    assert ("score",) not in columns
    assert ("flag",) not in columns


def test_candidate_key_confidence_is_derived_from_numbers(frame: pd.DataFrame) -> None:
    stats = compute_column_stats(frame, scan_mode="full")
    key = next(k for k in find_candidate_keys(frame, stats) if k["columns"] == ["code"])
    assert key["confidence"] == 0.99
    assert "100%" in key["evidence"]


# --------------------------------------------------------------------------- #
# PII
# --------------------------------------------------------------------------- #
def test_detect_pii_finds_email_and_phone() -> None:
    df = pd.DataFrame(
        {
            "email": [f"user{i}@example.com" for i in range(20)],
            "phone": [f"09{10_000_000 + i}" for i in range(20)],
            "city": ["Hà Nội"] * 20,
        }
    )
    flags = {f["column_name"]: f for f in detect_pii(df)}

    assert "email" in flags
    assert "phone" in flags
    assert "city" not in flags
    assert flags["email"]["confidence"] > 0.5


def test_pii_evidence_never_leaks_actual_values() -> None:
    """Evidence chỉ được ghi tỉ lệ khớp, không kèm giá trị thật."""
    df = pd.DataFrame({"email": [f"secret{i}@corp.com" for i in range(20)]})
    evidence = detect_pii(df)[0]["evidence"]
    assert "secret0@corp.com" not in evidence
    assert "%" in evidence


def test_quasi_identifiers_exclude_known_pii() -> None:
    df = pd.DataFrame(
        {
            "email": [f"u{i}@e.com" for i in range(30)],
            "birth_year": [1990 + i % 10 for i in range(30)],
            "zipcode": [f"1000{i % 5}" for i in range(30)],
        }
    )
    quasi = detect_quasi_identifiers(df, pii_columns={"email"})
    assert "email" not in quasi


# --------------------------------------------------------------------------- #
# Tương quan
# --------------------------------------------------------------------------- #
def test_correlation_matrix_detects_perfect_relationship() -> None:
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [2, 4, 6, 8, 10], "label": list("abcde")})
    matrix = compute_correlation_matrix(df)
    assert round(matrix["a"]["b"], 6) == 1.0
    assert "label" not in matrix  # cột chuỗi không vào ma trận


def test_correlation_matrix_empty_when_not_enough_numeric_columns() -> None:
    df = pd.DataFrame({"only": [1, 2, 3], "text": list("abc")})
    assert compute_correlation_matrix(df) == {}
