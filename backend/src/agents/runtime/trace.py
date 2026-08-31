"""Redacted trace writer and instrumentation helpers.

No function in this module persists raw prompts, model messages, raw rows,
secrets, local paths or unbounded tool results.  The database receives hashes
and a small public-safe projection only.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from src.agents.prompt_registry import get_prompt_spec
from src.agents.runtime.context import (
    ExecutionContext,
    execution_scope,
    get_execution_context,
)
from src.agents.runtime.langsmith_observability import get_langsmith_observability
from src.agents.runtime.versioning import build_version_snapshot, stable_hash
from src.config import get_settings
from src.services import ai_latency
from src.services.repository import get_repository

_SENSITIVE_KEYS = {
    "authorization",
    "api_key",
    "password",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "source_ref",
    "file_path",
    "local_path",
    "path",
    "raw_row",
    "raw_rows",
    "top_k_values",
    "prompt",
    "messages",
    "content",
    "scratchpad",
    "chain_of_thought",
}


def trace_enabled() -> bool:
    return get_settings().agent_trace_mode != "off"


def _is_sensitive(key: str) -> bool:
    lowered = key.casefold()
    return lowered in _SENSITIVE_KEYS or any(
        marker in lowered
        for marker in ("secret", "password", "token", "prompt", "scratchpad", "raw_row")
    )


def redact_trace_payload(value: Any, *, depth: int = 0, max_items: int = 30) -> Any:
    """Bound payloads and remove fields that could reveal protected content."""

    if depth > 4:
        return "[bounded]"
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= max_items:
                result["_truncated"] = True
                break
            text_key = str(key)
            result[text_key] = (
                "[redacted]"
                if _is_sensitive(text_key)
                else redact_trace_payload(item, depth=depth + 1, max_items=max_items)
            )
        return result
    if isinstance(value, (list, tuple, set)):
        items = list(value)
        result = [
            redact_trace_payload(item, depth=depth + 1, max_items=max_items)
            for item in items[:max_items]
        ]
        if len(items) > max_items:
            result.append("[truncated]")
        return result
    if isinstance(value, str):
        return value[:512] + ("…" if len(value) > 512 else "")
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:512]


def _trace_failure(exc: Exception) -> None:
    if get_settings().agent_trace_mode == "required":
        raise RuntimeError("Không thể ghi execution trace bắt buộc.") from exc


def start_agent_run(
    *,
    workspace_id: str,
    actor_user_id: str,
    run_type: str,
    resource_bindings: dict[str, str],
    request_for_hash: Any | None = None,
    correlation_id: str | None = None,
    idempotency_key: str | None = None,
    return_created: bool = False,
) -> str | None | tuple[str | None, bool]:
    """Create the authoritative domain run only when trace rollout is enabled."""

    if not trace_enabled():
        return (None, True) if return_created else None
    try:
        version_snapshot = build_version_snapshot()
        agent_run_id, created = get_repository().create_agent_run(
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            run_type=run_type,
            resource_bindings=redact_trace_payload(resource_bindings),
            version_snapshot=version_snapshot,
            budget={},
            correlation_id=correlation_id or uuid4().hex,
            idempotency_key=idempotency_key,
            request_hash=stable_hash(request_for_hash or {}),
            return_created=True,
        )
        if created:
            get_langsmith_observability().start_agent_run(
                agent_run_id=agent_run_id,
                workspace_id=workspace_id,
                run_type=run_type,
                version_snapshot=version_snapshot,
            )
        return (agent_run_id, created) if return_created else agent_run_id
    except Exception as exc:  # noqa: BLE001 - shadow trace must not change compatibility
        _trace_failure(exc)
        # Trace rollout is shadow-compatible: an observability outage must not
        # reject the user request. In that rare path idempotency is unavailable
        # rather than silently claiming a duplicate run was prevented.
        return (None, True) if return_created else None


def complete_agent_run(
    agent_run_id: str | None,
    *,
    workspace_id: str,
    status: str = "completed",
    usage: dict[str, Any] | None = None,
) -> None:
    if not agent_run_id:
        return
    try:
        get_repository().transition_agent_run(
            agent_run_id,
            workspace_id=workspace_id,
            status=status,
            reason_code="run_completed" if status == "completed" else "run_paused",
            reason_summary=(
                "Workflow đã hoàn thành."
                if status == "completed"
                else "Workflow đang chờ quyết định hoặc reconciliation."
            ),
            usage=usage,
        )
        get_langsmith_observability().finish_agent_run(
            agent_run_id=agent_run_id,
            workspace_id=workspace_id,
            status=status,
        )
    except Exception as exc:  # noqa: BLE001 - trace failure policy is centralized
        _trace_failure(exc)


def fail_agent_run(
    agent_run_id: str | None,
    *,
    workspace_id: str,
    error: Exception | str,
    error_code: str = "runtime_error",
) -> None:
    if not agent_run_id:
        return
    try:
        # Exception text may include a provider URL/path.  The public event
        # only records its class; a short supplied code is safe to expose.
        summary = "Workflow không hoàn thành; xem mã lỗi và trace đã redact."
        get_repository().transition_agent_run(
            agent_run_id,
            workspace_id=workspace_id,
            status="failed",
            reason_code="run_failed",
            reason_summary=summary,
            error_code=error_code,
        )
        get_langsmith_observability().finish_agent_run(
            agent_run_id=agent_run_id,
            workspace_id=workspace_id,
            status="failed",
            error=error_code,
        )
    except Exception as exc:  # noqa: BLE001 - trace failure policy is centralized
        _trace_failure(exc)


def cancel_agent_run(agent_run_id: str | None, *, workspace_id: str) -> None:
    """Record an explicit user/disconnect cancellation without an error payload."""

    if not agent_run_id:
        return
    try:
        get_repository().transition_agent_run(
            agent_run_id,
            workspace_id=workspace_id,
            status="cancelled",
            reason_code="request_cancelled",
            reason_summary="The client cancelled the request before completion.",
        )
        get_langsmith_observability().finish_agent_run(
            agent_run_id=agent_run_id,
            workspace_id=workspace_id,
            status="cancelled",
        )
    except Exception as exc:  # noqa: BLE001 - trace failure policy is centralized
        _trace_failure(exc)


def _node_context(state: dict[str, Any]) -> ExecutionContext | None:
    agent_run_id = state.get("agent_run_id")
    workspace_id = state.get("workspace_id")
    if not agent_run_id or not workspace_id:
        return None
    resource_bindings = {
        key: str(value)
        for key, value in {
            "profile_run_id": state.get("profile_run_id"),
            "dataset_id": state.get("dataset_id"),
            "analysis_session_id": state.get("analysis_session_id"),
        }.items()
        if value
    }
    return ExecutionContext(
        agent_run_id=str(agent_run_id),
        workspace_id=str(workspace_id),
        actor_user_id=str(state.get("requested_by") or "unknown"),
        resource_bindings=resource_bindings,
    )


def traced_node(
    step_key: str, node: Callable[[dict[str, Any]], dict[str, Any]], ordinal: int
) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """Wrap one fixed graph node with durable step/attempt trace records."""

    def wrapped(state: dict[str, Any]) -> dict[str, Any]:
        context = _node_context(state)
        if context is None or not trace_enabled():
            return node(state)
        attempt_id: str | None = None
        started = time.perf_counter()
        try:
            _, attempt_id = get_repository().begin_agent_step(
                context.agent_run_id,
                workspace_id=context.workspace_id,
                step_key=step_key,
                ordinal=ordinal,
                input_hash=stable_hash(
                    {
                        "profile_run_id": state.get("profile_run_id"),
                        "question_hash": stable_hash(state.get("question") or ""),
                    }
                ),
            )
            with execution_scope(context):
                result = node(state)
            failed = bool(result.get("error"))
            get_repository().finish_agent_step(
                attempt_id,
                workspace_id=context.workspace_id,
                status="failed" if failed else "succeeded",
                output_hash=stable_hash(
                    {"keys": sorted(result), "error": bool(result.get("error"))}
                ),
                error_code="node_error" if failed else None,
                error_summary="Node trả về lỗi đã được sanitize." if failed else None,
            )
            return result
        except Exception as exc:
            if attempt_id:
                try:
                    get_repository().finish_agent_step(
                        attempt_id,
                        workspace_id=context.workspace_id,
                        status="failed",
                        error_code="node_exception",
                        error_summary="Node phát sinh lỗi không thể tiếp tục.",
                    )
                except Exception:  # noqa: BLE001 - preserve the node failure
                    _trace_failure(exc)
            raise
        finally:
            # Duration is deliberately only a trace projection; it never
            # includes node input or output.
            if attempt_id:
                try:
                    get_repository().append_agent_trace(
                        context.agent_run_id,
                        workspace_id=context.workspace_id,
                        event_type="step",
                        reason_code="duration_recorded",
                        reason_summary="Đã ghi thời lượng bước.",
                        payload={
                            "step_key": step_key,
                            "duration_ms": round(
                                (time.perf_counter() - started) * 1000
                            ),
                        },
                    )
                except Exception as exc:  # noqa: BLE001 - trace failure policy is centralized
                    _trace_failure(exc)

    return wrapped


def _usage(response: Any) -> tuple[int | None, int | None, str]:
    usage = getattr(response, "usage_metadata", None) or {}
    if not usage:
        usage = (getattr(response, "response_metadata", None) or {}).get(
            "token_usage"
        ) or {}
    input_tokens = usage.get("input_tokens") or usage.get("prompt_tokens")
    output_tokens = usage.get("output_tokens") or usage.get("completion_tokens")
    return input_tokens, output_tokens, "exact" if usage else "unknown"


def invoke_model(llm: Any, messages: Any, *, prompt_id: str) -> Any:
    """Call a model while recording hashes, version IDs, usage and latency."""

    context = get_execution_context()
    started = time.perf_counter()
    try:
        trace_spec = get_prompt_spec(prompt_id)
        with get_langsmith_observability().span(
            context,
            name=f"model.{trace_spec.id}",
            run_type="llm",
            metadata={
                "prompt_id": trace_spec.id,
                "prompt_version": trace_spec.version,
                "prompt_hash": trace_spec.template_hash,
                "provider": get_settings().llm_provider,
                "model_id": get_settings().llm_model,
            },
        ) as langsmith_span:
            response = llm.invoke(messages)
            model_duration_ms = (time.perf_counter() - started) * 1000
            if langsmith_span is not None:
                input_tokens, output_tokens, usage_status = _usage(response)
                langsmith_span.metadata.update(
                    {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "usage_status": usage_status,
                        "duration_ms": round(model_duration_ms),
                    }
                )
    except Exception as exc:
        ai_latency.record_model(prompt_id, (time.perf_counter() - started) * 1000)
        if context and trace_enabled():
            try:
                spec = get_prompt_spec(prompt_id)
                cfg = get_settings()
                get_repository().record_model_invocation(
                    {
                        "agent_run_id": context.agent_run_id,
                        "workspace_id": context.workspace_id,
                        "step_attempt_id": None,
                        "provider": cfg.llm_provider,
                        "model_id": cfg.llm_model,
                        "parameters_hash": stable_hash(
                            {"temperature": cfg.llm_temperature}
                        ),
                        "prompt_id": spec.id,
                        "prompt_version": spec.version,
                        "prompt_hash": spec.template_hash,
                        "request_hash": stable_hash(messages),
                        "response_hash": None,
                        "input_tokens": None,
                        "output_tokens": None,
                        "estimated_cost": None,
                        "usage_status": "unknown",
                        "latency_ms": round((time.perf_counter() - started) * 1000),
                        "status": "failed",
                        "error_code": type(exc).__name__.lower()[:64],
                        "created_at": datetime.now(UTC),
                    }
                )
            except Exception as trace_exc:  # noqa: BLE001 - trace failure policy is centralized
                _trace_failure(trace_exc)
        raise
    if context and trace_enabled():
        try:
            spec = get_prompt_spec(prompt_id)
            cfg = get_settings()
            input_tokens, output_tokens, usage_status = _usage(response)
            get_repository().record_model_invocation(
                {
                    "agent_run_id": context.agent_run_id,
                    "workspace_id": context.workspace_id,
                    "step_attempt_id": None,
                    "provider": cfg.llm_provider,
                    "model_id": cfg.llm_model,
                    "parameters_hash": stable_hash(
                        {
                            "temperature": cfg.llm_temperature,
                            "reasoning_effort": cfg.llm_reasoning_effort or None,
                        }
                    ),
                    "prompt_id": spec.id,
                    "prompt_version": spec.version,
                    "prompt_hash": spec.template_hash,
                    "request_hash": stable_hash(messages),
                    "response_hash": stable_hash(getattr(response, "content", "")),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "estimated_cost": None,
                    "usage_status": usage_status,
                    "latency_ms": round((time.perf_counter() - started) * 1000),
                    "status": "completed",
                    "error_code": None,
                    "created_at": datetime.now(UTC),
                }
            )
        except Exception as exc:  # noqa: BLE001 - trace failure policy is centralized
            _trace_failure(exc)
    input_tokens, output_tokens, _usage_status = _usage(response)
    ai_latency.record_model(
        prompt_id,
        model_duration_ms,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    return response


def _evidence_value(value: Any, *, depth: int = 0) -> Any:
    """Retain bounded aggregate coordinates, never raw values or PII samples."""

    if depth > 3:
        return "[bounded]"
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in list(value.items())[:30]:
            text_key = str(key)
            if _is_sensitive(text_key) or text_key.casefold() in {
                "top_k_values",
                "email",
                "phone",
            }:
                continue
            result[text_key] = _evidence_value(item, depth=depth + 1)
        return result
    if isinstance(value, list):
        return [_evidence_value(item, depth=depth + 1) for item in value[:20]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:255]
    return str(value)[:255]


def _sanitized_tool_args(args: dict[str, Any]) -> dict[str, Any]:
    """Keep call shape for audit without retaining user/model supplied values."""

    return {
        "arg_names": sorted(str(key) for key in args),
        "arg_types": {
            str(key): type(value).__name__
            for key, value in sorted(args.items(), key=lambda item: str(item[0]))
        },
        "args_hash": stable_hash(args),
    }


def record_tool_result(
    *,
    tool_name: str,
    args: dict[str, Any],
    result: dict[str, Any],
    duration_ms: int,
) -> None:
    """Persist one tool call plus safe canonical evidence in one transaction."""

    context = get_execution_context()
    if context is None or not trace_enabled():
        return
    try:
        repository = get_repository()
        profile_run_id = (
            str(
                result.get("profile_run_id")
                or context.resource_bindings.get("profile_run_id")
                or ""
            )
            or None
        )
        artifact = next(iter(result.get("evidence") or []), {}).get(
            "artifact", "tool_result"
        )
        profile_run = (
            repository.get_profile_run(
                profile_run_id, workspace_id=context.workspace_id
            )
            if profile_run_id
            else None
        )
        source_hash = (profile_run or {}).get("source_content_sha256") or stable_hash(
            result
        )
        limitations = [
            str(item)[:255] for item in (result.get("limitations") or [])[:20]
        ]
        if not (profile_run or {}).get("source_content_sha256"):
            limitations.append(
                "Source content hash chưa được pin; evidence không được coi là reproducible source provenance."
            )
        evidence: list[dict[str, Any]] = []
        if not result.get("error_code"):
            evidence.append(
                {
                    "id": _uuid4_hex(),
                    "agent_run_id": context.agent_run_id,
                    "workspace_id": context.workspace_id,
                    "profile_run_id": profile_run_id,
                    "context_version_id": None,
                    "execution_id": None,
                    "artifact_type": str(artifact)[:64],
                    "artifact_id": profile_run_id or tool_name,
                    "field_path": f"tool.{tool_name}",
                    "value": _evidence_value(result.get("data")),
                    "unit": None,
                    "is_approximate": bool(result.get("is_approximate")),
                    "limitations": limitations[:20],
                    "source_hash": f"sha256:{source_hash}"
                    if not str(source_hash).startswith("sha256:")
                    else source_hash,
                    "source_version": (profile_run or {}).get("source_version"),
                    "created_at": datetime.now(UTC),
                }
            )
        repository.record_tool_invocation(
            {
                "agent_run_id": context.agent_run_id,
                "workspace_id": context.workspace_id,
                "step_attempt_id": None,
                "tool_name": tool_name,
                "tool_version": "1",
                "sanitized_args": _sanitized_tool_args(args),
                "reason_code": "metric_required",
                "status": "failed" if result.get("error_code") else "completed",
                "timeout_ms": None,
                "attempt_number": 1,
                "latency_ms": duration_ms,
                "result_hash": stable_hash(result),
                "error_code": result.get("error_code"),
                "created_at": datetime.now(UTC),
            },
            evidence,
        )
    except Exception as exc:  # noqa: BLE001 - trace failure policy is centralized
        _trace_failure(exc)


def record_retrieval_call(
    *,
    query: str,
    profile_run_id: str | None,
    profile_hits: list[Any],
    knowledge_hits: list[Any],
) -> None:
    """Trace retrieval provenance without persisting a query or document text."""

    context = get_execution_context()
    if context is None or not trace_enabled():
        return
    try:
        cfg = get_settings()
        hit_projection = [
            {
                "doc_id": str(hit.doc_id),
                "score": round(float(hit.score), 6),
                "knowledge_type": str((hit.metadata or {}).get("knowledge_type", "")),
            }
            for hit in [*profile_hits, *knowledge_hits][: cfg.retrieval_candidate_k]
        ]
        get_repository().record_tool_invocation(
            {
                "agent_run_id": context.agent_run_id,
                "workspace_id": context.workspace_id,
                "step_attempt_id": None,
                "tool_name": "retrieve_scoped_evidence",
                "tool_version": "1",
                "sanitized_args": {
                    "query_hash": stable_hash(query),
                    "profile_run_id": profile_run_id,
                    "external_knowledge_enabled": cfg.retrieval_external_knowledge_enabled,
                    "embedding_model": cfg.retrieval_embedding_model,
                    "rerank_model": cfg.retrieval_rerank_model
                    if cfg.retrieval_enable_rerank
                    else None,
                },
                "reason_code": "evidence_required",
                "status": "completed",
                "timeout_ms": None,
                "attempt_number": 1,
                "latency_ms": None,
                "result_hash": stable_hash(hit_projection),
                "error_code": None,
                "created_at": datetime.now(UTC),
            },
            [],
        )
    except Exception as exc:  # noqa: BLE001 - trace failure policy is centralized
        _trace_failure(exc)


def _uuid4_hex() -> str:
    return uuid4().hex


__all__ = [
    "complete_agent_run",
    "cancel_agent_run",
    "fail_agent_run",
    "invoke_model",
    "record_retrieval_call",
    "record_tool_result",
    "redact_trace_payload",
    "start_agent_run",
    "trace_enabled",
    "traced_node",
]
