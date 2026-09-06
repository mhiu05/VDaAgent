"""Ngữ cảnh dùng chung cho các tool của agent."""

from __future__ import annotations

from contextvars import ContextVar

from src.services.repository import get_repository

_current_run_id: ContextVar[str | None] = ContextVar("profile_run_id", default=None)
_MASKED = "ĐÃ ẨN — cột này thuộc diện PII, không được trả về giá trị thật."


def current_run_id() -> str:
    """Lấy profile run đang được dispatcher inject vào context hiện tại."""
    run_id = _current_run_id.get()
    if not run_id:
        raise ValueError("Chưa có profile_run_id trong ngữ cảnh.")
    return run_id


def pii_columns(run_id: str) -> set[str]:
    """Lấy các cột PII đã được Analyst xác nhận."""
    return set(get_repository().confirmed_pii_columns(run_id))


__all__ = ["_MASKED", "_current_run_id", "current_run_id", "pii_columns"]
