"""Request-local performance telemetry (PERF-001).

Decomposes each workspace request into auth / workspace / database /
serialization phases plus SQL query count and response payload size, so every
later optimization has a measured baseline instead of a guess.

Safety: this module never records tokens, emails, workspace/resource IDs, SQL
parameters, request bodies, questions, prompts, model output, or raw rows. Only
a coarse SQL *fingerprint* (``VERB:table`` or a hash of the normalized template)
and elapsed times are kept. All state lives in a :class:`contextvars.ContextVar`,
so concurrent requests never share counters and query counts cannot bleed
between requests.
"""

from __future__ import annotations

import contextvars
import hashlib
import logging
import random
import re
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator

logger = logging.getLogger("p170.perf")

_perf_context: contextvars.ContextVar["PerfContext | None"] = contextvars.ContextVar(
    "p170_perf_context", default=None
)

_IDENT = r"[A-Za-z_][A-Za-z0-9_]*"
_TABLE_RE = re.compile(
    rf"\b(?:from|into|update|join)\s+(?:{_IDENT}\.)?(\"?{_IDENT}\"?)",
    re.IGNORECASE,
)


def _fingerprint(sql: str) -> str:
    """Return a PII-free identifier for a SQL statement.

    Prefers ``VERB:table`` (both are schema identifiers, never data). Falls back
    to a short hash of the literal-stripped template so a statement we cannot
    parse still groups without ever exposing values or parameters.
    """
    stripped = sql.lstrip()
    verb_match = re.match(r"[A-Za-z]+", stripped)
    verb = verb_match.group(0).upper() if verb_match else ""
    table_match = _TABLE_RE.search(sql)
    if verb and table_match:
        table = table_match.group(1).strip('"')
        return f"{verb}:{table}"
    normalized = re.sub(r"'[^']*'", "?", sql)
    normalized = re.sub(r"\b\d+\b", "?", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip().lower()
    return "sql:" + hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]


@dataclass
class PerfContext:
    """Mutable per-request accumulator; one instance per request context."""

    route: str
    correlation_id: str
    method: str = ""
    auth_local_ms: float = 0.0
    auth_remote_ms: float = 0.0
    workspace_ms: float = 0.0
    db_ms: float = 0.0
    query_count: int = 0
    serialization_ms: float = 0.0
    payload_bytes: int = 0
    payload_streaming: bool = False
    slowest_query_ms: float = 0.0
    slowest_query_fingerprint: str = ""

    def record_query(self, duration_ms: float, statement: str) -> None:
        self.query_count += 1
        self.db_ms += duration_ms
        if duration_ms > self.slowest_query_ms:
            self.slowest_query_ms = duration_ms
            self.slowest_query_fingerprint = _fingerprint(statement)


def current() -> PerfContext | None:
    """Return the active request's context, or ``None`` outside a request."""
    return _perf_context.get()


def begin(route: str, correlation_id: str, method: str = "") -> contextvars.Token:
    """Start a fresh context for one request. Reset with :func:`reset`."""
    return _perf_context.set(
        PerfContext(route=route, correlation_id=correlation_id, method=method)
    )


def reset(token: contextvars.Token) -> None:
    _perf_context.reset(token)


def add_phase(field_name: str, duration_ms: float) -> None:
    """Add elapsed milliseconds to one phase accumulator (no-op if inactive)."""
    ctx = _perf_context.get()
    if ctx is None:
        return
    setattr(ctx, field_name, getattr(ctx, field_name, 0.0) + duration_ms)


@contextmanager
def timed(field_name: str) -> Iterator[None]:
    """Time a block and add it to ``field_name`` on the active context."""
    ctx = _perf_context.get()
    if ctx is None:
        yield
        return
    started = time.perf_counter()
    try:
        yield
    finally:
        setattr(
            ctx,
            field_name,
            getattr(ctx, field_name, 0.0) + (time.perf_counter() - started) * 1000,
        )


def record_serialization(duration_ms: float, payload_bytes: int) -> None:
    ctx = _perf_context.get()
    if ctx is None:
        return
    ctx.serialization_ms += duration_ms
    ctx.payload_bytes += payload_bytes


_INSTALLED_ENGINES: set[int] = set()


def install_sql_instrumentation(engine: Any) -> None:
    """Attach timing-only cursor hooks to an engine exactly once.

    The hooks add no queries; they only time the ones the application already
    runs and attribute them to the active request context. SQL parameters are
    never read.
    """
    # pyrefly: ignore [missing-import]
    from sqlalchemy import event

    key = id(engine)
    if key in _INSTALLED_ENGINES:
        return

    @event.listens_for(engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        conn.info["_p170_query_start"] = time.perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        started = conn.info.pop("_p170_query_start", None)
        ctx = _perf_context.get()
        if ctx is None or started is None:
            return
        duration_ms = (time.perf_counter() - started) * 1000
        ctx.record_query(duration_ms, statement)

    _INSTALLED_ENGINES.add(key)


def emit_log(
    ctx: PerfContext,
    status_code: int,
    total_ms: float,
) -> None:
    """Emit one PII-safe structured line summarizing the request phases."""
    logger.info(
        "perf route=%s method=%s status=%d total_ms=%d auth_local_ms=%d "
        "auth_remote_ms=%d workspace_ms=%d db_ms=%d query_count=%d "
        "serialization_ms=%d payload_bytes=%d streaming=%s slow_query=%s "
        "slow_query_ms=%d correlation_id=%s",
        ctx.route,
        ctx.method,
        status_code,
        round(total_ms),
        round(ctx.auth_local_ms),
        round(ctx.auth_remote_ms),
        round(ctx.workspace_ms),
        round(ctx.db_ms),
        ctx.query_count,
        round(ctx.serialization_ms),
        ctx.payload_bytes,
        "1" if ctx.payload_streaming else "0",
        ctx.slowest_query_fingerprint or "-",
        round(ctx.slowest_query_ms),
        ctx.correlation_id,
    )


def maybe_log_slow_query(threshold_ms: float, sample_rate: float) -> None:
    """Log the slowest query fingerprint if it crossed the sampled threshold."""
    ctx = _perf_context.get()
    if ctx is None or not ctx.slowest_query_fingerprint:
        return
    if ctx.slowest_query_ms < threshold_ms:
        return
    if sample_rate < 1.0 and random.random() >= sample_rate:
        return
    logger.info(
        "perf_slow_query route=%s fingerprint=%s duration_ms=%d "
        "query_count=%d correlation_id=%s",
        ctx.route,
        ctx.slowest_query_fingerprint,
        round(ctx.slowest_query_ms),
        ctx.query_count,
        ctx.correlation_id,
    )


__all__ = [
    "PerfContext",
    "add_phase",
    "begin",
    "current",
    "emit_log",
    "install_sql_instrumentation",
    "maybe_log_slow_query",
    "record_serialization",
    "reset",
    "timed",
]
