"""`AgentRunner` and the step loop (doc 03).

An activation runs from wake to idle. It appends one `input` event (`current_state` + the work's
items), then loops: render the context, check the context limits, call the model, append the
`assistant` event, run each tool call as an exec under the agent's job lock and append its
`tool_result`. It ends when the model returns no tool call, when an exec that set `final=True`
exits 0, at `MAX_STEPS_PER_ACTIVATION` model calls (`step_limit`), on a model failure
(`model_unavailable`) or on `context_overflow`.
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import logging
import uuid
from typing import Any

from sqlalchemy import and_, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend import ids
from backend.db import tables as t
from backend.execd_client import ExecdError
from backend.harness import epochs
from backend.harness import events as ev
from backend.harness.items import Work, consume, resolve_thread
from backend.harness.limits import LimitAction, check_limits, estimate_tokens
from backend.harness.model import PYTHON_TOOL, ModelCapabilities, ModelError
from backend.harness.offload import batch_offload, build_tool_result
from backend.harness.render import render_messages
from backend.harness.state import load_current_state, render_current_state
from backend.harness.tokens import ExecContext, sign

log = logging.getLogger("contoso.harness")

STATUS_FOR = {"message": "busy", "task": "busy", "routine": "routine", "compaction": "compacting"}
OVERFLOW_USER_TEXT = (
    "{name} đã vượt giới hạn ngữ cảnh nên phải dừng. Việc đang chạy (nếu có) đã được đánh dấu "
    "thất bại; agent sẽ nén ngữ cảnh rồi tiếp tục."
)
PROTOCOL_FAILURE_TEXT = (
    "Lượt xử lý đã dừng vì mô hình không thể hoàn tất yêu cầu theo giao thức. "
    "Bạn có thể thử lại hoặc chọn một mô hình có năng lực phù hợp."
)


class AgentRunner:
    """Owns one agent: waits on its wake event and runs activations until idle."""

    def __init__(
        self, harness: Any, agent_id: uuid.UUID, wake_event: asyncio.Event | None = None
    ) -> None:
        self.harness = harness
        self.agent_id = agent_id
        self._sync_routines = True  # at start, and whenever the agent goes idle (doc 09)
        self._wake_event = wake_event

    async def load(self, conn: AsyncConnection) -> Any:
        return (await conn.execute(select(t.agents).where(t.agents.c.id == self.agent_id))).one()

    async def run_until_idle(self) -> None:
        h = self.harness
        while True:
            async with h.db() as conn:
                agent = await self.load(conn)
                if agent.state != "active":
                    return
                if self._sync_routines:
                    from backend.harness import routines

                    await routines.sync(h, conn, agent)
                    self._sync_routines = False
                work = await h.next_work(conn, agent)
                if work is None:
                    if agent.status != "idle" or agent.status_detail is not None:
                        await _set_status(h, conn, agent, "idle", None)
                    return
            work = await self._debounced_work(h, work)
            if work is None:
                return
            self._sync_routines = True
            await h.run_activation(self, work)

    async def _debounced_work(self, h: Any, work: Any) -> Any:
        """Wait briefly for closely-spaced follow-up messages so they land in this same
        activation instead of becoming a separate one (and a separate reply).

        Only message work is debounced: it is read from pending deliveries (the first work
        source) without side effects, so it can be read again. Task, routine and compaction work
        claim state when fetched (a task is already `running`), so it runs as fetched — fetching
        it again would drop it."""
        debounce_s = h.settings.RUNNER_DEBOUNCE_S
        if self._wake_event is None or debounce_s <= 0 or work.kind != "message":
            return work
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._wake_event.wait(), timeout=debounce_s)
        async with h.db() as conn:
            agent = await self.load(conn)
            work = await h.next_work(conn, agent)
            if work is None and agent.status != "idle":
                await _set_status(h, conn, agent, "idle", None)
            return work


async def _set_status(
    h: Any, conn: AsyncConnection, agent: Any, status: str, detail: str | None
) -> None:
    await conn.execute(
        update(t.agents)
        .where(t.agents.c.id == agent.id)
        .values(status=status, status_detail=detail)
    )
    h.publish_status(conn, agent, status, detail)


async def involved_task(conn: AsyncConnection, agent: Any) -> int | None:
    """The user's running task, if this agent is involved in it."""
    g, ti = t.global_tasks, t.task_involvement
    return await conn.scalar(
        select(g.c.id).where(
            g.c.user_id == agent.user_id,
            g.c.status == "running",
            exists().where(and_(ti.c.task_id == g.c.id, ti.c.agent_id == agent.id)),
        )
    )


