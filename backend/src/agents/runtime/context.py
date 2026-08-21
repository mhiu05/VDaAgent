"""Request-local context injected by the server, never by model input."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime

from src.agents.runtime.schemas import UsageBudget


@dataclass(frozen=True, slots=True)
class ExecutionContext:
    agent_run_id: str
    workspace_id: str
    actor_user_id: str
    effective_permissions: frozenset[str] = field(default_factory=frozenset)
    resource_bindings: dict[str, str] = field(default_factory=dict)
    correlation_id: str | None = None
    deadline_at: datetime | None = None
    cancellation_token: str | None = None
    budget: UsageBudget = field(default_factory=UsageBudget)


_execution_context: ContextVar[ExecutionContext | None] = ContextVar(
    "agent_execution_context", default=None
)


def get_execution_context() -> ExecutionContext | None:
    return _execution_context.get()


@contextmanager
def execution_scope(context: ExecutionContext) -> Iterator[None]:
    """Install one immutable execution context for a graph node/capability."""

    token = _execution_context.set(context)
    try:
        yield
    finally:
        _execution_context.reset(token)


__all__ = ["ExecutionContext", "execution_scope", "get_execution_context"]
