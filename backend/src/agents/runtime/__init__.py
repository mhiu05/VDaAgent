"""Durable, redacted execution-runtime primitives for agent workflows.

The package is intentionally independent of LangGraph.  Graph checkpoints are
useful orchestration state, but the domain database is the source of truth for
agent runs, trace events and provenance.
"""

from src.agents.runtime.context import (
    ExecutionContext,
    execution_scope,
    get_execution_context,
)
from src.agents.runtime.trace import (
    complete_agent_run,
    fail_agent_run,
    start_agent_run,
    trace_enabled,
)

__all__ = [
    "ExecutionContext",
    "complete_agent_run",
    "execution_scope",
    "fail_agent_run",
    "get_execution_context",
    "start_agent_run",
    "trace_enabled",
]
