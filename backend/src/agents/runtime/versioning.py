"""Stable, hashable version snapshots for reproducible agent-run provenance."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
from typing import Any

from src.config import Settings, get_settings


def stable_hash(value: Any) -> str:
    """Hash structured data without retaining the original potentially-sensitive text."""

    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":")
    )
    return "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _package_versions() -> dict[str, str]:
    packages = ("fastapi", "pydantic", "sqlalchemy", "langgraph", "langchain-openai")
    result: dict[str, str] = {}
    for package in packages:
        try:
            result[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            result[package] = "unavailable"
    return result


def build_version_snapshot(settings: Settings | None = None) -> dict[str, Any]:
    """Return only IDs/hashes; never include a raw prompt or API endpoint secret."""

    cfg = settings or get_settings()
    try:
        from src.agents.tools.registry import READ_ONLY_QA_TOOLS

        tools = sorted({str(item.name) for item in READ_ONLY_QA_TOOLS})
    except Exception:  # noqa: BLE001 - a snapshot must not break a compatibility run
        tools = []

    snapshot: dict[str, Any] = {
        "runtime_version": cfg.agent_runtime_version,
        "policy_version": "agent-policy-v1",
        "model": {
            "provider": cfg.llm_provider,
            "model_id": cfg.llm_model,
            # Providers may expose an alias without a revision. Do not claim
            # a reproducible revision when none was supplied by the provider.
            "model_revision_unpinned": True,
            "temperature": cfg.llm_temperature,
            "reasoning_effort": cfg.llm_reasoning_effort or None,
        },
        "tool_registry": {"names": tools, "hash": stable_hash(tools)},
        "retrieval": {
            "embedding_provider": cfg.retrieval_embedding_provider,
            "embedding_model": cfg.retrieval_embedding_model,
            "rerank_model": cfg.retrieval_rerank_model
            if cfg.retrieval_enable_rerank
            else None,
            "external_knowledge_enabled": cfg.retrieval_external_knowledge_enabled,
        },
        "dependencies": _package_versions(),
    }
    snapshot["snapshot_hash"] = stable_hash(snapshot)
    return snapshot


__all__ = ["build_version_snapshot", "stable_hash"]
