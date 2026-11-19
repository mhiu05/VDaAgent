"""Scheduler (doc 02): every second it enforces `TASK_MAX_S` and runs the tick hooks (S8 adds
routines). A failing tick is logged and the loop goes on."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from backend.harness.queue import enforce_task_timeouts

log = logging.getLogger("contoso.harness")


class Scheduler:
    def __init__(self, harness: Any, interval_s: float = 1.0) -> None:
        self.h = harness
        self.interval_s = interval_s
        self.hooks: list[Callable[[Any], Awaitable[Any]]] = [enforce_task_timeouts]
        self._task: asyncio.Task | None = None

    async def tick(self) -> None:
        for hook in self.hooks:
            try:
                await hook(self.h)
            except Exception:
                log.exception("scheduler hook %s failed", getattr(hook, "__name__", hook))

    async def _loop(self) -> None:
        while True:
            await self.tick()
            await asyncio.sleep(self.interval_s)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="scheduler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
