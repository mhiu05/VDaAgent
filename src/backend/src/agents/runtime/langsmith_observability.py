"""Privacy-first, fail-open LangSmith projection for agent runtime traces."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Protocol
from uuid import UUID, uuid4

from src.agents.runtime.context import ExecutionContext
from src.agents.runtime.versioning import stable_hash
from src.config import Settings, get_settings

logger = logging.getLogger(__name__)
_stack: ContextVar[tuple[UUID, ...]] = ContextVar("langsmith_span_stack", default=())
_order_stack: ContextVar[tuple[str, ...]] = ContextVar(
    "langsmith_dotted_order_stack", default=()
)
_ALLOWED = frozenset(
    {
        "status",
        "error_code",
        "duration_ms",
        "prompt_id",
        "prompt_version",
        "prompt_hash",
        "provider",
        "model_id",
        "input_tokens",
        "output_tokens",
        "usage_status",
        "tool_name",
        "tool_status",
        "parameter_names",
        "evidence_count",
        "is_approximate",
        "planning_mode",
        "fallback",
        "hit_count",
    }
)


class LangSmithClient(Protocol):
    def create_run(
        self, name: str, inputs: dict[str, Any], run_type: str, **kwargs: Any
    ) -> None: ...
    def update_run(self, run_id: UUID, **kwargs: Any) -> None: ...
    def flush(self, timeout: float | None = None) -> None: ...


@dataclass(slots=True)
class Span:
    run_id: UUID
    metadata: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None


def _uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except (TypeError, ValueError):
        return uuid4()


def _sampled(run_id: str, rate: float) -> bool:
    return rate >= 1 or (
        rate > 0 and int(stable_hash(run_id)[7:15], 16) / 0xFFFFFFFF < rate
    )


def _error_code(error: BaseException | str | None) -> str | None:
    if error is None:
        return None
    value = type(error).__name__ if isinstance(error, BaseException) else str(error)
    return value.lower().replace(" ", "_")[:64]


def _dotted_order(start_time: datetime, run_id: UUID) -> str:
    """Build the ordering token required by current LangSmith trace ingestion."""

    return start_time.astimezone(UTC).strftime("%Y%m%dT%H%M%S%fZ") + str(run_id)


class LangSmithObservability:
    """Allow-listed metadata projection; no SaaS failure affects the request."""

    def __init__(
        self, settings: Settings | None = None, client: LangSmithClient | None = None
    ):
        self.settings = settings or get_settings()
        self._provided_client = client
        self._client_instance: LangSmithClient | None = None
        self._root_orders: dict[UUID, str] = {}

    @property
    def enabled(self) -> bool:
        return bool(
            self.settings.langsmith_tracing
            and self.settings.langsmith_api_key
            and self.settings.app_env != "test"
        )

    def _client(self) -> LangSmithClient | None:
        if not self.enabled:
            return None
        if self._provided_client is not None:
            return self._provided_client
        if self._client_instance is None:
            try:
                from langsmith import Client

                self._client_instance = Client(
                    api_url=self.settings.langsmith_endpoint,
                    api_key=self.settings.langsmith_api_key,
                    timeout_ms=int(
                        self.settings.langsmith_flush_timeout_seconds * 1000
                    ),
                    hide_inputs=True,
                    hide_outputs=True,
                )
            except Exception:
                logger.warning(
                    "LangSmith client unavailable; observability is disabled.",
                    exc_info=True,
                )
        return self._client_instance

    def _active(self, agent_run_id: str) -> bool:
        return self.enabled and _sampled(
            agent_run_id, self.settings.langsmith_sampling_rate
        )

    def _metadata(
        self,
        agent_run_id: str,
        workspace_id: str,
        run_type: str,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "agent_run_id": agent_run_id,
            "workspace_hash": stable_hash(workspace_id),
            "run_type": run_type,
            "environment": self.settings.app_env,
            "runtime_version": self.settings.agent_runtime_version,
            "policy_version": "agent-policy-v1",
            "data_mode": self.settings.langsmith_data_mode,
        }
        if extra:
            result.update(
                {key: value for key, value in extra.items() if key in _ALLOWED}
            )
        return result

    def start_agent_run(
        self,
        *,
        agent_run_id: str,
        workspace_id: str,
        run_type: str,
        version_snapshot: dict[str, Any],
    ) -> None:
        if not self._active(agent_run_id) or (client := self._client()) is None:
            return
        try:
            run_id = _uuid(agent_run_id)
            start_time = datetime.now(UTC)
            dotted_order = _dotted_order(start_time, run_id)
            model = version_snapshot.get("model") or {}
            metadata = self._metadata(
                agent_run_id,
                workspace_id,
                run_type,
                {"provider": model.get("provider"), "model_id": model.get("model_id")},
            )
            client.create_run(
                name=f"agent.{run_type}",
                run_type="chain",
                inputs={},
                id=run_id,
                trace_id=run_id,
                dotted_order=dotted_order,
                project_name=self.settings.langsmith_project_name,
                start_time=start_time,
                extra={"metadata": metadata},
                tags=["p170", self.settings.app_env, run_type, "metadata-only"],
            )
            self._root_orders[run_id] = dotted_order
        except Exception:
            logger.warning("LangSmith root trace export failed.", exc_info=True)

    def finish_agent_run(
        self,
        *,
        agent_run_id: str,
        workspace_id: str,
        status: str,
        error: BaseException | str | None = None,
    ) -> None:
        if not self._active(agent_run_id) or (client := self._client()) is None:
            return
        try:
            run_id = _uuid(agent_run_id)
            code = _error_code(error)
            metadata = self._metadata(
                agent_run_id,
                workspace_id,
                "agent",
                {"status": status, "error_code": code},
            )
            client.update_run(
                run_id,
                end_time=datetime.now(UTC),
                outputs={},
                error=code,
                extra={"metadata": metadata},
            )
            self._root_orders.pop(run_id, None)
        except Exception:
            logger.warning("LangSmith terminal trace export failed.", exc_info=True)

    @contextmanager
    def span(
        self,
        context: ExecutionContext | None,
        *,
        name: str,
        run_type: str,
        metadata: dict[str, Any] | None = None,
    ) -> Iterator[Span | None]:
        if (
            context is None
            or not self._active(context.agent_run_id)
            or (client := self._client()) is None
        ):
            yield None
            return
        span = Span(uuid4())
        stack = _stack.get()
        order_stack = _order_stack.get()
        root_id = _uuid(context.agent_run_id)
        start_time = datetime.now(UTC)
        own_order = _dotted_order(start_time, span.run_id)
        parent_order = (
            order_stack[-1]
            if order_stack
            else self._root_orders.get(root_id, _dotted_order(start_time, root_id))
        )
        dotted_order = f"{parent_order}.{own_order}"
        span.metadata = self._metadata(
            context.agent_run_id, context.workspace_id, run_type, metadata
        )
        token = _stack.set((*stack, span.run_id))
        order_token = _order_stack.set((*order_stack, dotted_order))
        exported = False
        try:
            client.create_run(
                name=name,
                run_type=run_type,
                inputs={},
                id=span.run_id,
                trace_id=root_id,
                parent_run_id=stack[-1] if stack else root_id,
                dotted_order=dotted_order,
                project_name=self.settings.langsmith_project_name,
                start_time=start_time,
                extra={"metadata": span.metadata},
            )
            exported = True
        except Exception:
            logger.warning("LangSmith child trace export failed.", exc_info=True)
        try:
            yield span
        except Exception as exc:
            span.error_code = _error_code(exc)
            raise
        finally:
            _stack.reset(token)
            _order_stack.reset(order_token)
            if not exported:
                pass
            try:
                span.metadata["status"] = "failed" if span.error_code else "completed"
                if span.error_code:
                    span.metadata["error_code"] = span.error_code
                client.update_run(
                    span.run_id,
                    end_time=datetime.now(UTC),
                    outputs={},
                    error=span.error_code,
                    extra={"metadata": span.metadata},
                )
            except Exception:
                logger.warning("LangSmith child trace export failed.", exc_info=True)

    def observation(
        self,
        context: ExecutionContext | None,
        *,
        name: str,
        run_type: str,
        metadata: dict[str, Any],
    ) -> None:
        with self.span(context, name=name, run_type=run_type, metadata=metadata):
            pass

    def flush(self) -> None:
        if (client := self._client()) is not None:
            try:
                client.flush(timeout=self.settings.langsmith_flush_timeout_seconds)
            except Exception:
                logger.warning("LangSmith flush failed.", exc_info=True)


@lru_cache
def get_langsmith_observability() -> LangSmithObservability:
    return LangSmithObservability()


def reset_langsmith_observability() -> None:
    get_langsmith_observability.cache_clear()


__all__ = [
    "LangSmithObservability",
    "get_langsmith_observability",
    "reset_langsmith_observability",
]
