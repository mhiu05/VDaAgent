"""Lớp truy cập LLM — multi-provider qua giao thức OpenAI-compatible.

Đổi provider chỉ cần sửa `llm.provider` trong config.yaml + điền key tương ứng
trong .env; không module nào khác phải thay đổi.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from langchain_core.language_models import BaseChatModel
# pyrefly: ignore [missing-import]
from langchain_google_genai import ChatGoogleGenerativeAI
# pyrefly: ignore [missing-import]
from langchain_openai import ChatOpenAI
from src.config import LLM_PROVIDERS, Settings, get_settings


class LLMNotConfiguredError(RuntimeError):
    """Chưa điền API key — nêu rõ tên biến cần điền để user sửa được ngay."""

    def __init__(self, settings: Settings) -> None:
        key_env = LLM_PROVIDERS[settings.llm_provider]["key_env"]
        super().__init__(
            f"Chưa cấu hình LLM. Điền {key_env} (hoặc LLM_API_KEY) trong file .env "
            f"— provider hiện tại: {settings.llm_provider}."
        )
        self.key_env = key_env


@lru_cache
def get_llm(streaming: bool = False) -> BaseChatModel:
    """Client LLM dùng chung. Raise `LLMNotConfiguredError` nếu thiếu key."""
    settings = get_settings()
    if not settings.llm_configured:
        raise LLMNotConfiguredError(settings)

    if settings.llm_provider == "gemini":
        # Native Gemini preserves provider-specific thought signatures in tool calls.
        return ChatGoogleGenerativeAI(
            model=settings.llm_model,
            google_api_key=settings.llm_api_key,
            temperature=settings.llm_temperature,
            max_retries=2,
        )

    kwargs: dict[str, Any] = {
        "model": settings.llm_model,
        "temperature": settings.llm_temperature,
        "api_key": settings.llm_api_key or "not-needed",
        "streaming": streaming,
    }
    if settings.llm_base_url:
        kwargs["base_url"] = settings.llm_base_url
    # Chỉ model o-series/gpt-5 hiểu tham số này; provider khác sẽ báo lỗi 400.
    if settings.llm_reasoning_effort:
        kwargs["reasoning_effort"] = settings.llm_reasoning_effort

    return ChatOpenAI(**kwargs)


def llm_available() -> bool:
    """Kiểm tra không raise — dùng cho endpoint /health và /status."""
    return get_settings().llm_configured


__all__ = ["LLMNotConfiguredError", "get_llm", "llm_available"]