async def pending_count(conn: AsyncConnection, agent_id: uuid.UUID) -> int:
    return await conn.scalar(
        select(func.count())
        .select_from(t.deliveries)
        .where(t.deliveries.c.agent_id == agent_id, t.deliveries.c.status == "pending")
    )


@dataclasses.dataclass
class Activation:
    agent: Any
    work: Work
    trace_id: str
    task_id: int | None
    model: str
    trace: Any = None  # the tracer's activation (doc 13)
    sent: int = 0  # messages already sent to the model (generation inputs are deltas)


async def _trace_attributes(
    conn: AsyncConnection, agent: Any, work: Work, task_id: int | None
) -> dict:
    u = (
        await conn.execute(
            select(t.users.c.username, t.users.c.domain_id).where(t.users.c.id == agent.user_id)
        )
    ).one()
    epoch = await epochs.latest(conn, agent.id)
    tags = [u.domain_id or "", agent.slug, work.kind] + (["lead"] if agent.is_lead else [])
    return {
        "name": f"activation:{agent.slug}",
        "slug": agent.slug,
        "username": u.username,
        "session_id": f"task:T{task_id}" if task_id else f"agent:{agent.id}",
        "tags": [x for x in tags if x],
        "metadata": {"agent_id": str(agent.id), "epoch": epoch.epoch if epoch else 0},
        "trigger_trace_ids": list(work.trigger_trace_ids),
    }


async def run_activation(h: Any, runner: AgentRunner, work: Work) -> str:
    status = STATUS_FOR[work.kind]
    async with h.db() as conn:
        agent = await runner.load(conn)
        task_id = work.task_id or await involved_task(conn, agent)
        state = await load_current_state(conn, agent, now=h.now(), status=status)
        state = dataclasses.replace(
            state,
            pending_notifications=max(0, state.pending_notifications - len(work.delivery_ids)),
        )
        text = "\n".join([render_current_state(state), *work.blocks])
        trace_id = ids.trace_id()
        seq = await h.append(
            conn,
            agent,
            kind="input",
            payload={"text": text, "items": work.items},
            trace_id=trace_id,
            activation_kind=work.kind,
            task_id=task_id,
        )
        await consume(conn, work.delivery_ids, seq)
        if work.on_start is not None:
            await work.on_start(conn, seq)
        await _set_status(h, conn, agent, status, work.status_detail)
        attributes = await _trace_attributes(conn, agent, work, task_id)
    act = Activation(
        agent=agent,
        work=work,
        trace_id=trace_id,
        task_id=task_id,
        model=work.model or h.settings.AGENT_MODEL,
    )
    outcome = "error"
    try:
        with h.tracer.activation(trace_id=trace_id, **attributes) as trace:
            act.trace = trace
            outcome = await _step_loop(h, act)
    finally:
        try:
            if work.on_end is not None:
                await work.on_end(outcome)
        finally:
            async with h.db() as conn:
                await _set_status(h, conn, await runner.load(conn), "idle", None)
    return outcome


async def _append(h: Any, act: Activation, kind: str, payload: dict) -> int:
    async with h.db() as conn:
        return await h.append(
            conn,
            act.agent,
            kind=kind,
            payload=payload,
            trace_id=act.trace_id,
            activation_kind=act.work.kind,
            task_id=act.task_id,
        )


async def _context(h: Any, agent_id: uuid.UUID):
    async with h.db() as conn:
        epoch = await epochs.latest(conn, agent_id)
        events = await ev.context_events(conn, agent_id, epoch.start_seq)
    return epoch, events


