"""Contracts for the Notebook LLM workspace."""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class NotebookCreate(BaseModel):
    profile_run_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Tên notebook không được để trống.")
        return value


class NotebookUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=2000)


class NotebookShare(BaseModel):
    visibility: Literal["private", "workspace"]


class NotebookCellCreate(BaseModel):
    kind: Literal["markdown", "prompt"]
    source: str = Field(min_length=1, max_length=20000)
    title: str | None = Field(default=None, max_length=255)

    @field_validator("source")
    @classmethod
    def source_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Nội dung cell không được để trống.")
        return value


class NotebookCellUpdate(BaseModel):
    source: str | None = Field(default=None, min_length=1, max_length=20000)
    title: str | None = Field(default=None, max_length=255)
    result: dict[str, Any] | None = None
    status: Literal["draft", "running", "completed", "failed"] | None = None

    @field_validator("source")
    @classmethod
    def source_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Nội dung cell không được để trống.")
        return value

    @field_validator("result")
    @classmethod
    def result_is_bounded(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None and len(json.dumps(value, ensure_ascii=False, default=str)) > 100_000:
            raise ValueError("Kết quả cell vượt quá giới hạn lưu trữ 100KB.")
        return value


__all__ = [
    "NotebookCellCreate",
    "NotebookCellUpdate",
    "NotebookCreate",
    "NotebookShare",
    "NotebookUpdate",
]
