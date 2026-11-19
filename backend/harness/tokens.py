"""Exec tokens (doc 11 "Exec token") and the running-exec registry.

```text
token = "v1." + agent_id + "." + exec_id + "." + exp + "." + b64url(HMAC_SHA256(SESSION_SECRET,
        "v1|agent_id|exec_id|exp"))
```

`api:8001` accepts a token only if the signature is valid, `exp` hasn't passed, and
`running_exec[agent_id] == exec_id` or that exec ended less than 5 s ago. Tokens are never
stored (doc 10 invariant 7): they live only in the exec's environment.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from dataclasses import dataclass, field

GRACE_S = 5.0
_KEEP_ENDED_S = 120.0


class TokenError(Exception):
    pass


@dataclass(frozen=True)
class ExecContext:
    """Who is calling the internal API, and from which activation."""

    agent_id: uuid.UUID
    user_id: uuid.UUID
    slug: str
    is_lead: bool
    exec_id: str
    trace_id: str
    activation_kind: str
    task_id: int | None
    default_thread: str | None
    folder: str
    compacting: bool = False
    extra: dict = field(default_factory=dict, compare=False)


def _mac(secret: str, agent_id: str, exec_id: str, exp: int) -> str:
    digest = hmac.new(
        secret.encode(), f"v1|{agent_id}|{exec_id}|{exp}".encode(), hashlib.sha256
    ).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def sign(secret: str, agent_id: uuid.UUID, exec_id: str, exp: int) -> str:
    return f"v1.{agent_id}.{exec_id}.{int(exp)}.{_mac(secret, str(agent_id), exec_id, int(exp))}"


class ExecRegistry:
    """`running_exec[agent_id]`, recently ended execs (for the grace period) and `final` flags."""

    def __init__(self) -> None:
        self._running: dict[uuid.UUID, ExecContext] = {}
        self._ended: dict[str, tuple[ExecContext, float]] = {}
        self._final: set[str] = set()

    def start(self, ctx: ExecContext, *, now: float) -> None:
        self._prune(now)
        self._running[ctx.agent_id] = ctx

    def end(self, exec_id: str, *, now: float) -> None:
        for agent_id, ctx in list(self._running.items()):
            if ctx.exec_id == exec_id:
                del self._running[agent_id]
                self._ended[exec_id] = (ctx, now)

    def running(self, agent_id: uuid.UUID) -> str | None:
        ctx = self._running.get(agent_id)
        return ctx.exec_id if ctx else None

    def live(self, agent_id: uuid.UUID, exec_id: str, now: float) -> ExecContext | None:
        ctx = self._running.get(agent_id)
        if ctx is not None and ctx.exec_id == exec_id:
            return ctx
        ended = self._ended.get(exec_id)
        if ended is not None and ended[0].agent_id == agent_id and now - ended[1] < GRACE_S:
            return ended[0]
        return None

    def request_final(self, exec_id: str) -> None:
        self._final.add(exec_id)

    def final_requested(self, exec_id: str) -> bool:
        return exec_id in self._final

    def _prune(self, now: float) -> None:
        for exec_id, (_, ended_at) in list(self._ended.items()):
            if now - ended_at > _KEEP_ENDED_S:
                del self._ended[exec_id]
                self._final.discard(exec_id)


def verify(secret: str, token: str, registry, *, now: float) -> ExecContext:
    try:
        version, agent, exec_id, exp_s, mac = token.split(".")
        agent_id = uuid.UUID(agent)
        exp = int(exp_s)
    except ValueError:
        raise TokenError("malformed token") from None
    if version != "v1":
        raise TokenError("unknown token version")
    if not hmac.compare_digest(mac, _mac(secret, agent, exec_id, exp)):
        raise TokenError("bad signature")
    if now > exp:
        raise TokenError("expired")
    ctx = registry.live(agent_id, exec_id, now)
    if ctx is None:
        raise TokenError("exec is not running")
    return ctx