async def _step_loop(h: Any, act: Activation) -> str:
    s = h.settings
    steps = 0
    corrected_missing_tool = False
    tools_executed = 0
    while True:
        epoch, events = await _context(h, act.agent.id)
        window = h.model.window(act.model)
        estimate = estimate_tokens(epoch.system_prompt, epoch.summary, events)
        action = check_limits(
            estimate, window, soft=s.SOFT_CONTEXT_RATIO, hard=s.HARD_CONTEXT_RATIO
        )
        if action is LimitAction.HARD:
            async with h.db() as conn:
                await batch_offload(
                    conn,
                    agent_id=act.agent.id,
                    folder=h.folder(act.agent),
                    start_seq=epoch.start_seq,
                    epoch=epoch.epoch,
                    trace_id=act.trace_id,
                    activation_kind=act.work.kind,
                    task_id=act.task_id,
                    head_chars=s.OFFLOAD_HEAD_CHARS,
                    tail_chars=s.OFFLOAD_TAIL_CHARS,
                )
            epoch, events = await _context(h, act.agent.id)
            estimate = estimate_tokens(epoch.system_prompt, epoch.summary, events)
            action = check_limits(
                estimate, window, soft=s.SOFT_CONTEXT_RATIO, hard=s.HARD_CONTEXT_RATIO
            )
            if action is LimitAction.HARD:
                if act.work.kind == "compaction":
                    from backend.harness.compaction import truncate

                    await truncate(h, act)
                else:
                    await _overflow(h, act)
                return "error"
        if action is not LimitAction.OK and act.work.kind != "compaction":
            async with h.db() as conn:
                await conn.execute(
                    update(t.agents)
                    .where(t.agents.c.id == act.agent.id)
                    .values(compaction_pending=True)
                )

        messages = render_messages(epoch.system_prompt, epoch.summary, events, model=act.model)
        capabilities = (
            h.model.capabilities(act.model)
            if hasattr(h.model, "capabilities")
            else ModelCapabilities()
        )
        if act.work.requires_tools and capabilities.supports_tools is False:
            await _terminal_failure(
                h,
                act,
                "MODEL_CAPABILITY_UNSUPPORTED",
                "configured model does not support required tool calls",
                required_capability="native_tool_calling",
                failing_operation=act.work.kind,
            )
            return "error"
        try:
            resp = await h.model.complete(
                act.model,
                messages,
                tools=[PYTHON_TOOL] if capabilities.supports_tools is not False else None,
                agent=act.agent.slug,
                purpose="compaction" if act.work.kind == "compaction" else "agent",
            )
        except ModelError as e:
            await _terminal_failure(
                h,
                act,
                e.code,
                str(e)[:1000],
                failing_operation="model_completion",
            )
            return "error"
        steps += 1
        act.trace.generation(
            model=resp.model,
            input=messages[act.sent :],
            output={
                "text": resp.text,
                "tool_calls": resp.tool_calls,
                "finish_reason": resp.finish_reason,
                "error": resp.error,
            },
            usage={
                "input": resp.usage["prompt_tokens"],
                "output": resp.usage["completion_tokens"],
                "cache_read": resp.usage["cached_tokens"],
            },
            cost=resp.usage["cost"],
            latency_ms=resp.latency_ms,
        )
        act.sent = len(messages)  # the next delta starts with this assistant message
        await _append(
            h,
            act,
            "assistant",
            {
                "text": resp.text,
                "tool_calls": resp.tool_calls,
                "model": resp.model,
                "usage": resp.usage,
                "latency_ms": resp.latency_ms,
                "finish_reason": resp.finish_reason,
            },
        )
        if resp.error is not None:
            await _terminal_failure(
                h,
                act,
                str(resp.error.get("code") or "invalid_model_response"),
                str(resp.error.get("text") or "invalid model response")[:1000],
                failing_operation="model_response",
            )
            return "error"
        invalid_call = next((c for c in resp.tool_calls if c.get("error")), None)
        if invalid_call is not None:
            await _terminal_failure(
                h,
                act,
                str(invalid_call["error"]),
                f"invalid tool call {invalid_call.get('id')}: {invalid_call.get('name')!r}",
                required_capability="valid_python_tool_call",
                failing_operation="tool_dispatch",
            )
            return "error"
        if not resp.tool_calls:
            text = (resp.text or "").strip()
            if act.work.kind == "compaction":
                # Compaction is a summarization task, not intrinsically a tool-calling task.
                # A text-only model can provide the summary directly; a native-tool model may
                # still use write_summary after editing durable files.
                if act.agent.id not in h.compaction.summaries and text:
                    h.compaction.summaries[act.agent.id] = text
                return "done"
            if (
                act.work.requires_tools
                and tools_executed == 0
                and not await _mandatory_work_resolved(h, act)
            ):
                if not corrected_missing_tool and steps < s.MAX_STEPS_PER_ACTIVATION:
                    corrected_missing_tool = True
                    await _append(
                        h,
                        act,
                        "error",
                        {
                            "code": "tool_required",
                            "text": (
                                "The work is not complete. Use the available tool to perform "
                                "the required action and deliver/end the task; do not reply with "
                                "plain text only."
                            ),
                        },
                    )
                    continue
                await _terminal_failure(
                    h,
                    act,
                    "MODEL_PROTOCOL_ERROR",
                    "model returned plain text twice while the activation required tools",
                    required_capability="native_tool_calling",
                    failing_operation=act.work.kind,
                )
                return "error"
            if act.work.requires_tools and not await _mandatory_work_resolved(h, act):
                # A task may deliberately yield after delegating work. It remains `running` and
                # a later notification creates the next activation; this is not silent success.
                return "done"
            if act.work.user_visible:
                if await _has_visible_response(h, act):
                    return "done"
                if text:
                    try:
                        await _finalize_text(h, act, text)
                    except (ValueError, RuntimeError) as e:
                        await _terminal_failure(
                            h,
                            act,
                            "delivery_failed",
                            str(e)[:1000],
                            failing_operation="message_delivery",
                        )
                        return "error"
                    return "final"
                if act.work.response_required:
                    await _terminal_failure(
                        h,
                        act,
                        "empty_model_response",
                        "model returned no user-visible result",
                        failing_operation="model_response",
                    )
                    return "error"
                return "done"
            return "done"
        final = False
        for call in resp.tool_calls:
            payload = await _exec(h, act, call)
            tools_executed += 1
            final = final or payload["final"]
        if final:
            return "final"
        if steps >= s.MAX_STEPS_PER_ACTIVATION:
            await _terminal_failure(
                h, act, "step_limit", "step limit reached", failing_operation="agent_step_loop"
            )
            return "step_limit"


