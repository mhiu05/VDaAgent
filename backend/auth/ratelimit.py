"""Login rate limit: 10 failures per username per 15 minutes, in memory (doc 12).

The window slides: a failure counts for 15 minutes after it happened. A successful login
clears the username's failures. State is per process and lost on restart (PoC).
"""

from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Callable


class LoginLimiter:
    def __init__(
        self,
        max_failures: int = 10,
        window_s: float = 15 * 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_s = window_s
        self.clock = clock
        self._failures: dict[str, deque[float]] = {}

    def _recent(self, username: str) -> deque[float]:
        q = self._failures.get(username)
        if q is None:
            return deque()
        cutoff = self.clock() - self.window_s
        while q and q[0] <= cutoff:
            q.popleft()
        if not q:
            del self._failures[username]
        return q

    def blocked(self, username: str) -> bool:
        return len(self._recent(username)) >= self.max_failures

    def retry_after(self, username: str) -> int:
        """Whole seconds until the username may try again (0 when not blocked)."""
        q = self._recent(username)
        if len(q) < self.max_failures:
            return 0
        oldest_that_blocks = q[len(q) - self.max_failures]
        return max(1, math.ceil(oldest_that_blocks + self.window_s - self.clock()))

    def fail(self, username: str) -> None:
        self._failures.setdefault(username, deque()).append(self.clock())

    def reset(self, username: str) -> None:
        self._failures.pop(username, None)
