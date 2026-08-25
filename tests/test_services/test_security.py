"""Test lớp bảo vệ: làm sạch tên file, rate limit, audit log, mask PII.

Các test này bám trực tiếp vào eval case C-01 (không lộ giá trị PII) và C-02
(không xuất dữ liệu thô).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.services.security import Audit, RateLimiter, safe_filename


# --------------------------------------------------------------------------- #
# safe_filename — chặn path traversal
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "raw",
    [
        "../../etc/passwd.csv",
        "..\\..\\windows\\system32\\config.csv",
        "/absolute/path/users.csv",
        "C:\\Users\\admin\\data.csv",
    ],
)
def test_safe_filename_strips_directory_components(raw: str) -> None:
    """Mọi thành phần thư mục phải bị bỏ, chỉ còn tên file phẳng."""
    name = safe_filename(raw)
    assert "/" not in name
    assert "\\" not in name
    assert ".." not in name
    assert name.endswith(".csv")


@pytest.mark.parametrize("raw", ["evil.exe", "script.sh", "noextension", "data.txt", ""])
def test_safe_filename_rejects_disallowed_extensions(raw: str) -> None:
    """Fail-closed: đuôi không nằm trong whitelist thì raise, không tự đổi đuôi."""
    with pytest.raises(ValueError):
        safe_filename(raw)


def test_safe_filename_normalises_unsafe_characters() -> None:
    assert safe_filename("báo cáo; rm -rf.csv").endswith(".csv")
    assert " " not in safe_filename("báo cáo; rm -rf.csv")


def test_safe_filename_accepts_all_allowed_suffixes() -> None:
    for suffix in (".csv", ".tsv", ".parquet", ".json"):
        assert safe_filename(f"data{suffix}") == f"data{suffix}"


# --------------------------------------------------------------------------- #
# RateLimiter
# --------------------------------------------------------------------------- #
def test_rate_limiter_blocks_after_quota() -> None:
    limiter = RateLimiter(per_minute=3)
    assert [limiter.allow("u1") for _ in range(3)] == [True, True, True]
    assert limiter.allow("u1") is False


def test_rate_limiter_is_per_user() -> None:
    """User này hết quota không được làm ảnh hưởng user khác."""
    limiter = RateLimiter(per_minute=1)
    assert limiter.allow("u1") is True
    assert limiter.allow("u1") is False
    assert limiter.allow("u2") is True


def test_rate_limiter_check_raises_429() -> None:
    from fastapi import HTTPException

    limiter = RateLimiter(per_minute=1)
    limiter.check("u1")
    with pytest.raises(HTTPException) as exc:
        limiter.check("u1")
    assert exc.value.status_code == 429


# --------------------------------------------------------------------------- #
# Audit log
# --------------------------------------------------------------------------- #
def test_audit_appends_json_lines(tmp_path: Path) -> None:
    audit = Audit(tmp_path / "audit.jsonl")
    audit.log("hitl_decision", proposal_id="p1", decision="confirm")
    audit.log("api_upload", filename="users.csv")

    entries = audit.tail(10)
    assert [e["event"] for e in entries] == ["hitl_decision", "api_upload"]
    assert entries[0]["decision"] == "confirm"
    assert all("ts" in e for e in entries)  # mọi dòng phải có timestamp


def test_audit_tail_returns_most_recent(tmp_path: Path) -> None:
    audit = Audit(tmp_path / "audit.jsonl")
    for i in range(10):
        audit.log("event", index=i)
    assert [e["index"] for e in audit.tail(3)] == [7, 8, 9]


def test_audit_tail_skips_corrupt_lines(tmp_path: Path) -> None:
    """Một dòng lỗi không được làm sập cả trang audit trên UI."""
    path = tmp_path / "audit.jsonl"
    audit = Audit(path)
    audit.log("good", n=1)
    with path.open("a", encoding="utf-8") as fh:
        fh.write("{khong phai json}\n")
    audit.log("good", n=2)

    assert [e["n"] for e in audit.tail(10)] == [1, 2]


def test_audit_tail_on_missing_file_is_empty(tmp_path: Path) -> None:
    assert Audit(tmp_path / "chua-ton-tai.jsonl").tail(5) == []


def test_audit_tail_can_filter_workspace(tmp_path: Path) -> None:
    audit = Audit(tmp_path / "audit.jsonl")
    audit.log("dataset_uploaded", workspace_id="workspace-a", resource_id="dataset-a")
    audit.log("dataset_uploaded", workspace_id="workspace-b", resource_id="dataset-b")
    audit.log("profile_completed", workspace_id="workspace-a", resource_id="run-a")

    entries = audit.tail(10, workspace_id="workspace-a")
    assert [entry["resource_id"] for entry in entries] == ["dataset-a", "run-a"]


# --------------------------------------------------------------------------- #
# Mask PII ở tầng repository (eval C-01)
# --------------------------------------------------------------------------- #
def test_full_profile_masks_pii_columns(client, profile_run: dict) -> None:  # noqa: ANN001
    """`mask_pii=True` phải xoá top_k_values và bật cờ `pii_masked`."""
    from src.services.repository import get_repository

    run_id = profile_run["profile_run_id"]
    masked = get_repository().full_profile(run_id, mask_pii=True)
    assert masked is not None

    by_name = {row["column_name"]: row for row in masked["column_stats"]}
    assert not by_name["email"].get("top_k_values")
    assert by_name["email"]["pii_masked"] is True
    # Cột không phải PII vẫn giữ giá trị mẫu để Analyst xem được phân phối.
    assert by_name["city"].get("top_k_values")


def test_full_profile_derives_pending_count_without_extra_queries(
    client,  # noqa: ANN001
    profile_run: dict,
) -> None:
    """PERF-103: `full_profile` không được query lại PII/pending sau proposals.

    Nó phải suy ra pending count và tập cột PII từ các dòng proposal đã đọc,
    không phát sinh thêm `confirmed_pii_columns` (1 query) và ba
    `pending_count` COUNT() query. Đây là regression test đếm query cố định,
    không phụ thuộc số cột/proposal.
    """
    from src.services import perf_telemetry
    from src.services.repository import get_repository

    repo = get_repository()
    run_id = profile_run["profile_run_id"]

    token = perf_telemetry.begin("test", "corr-full-profile")
    try:
        profile = repo.full_profile(run_id, mask_pii=True)
        ctx = perf_telemetry.current()
        assert ctx is not None
        query_count = ctx.query_count
    finally:
        perf_telemetry.reset(token)

    assert profile is not None
    # run + dataset + column_stats + 3 proposal tables + tests + drift = 8.
    # Không còn confirmed_pii_columns (1) và 3 pending_count -> tối đa 8.
    assert query_count <= 8, f"full_profile phát sinh {query_count} query (>8)"

    # pending_proposals suy ra khớp với đếm thủ công từ chính proposals.
    expected_pending = sum(
        1
        for rows in profile["proposals"].values()
        for row in rows
        if row.get("status") == "pending"
    )
    assert profile["pending_proposals"] == expected_pending
    assert profile["pending_proposals"] == profile_run["pending_proposals"]