async def _has_visible_response(h: Any, act: Activation) -> bool:
    from backend.messaging.messages import user_reply_clause

    if not act.work.default_thread:
        return False
    async with h.db() as conn:
        thread_id = await resolve_thread(conn, act.agent.user_id, act.work.default_thread)
        if thread_id is None:
            return False
        return bool(
            await conn.scalar(
                select(func.count())
                .select_from(t.messages)
                .where(
                    user_reply_clause(
                        thread_id=thread_id, agent_id=act.agent.id, trace_id=act.trace_id
                    )
                )
            )
        )


async def _mandatory_work_resolved(h: Any, act: Activation) -> bool:
    if act.work.kind != "task" or act.task_id is None:
        return False
    async with h.db() as conn:
        status = await conn.scalar(
            select(t.global_tasks.c.status).where(t.global_tasks.c.id == act.task_id)
        )
    return status in ("done", "failed", "cancelled")


async def _finalize_text(h: Any, act: Activation, text: str) -> int:
    from backend.messaging.messages import post_agent_text

    if not act.work.default_thread:
        raise ValueError("activation has no user-visible thread")
    async with h.db() as conn:
        return await post_agent_text(
            h,
            conn,
            agent=act.agent,
            thread_ref=act.work.default_thread,
            text=text,
            trace_id=act.trace_id,
        )


async def _terminal_failure(
    h: Any,
    act: Activation,
    code: str,
    text: str,
    *,
    required_capability: str | None = None,
    failing_operation: str | None = None,
) -> None:
    payload = {
        "code": code,
        "text": text,
        "model": act.model,
        "required_capability": required_capability,
        "failing_operation": failing_operation,
    }
    await _append(h, act, "error", payload)
    async with h.db() as conn:
        if act.task_id is not None:
            task = (
                await conn.execute(
                    select(t.global_tasks).where(
                        t.global_tasks.c.id == act.task_id,
                        t.global_tasks.c.status == "running",
                    )
                )
            ).one_or_none()
            if task is not None:
                from backend.harness.queue import end_by

                await end_by(
                    h,
                    conn,
                    task,
                    status="failed",
                    ended_by="harness",
                    outcome=f"{code}: {text}"[:2000],
                    notice_kind=None,
                    notice_text=None,
                )
        if act.work.response_required and act.work.default_thread:
            from backend.harness.items import resolve_thread
            from backend.messaging.system import post_system_message

            thread_id = await resolve_thread(conn, act.agent.user_id, act.work.default_thread)
            if thread_id is not None:
                await post_system_message(h, conn, thread_id, PROTOCOL_FAILURE_TEXT)


