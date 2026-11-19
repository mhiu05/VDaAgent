"""jev: classifies every delivery to a lead with `route='jev'` (doc 07 "jev", decision 0002).

```text
build_jev_ctx(lead, msg) = lead.current_state + lead.summary + last JEV_K messages of the lead
                           (sent or received; never tool output) + msg
```

Classified through OpenRouter's Decisions API (`ModelClient.decide`, doc 07 "jev"): a typed
`choice` between `task` and `side_question`, with a calibrated `confidence`. Below
`JEV_CONFIDENCE_FLOOR` the label is forced to `side_question`. A timeout (10 s), a malformed
response or a model error also gives `side_question` with `fallback=true`, so a message is
never lost. One classification at a time per lead, in delivery order. Every call is recorded
in `jev_decisions`.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select, update

from backend import ids
from backend.db import tables as t
from backend.db.session import on_commit
from backend.harness import epochs
from backend.harness.items import _attr, _time, readable_from_row, sender_label
from backend.harness.model import ModelError
from backend.harness.state import load_current_state, render_current_state

LABELS = ("task", "side_question")
log = logging.getLogger("contoso.harness.jev")
URGENCY_LEVELS = ("low", "normal", "high")


def _urgency(resp: Any) -> str:
    """The router's urgency answer, or `normal` when it is missing or not a known level."""
    answers = getattr(resp, "answers", None)
    answer = answers.get("urgency") if isinstance(answers, dict) else None
    choice = answer.get("choice") if isinstance(answer, dict) else None
    return choice if choice in URGENCY_LEVELS else "normal"


def _message_block(tag: str, sender: str, thread: str, row: Any, files: list[str]) -> str:
    text = (row.content or {}).get("text") or ""
    lines = [
        f'<{tag} id="m_{row.id}" from="{_attr(sender)}" thread="{_attr(thread)}" '
        f'at="{_time(row.created_at)}">',
        text,
    ]
    if files:
        lines.append("attachments: " + ", ".join(files))
    lines.append(f"</{tag}>")
    return "\n".join(lines)


async def build_jev_context(h: Any, conn: Any, lead: Any, message: Any) -> str:
    state = await load_current_state(conn, lead, now=h.now())
    parts = [render_current_state(state)]
    epoch = await epochs.latest(conn, lead.id)
    if epoch is not None and epoch.summary:
        parts.append(f"<summary>\n{epoch.summary}\n</summary>")

    m, tm, th = t.messages, t.thread_members, t.threads
    lead_threads = select(tm.c.thread_id).where(
        tm.c.member_type == "agent", tm.c.member_id == lead.id
    )
    recent = (
        await conn.execute(
            select(m, th.c.kind, th.c.member_key, th.c.name, th.c.id.label("tid"))
            .select_from(m.join(th, m.c.thread_id == th.c.id))
            .where(m.c.thread_id.in_(lead_threads), m.c.id < message.id)
            .order_by(m.c.id.desc())
            .limit(h.settings.JEV_K)
        )
    ).all()
    if recent:
        blocks = []
        for r in reversed(recent):
            ref, _ = readable_from_row(
                type(
                    "T",
                    (),
                    {"kind": r.kind, "member_key": r.member_key, "id": r.tid, "name": r.name},
                )()
            )
            blocks.append(
                _message_block(
                    "m", await sender_label(conn, r.sender_type, r.sender_id), ref, r, []
                )
            )
        parts.append("<recent_messages>\n" + "\n".join(blocks) + "\n</recent_messages>")

    thread = (await conn.execute(select(th).where(th.c.id == message.thread_id))).one()
    ref, _ = readable_from_row(thread)
    files = (
        (
            await conn.execute(
                select(t.attachments.c.filename)
                .where(t.attachments.c.message_id == message.id)
                .order_by(t.attachments.c.filename)
            )
        )
        .scalars()
        .all()
    )
    parts.append(
        _message_block(
            "message",
            await sender_label(conn, message.sender_type, message.sender_id),
            ref,
            message,
            list(files),
        )
    )
    return "\n\n".join(parts)


def _criteria(h: Any) -> dict[str, str]:
    path = Path(h.settings.PLATFORM_DIR) / "jev_criteria.yaml"
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except OSError:
        data = {}
    return {"task": data.get("task") or "", "side_question": data.get("side_question") or ""}


def _questions(criteria: dict[str, str]) -> dict[str, Any]:
    return {
        "route": {
            "type": "choice",
            "instructions": (
                "Is this new, independent work for the lead's queue, or something else?"
            ),
            "criteria": criteria,
        },
        "urgency": {
            "type": "choice",
            "instructions": (
                "How urgent is this message for the lead to see? Pick low, normal or high."
            ),
            "criteria": {
                "low": "Can wait; no time pressure.",
                "normal": "Ordinary priority.",
                "high": "Time-sensitive or blocking; the lead should see this first.",
            },
        },
    }


