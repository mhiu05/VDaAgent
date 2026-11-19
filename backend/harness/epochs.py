"""Opening an epoch (doc 06; doc 10 `agent_epochs`): the system prompt is rendered here once."""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.harness.render import render_system_prompt


async def last_seq(conn: AsyncConnection, agent_id: uuid.UUID) -> int:
    return await conn.scalar(
        select(func.coalesce(func.max(t.events.c.seq), 0)).where(t.events.c.agent_id == agent_id)
    )


async def latest(conn: AsyncConnection, agent_id: uuid.UUID):
    return (
        await conn.execute(
            select(t.agent_epochs)
            .where(t.agent_epochs.c.agent_id == agent_id)
            .order_by(t.agent_epochs.c.epoch.desc())
            .limit(1)
        )
    ).one_or_none()


async def _user_context(conn: AsyncConnection, user_id: uuid.UUID) -> tuple[bool, str | None, str]:
    """Prompt settings for the owning user; defaults if absent."""
    row = (
        await conn.execute(
            select(t.users.c.domain_id, t.user_preferences.c.value, t.users.c.account_type)
            .select_from(
                t.users.outerjoin(t.user_preferences, t.user_preferences.c.user_id == t.users.c.id)
            )
            .where(t.users.c.id == user_id)
        )
    ).one_or_none()
    if row is None:
        return False, None, "human"
    value = row.value or {}
    return bool(value.get("semanticExplanation", False)), row.domain_id, row.account_type


async def open_epoch(
    conn: AsyncConnection,
    *,
    agent_id: uuid.UUID,
    user_id: uuid.UUID,
    folder: Path,
    is_lead: bool,
    platform_dir: Path,
    domains_dir: Path | None = None,
    reason: str,
    summary: str = "",
    start_seq: int | None = None,
) -> int:
    """Insert the next epoch; `start_seq` defaults to the agent's last event seq."""
    prev = await latest(conn, agent_id)
    epoch = 0 if prev is None else prev.epoch + 1
    if start_seq is None:
        start_seq = await last_seq(conn, agent_id)
    semantic_explanation, domain_id, account_type = await _user_context(conn, user_id)
    await conn.execute(
        t.agent_epochs.insert().values(
            agent_id=agent_id,
            epoch=epoch,
            start_seq=start_seq,
            system_prompt=render_system_prompt(
                folder,
                is_lead=is_lead,
                platform_dir=platform_dir,
                semantic_explanation=semantic_explanation,
                domains_dir=domains_dir,
                domain_id=domain_id,
                group_room=account_type == "service",
            ),
            summary=summary,
            reason=reason,
        )
    )
    return epoch
