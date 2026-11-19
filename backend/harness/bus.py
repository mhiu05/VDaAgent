"""In-process event bus (doc 02): fans out events to SSE subscribers by user id, and raw
`event.appended` events by agent id for admins. Events are `{"type", "data"}` dicts."""

from __future__ import annotations

import asyncio
import contextlib
from collections import defaultdict
from typing import Any

QUEUE_MAX = 1000


class EventBus:
    def __init__(self) -> None:
        self._users: defaultdict[str, set[asyncio.Queue]] = defaultdict(set)
        self._agents: defaultdict[str, set[asyncio.Queue]] = defaultdict(set)
        self._groups: defaultdict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, user_id: Any) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(QUEUE_MAX)
        self._users[str(user_id)].add(q)
        return q

    def unsubscribe(self, user_id: Any, q: asyncio.Queue) -> None:
        self._users[str(user_id)].discard(q)

    def subscribe_agent(self, agent_id: Any) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(QUEUE_MAX)
        self._agents[str(agent_id)].add(q)
        return q

    def unsubscribe_agent(self, agent_id: Any, q: asyncio.Queue) -> None:
        self._agents[str(agent_id)].discard(q)

    def subscribe_group(self, owner_id: Any, q: asyncio.Queue) -> None:
        self._groups[str(owner_id)].add(q)

    def unsubscribe_group(self, owner_id: Any, q: asyncio.Queue) -> None:
        self._groups[str(owner_id)].discard(q)

    @staticmethod
    def _put(queues: set[asyncio.Queue], event: dict[str, Any]) -> None:
        for q in list(queues):
            # a stuck client drops events; it never blocks the harness
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(event)

    def publish(self, user_id: Any, type_: str, data: dict[str, Any]) -> None:
        self._put(self._users.get(str(user_id), set()), {"type": type_, "data": data})

    def publish_agent(self, agent_id: Any, type_: str, data: dict[str, Any]) -> None:
        self._put(self._agents.get(str(agent_id), set()), {"type": type_, "data": data})

    def publish_group(self, owner_id: Any, type_: str, data: dict[str, Any]) -> None:
        self._put(
            self._groups.get(str(owner_id), set()),
            {"type": type_, "data": data, "group_owner": str(owner_id)},
        )