class Jev:
    def __init__(self, harness: Any) -> None:
        self.h = harness
        self.timeout_s = 10.0
        self._locks: dict[uuid.UUID, asyncio.Lock] = {}
        self._tasks: set[asyncio.Task] = set()

    def schedule(self, delivery_id: int) -> None:
        """Classify in the background (the poster never waits)."""
        task = asyncio.get_running_loop().create_task(self._guarded_classify(delivery_id))
        self._tasks.add(task)
        task.add_done_callback(self._done)

    def _done(self, task: asyncio.Task) -> None:
        self._tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()  # retrieve it so asyncio never reports "never retrieved"
        if error is not None:
            log.error(
                "JEV background task failed after recovery",
                exc_info=(type(error), error, error.__traceback__),
            )

    async def _guarded_classify(self, delivery_id: int) -> None:
        try:
            await self.classify(delivery_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("JEV classification crashed for delivery %s", delivery_id)
            # A classification failure must never strand a message in `classifying`.
            async with self.h.db() as conn:
                row = (
                    await conn.execute(
                        select(t.deliveries.c.agent_id, t.deliveries.c.status).where(
                            t.deliveries.c.id == delivery_id
                        )
                    )
                ).one_or_none()
                if row is not None and row.status == "classifying":
                    await conn.execute(
                        update(t.deliveries)
                        .where(t.deliveries.c.id == delivery_id)
                        .values(status="pending")
                    )
                    on_commit(conn, lambda: self.h.wake(row.agent_id))

    async def drain(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def classify(self, delivery_id: int) -> None:
        async with self.h.db() as conn:
            lead_id = await conn.scalar(
                select(t.deliveries.c.agent_id).where(t.deliveries.c.id == delivery_id)
            )
        if lead_id is None:
            return
        lock = self._locks.setdefault(lead_id, asyncio.Lock())
        async with lock:
            await self._classify(delivery_id)

    run = classify

    async def _classify(self, delivery_id: int) -> None:
        h = self.h
        d = t.deliveries
        async with h.db() as conn:
            delivery = (await conn.execute(select(d).where(d.c.id == delivery_id))).one_or_none()
            if delivery is None or delivery.status != "classifying":
                return
            lead = (
                await conn.execute(select(t.agents).where(t.agents.c.id == delivery.agent_id))
            ).one()
            message = (
                await conn.execute(select(t.messages).where(t.messages.c.id == delivery.message_id))
            ).one()
            state = await build_jev_context(h, conn, lead, message)
        questions = _questions(_criteria(h))
        started = time.monotonic()
        fallback = False
        label = "side_question"
        urgency = "normal"
        confidence: float | None = None
        resp = None
        try:
            resp = await asyncio.wait_for(
                h.model.decide(
                    h.settings.JEV_MODEL, state, questions, agent=lead.slug, purpose="jev"
                ),
                timeout=self.timeout_s,
            )
            route = resp.answers["route"]
            choice, confidence = route["choice"], route["confidence"]
            if choice not in LABELS:
                raise ValueError(f"unknown choice {choice!r}")
            label = choice if confidence >= h.settings.JEV_CONFIDENCE_FLOOR else "side_question"
        except (TimeoutError, ModelError, KeyError, TypeError, ValueError):
            label, confidence, fallback = "side_question", None, True
        # urgency is read on its own: a missing or unknown answer never changes the route
        urgency = "normal" if fallback else _urgency(resp)
        latency = int((time.monotonic() - started) * 1000)
        trace_id = message.trace_id or ids.trace_id()
        usage = resp.usage if resp is not None else {}
        input_sent = {"state": state, "questions": questions}
        h.tracer.jev(
            trace_id=trace_id,
            model=h.settings.JEV_MODEL,
            input=input_sent,
            output=resp.answers if resp is not None else None,
            label=label,
            confidence=confidence,
            latency_ms=latency,
            fallback=fallback,
            usage={
                "input": usage.get("input_tokens", 0),
                "output": usage.get("output_tokens", 0),
            },
            cost=usage.get("cost", 0),
        )

        async with h.db() as conn:
            current = await conn.scalar(
                select(d.c.status).where(d.c.id == delivery_id).with_for_update()
            )
            if current != "classifying":
                return
            await conn.execute(
                t.jev_decisions.insert().values(
                    message_id=message.id,
                    lead_id=lead.id,
                    input=input_sent,
                    label=label,
                    confidence=confidence,
                    urgency=urgency,
                    fallback=fallback,
                    model=h.settings.JEV_MODEL,
                    latency_ms=latency,
                    trace_id=trace_id,
                )
            )
            if label == "task":
                from backend.harness.queue import publish_task

                task_id = await conn.scalar(
                    t.global_tasks.insert()
                    .values(
                        user_id=lead.user_id,
                        source_message_id=message.id,
                        status="queued",
                        description=((message.content or {}).get("text") or "")[:500],
                    )
                    .returning(t.global_tasks.c.id)
                )
                await conn.execute(
                    update(d)
                    .where(d.c.id == delivery_id)
                    .values(status="consumed", urgency=urgency)
                )
                await publish_task(h, conn, task_id)
            else:
                await conn.execute(
                    update(d).where(d.c.id == delivery_id).values(status="pending", urgency=urgency)
                )
            on_commit(conn, lambda: h.wake(lead.id))


async def reclassify_pending(h: Any) -> int:
    """Boot: deliveries still `classifying` are classified again (doc 07)."""
    async with h.db() as conn:
        ids_ = (
            (
                await conn.execute(
                    select(t.deliveries.c.id)
                    .where(t.deliveries.c.status == "classifying")
                    .order_by(t.deliveries.c.id)
                )
            )
            .scalars()
            .all()
        )
    for delivery_id in ids_:
        h.jev.schedule(delivery_id)
    return len(ids_)