async def _exec(h: Any, act: Activation, call: dict[str, str]) -> dict:
    s = h.settings
    agent = act.agent
    exec_id = ids.exec_id()
    folder = h.folder(agent)
    ctx = ExecContext(
        agent_id=agent.id,
        user_id=agent.user_id,
        slug=agent.slug,
        is_lead=agent.is_lead,
        exec_id=exec_id,
        trace_id=act.trace_id,
        activation_kind=act.work.kind,
        task_id=act.task_id,
        default_thread=act.work.default_thread,
        folder=str(folder),
        compacting=act.work.kind == "compaction",
    )
    token = sign(
        s.SESSION_SECRET.get_secret_value(),
        agent.id,
        exec_id,
        exp=int(h.clock() + s.EXEC_TIMEOUT_S + 10),
    )
    env = {
        "CONTOSO_API_URL": s.INTERNAL_URL,
        "CONTOSO_EXEC_TOKEN": token,
        "CONTOSO_DEFAULT_THREAD": act.work.default_thread or f"direct:{agent.slug}",
    }
    async with h.job_lock(agent.id):
        h.registry.start(ctx, now=h.clock())
        result = error = None
        try:
            result = await h.execd.exec(
                folder=str(folder),
                exec_id=exec_id,
                code=call["code"],
                timeout_s=s.EXEC_TIMEOUT_S,
                author=f"agent:{agent.slug}",
                env_extra=env,
            )
        except ExecdError as e:
            error = e
        finally:
            h.registry.end(exec_id, now=h.clock())
        async with h.db() as conn:
            pending = await pending_count(conn, agent.id)
            if result is not None:
                final = h.registry.final_requested(exec_id) and result.exit_code == 0
                payload = build_tool_result(
                    result,
                    folder=folder,
                    exec_id=exec_id,
                    tool_call_id=call["id"],
                    timeout_s=s.EXEC_TIMEOUT_S,
                    pending=pending,
                    offload_chars=s.OFFLOAD_CHARS,
                    head_chars=s.OFFLOAD_HEAD_CHARS,
                    tail_chars=s.OFFLOAD_TAIL_CHARS,
                    final=final,
                )
            else:
                payload = error_tool_result(
                    call["id"], exec_id, f"execd {error.code}: {error.message}", pending
                )
            await h.append(
                conn,
                agent,
                kind="tool_result",
                payload=payload,
                trace_id=act.trace_id,
                activation_kind=act.work.kind,
                task_id=act.task_id,
            )
    from backend.observability.logging import bound, get_logger

    with bound(trace_id=act.trace_id, user_id=agent.user_id, agent_id=agent.id, exec_id=exec_id):
        get_logger("contoso.exec").info(
            "exec finished",
            slug=agent.slug,
            exit_code=payload["exit_code"],
            duration_ms=payload["duration_ms"],
            timed_out=payload["timed_out"],
        )
    if act.trace is not None:
        act.trace.tool(
            code=call["code"],
            output=payload["text"],
            metadata={
                k: payload.get(k)
                for k in (
                    "exit_code",
                    "duration_ms",
                    "timed_out",
                    "head",
                    "changed",
                    "offload_path",
                )
            },
        )
    return payload


def error_tool_result(
    tool_call_id: str,
    exec_id: str | None,
    reason: str,
    pending: int,
    *,
    line: str | None = None,
    system: bool = False,
) -> dict:
    text = line or f"exit_code: error ({reason})"
    if pending:
        text += f"\n[{pending} notification{'s' if pending != 1 else ''} pending]"
    return {
        "tool_call_id": tool_call_id,
        "exec_id": exec_id,
        "text": text,
        "exit_code": None,
        "duration_ms": 0,
        "timed_out": False,
        "truncated": False,
        "offload_path": None,
        "head": None,
        "changed": None,
        "snapshot_error": None,
        "final": False,
        "batch_offloaded_at": None,
        "system": system,
    }


async def _overflow(h: Any, act: Activation) -> None:
    """Doc 03: `context_overflow` → task failed (lead), a system message, compaction pending."""
    agent = act.agent
    async with h.db() as conn:
        await h.append(
            conn,
            agent,
            kind="error",
            payload={
                "code": "context_overflow",
                "text": "context still over the hard limit after batch offload",
            },
            trace_id=act.trace_id,
            activation_kind=act.work.kind,
            task_id=act.task_id,
        )
        if agent.is_lead:
            g = t.global_tasks
            task = await conn.scalar(
                update(g)
                .where(g.c.user_id == agent.user_id, g.c.status == "running")
                .values(
                    status="failed",
                    outcome="context overflow",
                    ended_by="harness",
                    ended_at=func.now(),
                )
                .returning(g.c.id)
            )
            if task is not None:
                from backend.harness.queue import notify_task_failed, publish_task
                from backend.reports.service import fail_attempts_for_task

                await fail_attempts_for_task(h, conn, task)
                row = (
                    await conn.execute(select(t.global_tasks).where(t.global_tasks.c.id == task))
                ).one()
                await notify_task_failed(h, conn, row)
                await publish_task(h, conn, task)
        thread_id = await resolve_thread(
            conn, agent.user_id, act.work.default_thread or f"direct:{agent.slug}"
        )
        if thread_id is not None:
            from backend.messaging.system import post_system_message

            await post_system_message(
                h, conn, thread_id, OVERFLOW_USER_TEXT.format(name=agent.display_name)
            )
        await conn.execute(
            update(t.agents).where(t.agents.c.id == agent.id).values(compaction_pending=True)
        )
