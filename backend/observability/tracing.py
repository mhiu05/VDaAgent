"""Langfuse tracing (doc 13 "Mapping our runtime onto Langfuse"; decision 0013).

| Ours                 | Langfuse                                                              |
|----------------------|-----------------------------------------------------------------------|
| one activation       | one trace: root `span` `activation:<slug>`, `trace_id` = ours        |
| user, task, agent    | `propagate_attributes(user_id, session_id, tags, metadata)`           |
| model call           | `generation` `model`, input = the messages added since the last call  |
| Python exec          | `tool` `python`                                                       |
| contoso helper calls     | `event` observations in the activation's trace                        |
| jev call             | `generation` `jev` in the poster's trace                              |

`Tracer` (the base class) does nothing; `LangfuseTracer` is used when the keys are set. Every
Langfuse call is wrapped so that tracing never breaks or blocks the harness: the SDK exports in
a background thread, and any error here is logged and swallowed.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator
from typing import Any

log = logging.getLogger("contoso.tracing")


class Activation:
    """Observations inside one activation's trace (no-op)."""

    def generation(self, **kw: Any) -> None:
        pass

    def tool(self, **kw: Any) -> None:
        pass


class Tracer:
    """Tracing off: every call is a no-op."""

    @contextlib.contextmanager
    def activation(self, **kw: Any) -> Iterator[Activation]:
        yield Activation()

    def event(self, **kw: Any) -> None:
        pass

    def jev(self, **kw: Any) -> None:
        pass

    def flush(self) -> None:
        pass


def _safe(fn):
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:
            log.warning("langfuse call %s failed", fn.__name__, exc_info=True)
            return None

    return wrapper


def _meta(values: dict[str, Any]) -> dict[str, str]:
    """`propagate_attributes` metadata must be short strings."""
    return {k: str(v)[:200] for k, v in values.items() if v is not None}


class LangfuseActivation(Activation):
    def __init__(self, span: Any) -> None:
        self.span = span

    @_safe
    def generation(
        self,
        *,
        model: str,
        input: Any,
        output: Any,
        usage: dict,
        cost: float,
        latency_ms: int,
        name: str = "model",
    ) -> None:
        g = self.span.start_observation(
            name=name,
            as_type="generation",
            model=model,
            input=input,
            output=output,
            usage_details={k: int(v or 0) for k, v in usage.items()},
            cost_details={"total": float(cost or 0)},
            metadata={"latency_ms": latency_ms},
        )
        g.end()

    @_safe
    def tool(self, *, code: str, output: str, metadata: dict) -> None:
        o = self.span.start_observation(
            name="python", as_type="tool", input=code, output=output, metadata=metadata
        )
        o.end()


class LangfuseTracer(Tracer):
    def __init__(self, settings: Any) -> None:
        from langfuse import Langfuse

        self.client = Langfuse(
            public_key=settings.LANGFUSE_PUBLIC_KEY,
            secret_key=settings.LANGFUSE_SECRET_KEY.get_secret_value(),
            base_url=settings.LANGFUSE_BASE_URL,
            tracing_enabled=True,
            timeout=5,
        )

    @contextlib.contextmanager
    def activation(
        self,
        *,
        trace_id: str,
        name: str,
        slug: str,
        username: str,
        session_id: str,
        tags: list[str],
        metadata: dict,
        trigger_trace_ids: list[str],
    ) -> Iterator[Activation]:
        stack = contextlib.ExitStack()
        act: Activation = Activation()
        try:
            from langfuse import propagate_attributes

            span = stack.enter_context(
                self.client.start_as_current_observation(
                    trace_context={"trace_id": trace_id},
                    name=name,
                    as_type="span",
                    metadata={**metadata, "trigger_trace_ids": trigger_trace_ids},
                )
            )
            stack.enter_context(
                propagate_attributes(
                    user_id=username, session_id=session_id, tags=tags, metadata=_meta(metadata)
                )
            )
            act = LangfuseActivation(span)
        except Exception:
            log.warning("langfuse activation trace failed", exc_info=True)
        try:
            yield act
        finally:
            try:
                stack.close()
            except Exception:
                log.warning("langfuse activation close failed", exc_info=True)

    @_safe
    def event(self, *, trace_id: str, name: str, metadata: dict) -> None:
        self.client.create_event(trace_context={"trace_id": trace_id}, name=name, metadata=metadata)

    @_safe
    def jev(
        self,
        *,
        trace_id: str,
        model: str,
        input: Any,
        output: Any,
        label: str,
        latency_ms: int,
        confidence: float | None = None,
        fallback: bool = False,
        usage: dict | None = None,
        cost: float = 0,
    ) -> None:
        g = self.client.start_observation(
            trace_context={"trace_id": trace_id},
            name="jev",
            as_type="generation",
            model=model,
            input=input,
            output=output,
            usage_details={k: int(v or 0) for k, v in (usage or {}).items()},
            cost_details={"total": float(cost or 0)},
            metadata={
                "label": label,
                "confidence": confidence,
                "fallback": fallback,
                "latency_ms": latency_ms,
            },
        )
        g.end()

    @_safe
    def flush(self) -> None:
        self.client.flush()


def build_tracer(settings: Any) -> Tracer:
    if settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY.get_secret_value():
        try:
            return LangfuseTracer(settings)
        except Exception:
            log.warning("langfuse client could not start; tracing is off", exc_info=True)
    return Tracer()
