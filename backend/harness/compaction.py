"""Compaction (doc 06 "Compaction"; decisions 0004, 0005).

- **When.** `agents.compaction_pending` (soft limit, builder prompt edit, `context_overflow`,
  admin "compact now"), only at a safe point: the agent is idle and not involved in a running
  task. It comes after deliveries and routines, and before the lead's next task (doc 03 rule 3).
- **How.** An activation with `<compaction>` + `platform/compaction.md`, on `COMPACTION_MODEL`;
  messaging helpers refuse during it; the agent calls `write_summary(text)`.
- **Success** (a non-empty summary and the activation ended normally): a harness commit
  `epoch <n>` if files changed, then `agent_epochs(epoch+1, start_seq=<last seq>, system prompt
  rendered from the folder, summary, reason='compaction')`.
- **Failure**: the epoch stays, compaction stays pending, retried after 1, 5, then 30 minutes.
- **Too large even after batch offload**: a new epoch with the previous summary plus a note,
  reason `truncated`, and an `error` event `compaction_truncated`.
"""

from __future__ import annotations

import contextlib
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.agents import gitops
from backend.agents.folders import involved_in_running_task
from backend.api.errors import ApiError
from backend.api.internal import Caller, harness_of
from backend.db import tables as t
from backend.harness import epochs, items

BACKOFF_S = (60, 300, 1800)
TRUNCATED_NOTE = "\n[Ngữ cảnh trước đó bị lược bỏ do vượt giới hạn]"
FALLBACK_PROMPT = (
    "Update your memory files, then call contoso.write_summary(text). Send no messages."
)


def backoff_s(failures: int) -> int:
    if failures <= 0:
        return 0
    return BACKOFF_S[min(failures, len(BACKOFF_S)) - 1]


class CompactionState:
    """In-memory: summaries written during a compaction, and when the last one failed."""

    def __init__(self) -> None:
        self.summaries: dict[uuid.UUID, str] = {}
        self.failed_at: dict[uuid.UUID, float] = {}
        self.truncated: set[uuid.UUID] = set()


def _prompt(h: Any) -> str:
    try:
        return (Path(h.settings.PLATFORM_DIR) / "compaction.md").read_text(encoding="utf-8")
    except OSError:
        return FALLBACK_PROMPT


async def compaction_source(h: Any, conn: AsyncConnection, agent: Any) -> items.Work | None:
    if not agent.compaction_pending:
        return None
    if await involved_in_running_task(conn, agent.id):
        return None  # never during a task the agent is involved in (decision 0004)
    if agent.compaction_failures and (
        h.clock() - h.compaction.failed_at.get(agent.id, 0) < backoff_s(agent.compaction_failures)
    ):
        return None
    h.compaction.summaries.pop(agent.id, None)
    agent_id = agent.id

    async def on_end(outcome: str) -> None:
        await finish(h, agent_id, outcome)

    return items.Work(
        kind="compaction",
        blocks=[f"<compaction>\n{_prompt(h).strip()}\n</compaction>"],
        items=[{"type": "compaction"}],
        model=h.settings.COMPACTION_MODEL,
        on_end=on_end,
    )


async def finish(h: Any, agent_id: uuid.UUID, outcome: str) -> None:
    summary = h.compaction.summaries.pop(agent_id, None)
    if agent_id in h.compaction.truncated:
        h.compaction.truncated.discard(agent_id)
        return
    a = t.agents
    async with h.db() as conn:
        agent = (await conn.execute(select(a).where(a.c.id == agent_id))).one()
        if summary and outcome in ("done", "final"):
            folder = h.folder(agent)
            latest = await epochs.latest(conn, agent_id)
            next_epoch = (latest.epoch + 1) if latest else 0
            if (folder / ".git").exists():
                async with h.job_lock(agent_id):
                    with contextlib.suppress(gitops.GitError):
                        await gitops.commit_all(folder, gitops.HARNESS, f"epoch {next_epoch}")
            await epochs.open_epoch(
                conn,
                agent_id=agent_id,
                user_id=agent.user_id,
                folder=folder,
                is_lead=agent.is_lead,
                platform_dir=Path(h.settings.PLATFORM_DIR),
                domains_dir=Path(h.settings.DOMAINS_DIR),
                reason="compaction",
                summary=summary,
            )
            await conn.execute(
                update(a)
                .where(a.c.id == agent_id)
                .values(compaction_pending=False, compaction_failures=0)
            )
            h.compaction.failed_at.pop(agent_id, None)
        else:
            await conn.execute(
                update(a)
                .where(a.c.id == agent_id)
                .values(compaction_failures=a.c.compaction_failures + 1)
            )
            h.compaction.failed_at[agent_id] = h.clock()


async def truncate(h: Any, act: Any) -> None:
    """The compaction context is over the hard limit even after batch offload (doc 06 step 5)."""
    agent = act.agent
    async with h.db() as conn:
        await h.append(
            conn,
            agent,
            kind="error",
            payload={
                "code": "compaction_truncated",
                "text": "context too large to compact; older context dropped",
            },
            trace_id=act.trace_id,
            activation_kind=act.work.kind,
            task_id=act.task_id,
        )
        latest = await epochs.latest(conn, agent.id)
        await epochs.open_epoch(
            conn,
            agent_id=agent.id,
            user_id=agent.user_id,
            folder=h.folder(agent),
            is_lead=agent.is_lead,
            platform_dir=Path(h.settings.PLATFORM_DIR),
            domains_dir=Path(h.settings.DOMAINS_DIR),
            reason="truncated",
            summary=(latest.summary if latest else "") + TRUNCATED_NOTE,
        )
        await conn.execute(
            update(t.agents)
            .where(t.agents.c.id == agent.id)
            .values(compaction_pending=False, compaction_failures=0)
        )
    h.compaction.truncated.add(agent.id)


# --- contoso.write_summary --------------------------------------------------------------------

internal_router = APIRouter(prefix="/internal/v1")


class WriteSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=100_000)


@internal_router.post("/write_summary", status_code=204)
async def write_summary(body: WriteSummary, caller: Caller, request: Request) -> Response:
    if not caller.compacting:
        raise ApiError(409, "not_compacting", "write_summary chỉ dùng khi đang nén ngữ cảnh.")
    if not body.text.strip():
        raise ApiError(400, "invalid_request")
    harness_of(request).compaction.summaries[caller.agent_id] = body.text
    return Response(status_code=204)
