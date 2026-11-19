"""A service-owned group request goes through Lead, worker, and back to the room."""
# ruff: noqa: E501 -- scenario lines stay readable as executable model responses.

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from backend.db import tables as t
from backend.harness.epochs import open_epoch
from backend.messaging.messages import post_message
from backend.tests.harness.test_flows import settle, stack, until  # noqa: F401


# The live failure: the lead's final `send_to_user` without `thread=` ran in an activation woken
# by a teammate's reply, whose default thread was the lead's own (hidden) direct thread.
# With `mention`, the person @mentioned Data: the lead delegates only once its task says
# `requested_agent: data`.
@pytest.mark.parametrize(
    ("thread_arg", "mention", "worker", "delegate_in_room"),
    [
        (", thread='group:ROOM_ID'", False, "data", False),
        ("", False, "data", False),
        ("", True, "data", False),
        ("", True, "demo-analyst", False),  # a custom agent copied into the group's team
        # the live failure: the lead addressed its delegation to the room, where teammates are
        # not members; it must still reach the teammate privately
        ("", True, "demo-analyst", True),
    ],
    ids=["explicit", "default", "mention", "custom-agent", "delegate-in-room"],
)
async def test_group_ai_request_delegates_and_returns_to_room(
    conn,
    rows,
    settings,
    stack,  # noqa: F811
    thread_arg,
    mention,
    worker,
    delegate_in_room,
):
    domain = await rows.domain("fabrikam")
    alice = await rows.user(username="alice", domain_id=domain)
    owner = await rows.user(
        username="svc.flowtest", domain_id=domain, account_type="service", display_name="Team"
    )
    personal_data = await rows.agent(alice, slug="data")
    other_owner = await rows.user(
        username="svc.othergroup", domain_id=domain, account_type="service", display_name="Other"
    )
    other_group_data = await rows.agent(other_owner, slug="data")
    group = await rows.insert(
        t.groups, technical_owner_id=owner, name="Team", created_by_user_id=alice
    )
    await rows.insert(t.group_members, group_id=group, user_id=alice)
    room = await rows.thread(owner, kind="group", name="Team")
    await rows.insert(t.thread_members, thread_id=room, member_type="user", member_id=alice)
    agents = {}
    for slug, is_lead in (("lead", True), (worker, False)):
        agent_id = await rows.agent(
            owner,
            slug=slug,
            is_lead=is_lead,
            origin="lead" if is_lead else "starter",
        )
        folder = Path(settings.FOLDERS_DIR) / str(owner) / slug
        folder.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=folder, check=True)
        await open_epoch(
            conn,
            agent_id=agent_id,
            user_id=owner,
            folder=folder,
            is_lead=is_lead,
            platform_dir=Path(settings.PLATFORM_DIR),
            domains_dir=Path(settings.DOMAINS_DIR),
            reason="initial",
        )
        agents[slug] = agent_id
    await rows.insert(
        t.thread_members, thread_id=room, member_type="agent", member_id=agents["lead"]
    )

    scenario = r"""
    agents:
      lead:
        - match: {input_contains: "FIRST_MATCH"}
          reply: {tool: "from contoso import send_to_agent\nsend_to_agent(['WORKER'], 'Analyze'DELEGATE_THREAD)"}
        - reply: {text: "Delegated."}
        - match: {input_contains: "from=\"agent:WORKER\""}
          reply: {tool: "from contoso import send_to_user, end_task\nsend_to_user('Kết quả đã có'THREAD_ARG, final=True)\nend_task('done')"}
      WORKER:
        - reply: {tool: "from contoso import send_to_agent\nsend_to_agent(['lead'], 'Analysis complete')"}
        - reply: {text: "done"}
    jev:
      - match: {message_contains: "Vì sao"}
        label: task
      - label: side_question
    """
    first = f"requested_agent: {worker}" if mention else "<begin_task"
    scenario = scenario.replace("FIRST_MATCH", first).replace("THREAD_ARG", thread_arg)
    scenario = scenario.replace("WORKER", worker)
    scenario = scenario.replace(
        "DELEGATE_THREAD", ", thread='group:ROOM_ID'" if delegate_in_room else ""
    )
    h = await stack(scenario.replace("ROOM_ID", str(room)))
    # What a member's open stream receives: the group's public channel (never the owner key).
    member_stream: asyncio.Queue = asyncio.Queue()
    h.bus.subscribe_group(owner, member_stream)
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=room,
            sender_type="user",
            sender_id=alice,
            content={
                "text": "Vì sao căn MAS-U03832 bán chậm?",
                "target": "lead",
                **({"mention": {"slug": worker, "name": worker}} if mention else {}),
            },
            deliver_to={agents["lead"]},
        )

    async def completed():
        async with h.db() as c:
            return (
                await c.scalar(
                    select(t.global_tasks.c.status).where(t.global_tasks.c.user_id == owner)
                )
                == "done"
            )

    await until(completed)
    await settle(h, type("Team", (), {"user": owner})())
    task = (await conn.execute(select(t.global_tasks))).one()
    assert task.user_id == owner
    answer = (
        await conn.execute(
            select(t.messages).where(
                t.messages.c.thread_id == room, t.messages.c.sender_type == "agent"
            )
        )
    ).one()
    assert answer.sender_id == agents["lead"]
    assert "Kết quả" in answer.content["text"]
    internal = (await conn.execute(select(t.threads).where(t.threads.c.kind == "agent"))).one()
    assert internal.user_id == owner
    assert internal.id != room
    assert (await conn.execute(select(t.deliveries.c.agent_id))).scalars().all().count(
        agents[worker]
    ) > 0
    assert {personal_data, other_group_data}.isdisjoint(
        set((await conn.execute(select(t.deliveries.c.agent_id))).scalars().all())
    )
    assert (
        "<group_context>"
        in (
            await conn.execute(
                select(t.agent_epochs.c.system_prompt).where(
                    t.agent_epochs.c.agent_id == agents["lead"]
                )
            )
        ).scalar_one()
    )

    # SEC-1/SEC-2: the Lead→Data and Data→Lead messages never reach the member's stream; the
    # final answer in the room does.
    public = []
    while not member_stream.empty():
        public.append(member_stream.get_nowait())
    assert {e["type"] for e in public} <= {"message.created", "agent.status", "task.updated"}
    messages = [e["data"] for e in public if e["type"] == "message.created"]
    assert {m["thread_id"] for m in messages} == {str(room)}
    assert all("Analyze" not in (m["text"] or "") for m in messages)
    assert all("Analysis complete" not in (m["text"] or "") for m in messages)
    assert any("Kết quả" in (m["text"] or "") for m in messages)
