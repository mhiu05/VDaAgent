"""Structured logs (doc 13 "Logs"): JSON lines on stdout via structlog.

Every line carries `trace_id`, `user_id`, `agent_id` and `exec_id` when they are bound
(`bound(...)` binds them for the current task). Values from `.env.d/`, cookies, passwords and
the OpenRouter key are never passed to a logger, so they can't appear here.
"""

from __future__ import annotations

import contextlib
import logging
import sys
from collections.abc import Iterator
from typing import Any

import structlog

_configured = False


def configure(json_output: bool = True, level: int = logging.INFO) -> None:
    global _configured
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(ensure_ascii=False)
        if json_output
        else structlog.dev.ConsoleRenderer(),
    ]
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=False,
    )
    _configured = True


def get_logger(name: str = "contoso") -> Any:
    if not _configured:
        configure()
    return structlog.get_logger(name)


@contextlib.contextmanager
def bound(**values: Any) -> Iterator[None]:
    values = {k: str(v) for k, v in values.items() if v is not None}
    with structlog.contextvars.bound_contextvars(**values):
        yield
