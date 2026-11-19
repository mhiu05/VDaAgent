"""api's client for the workspace's execd (doc 11 "`execd` API", doc 02 "An exec call")."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

# Room above the exec's own wall clock for process teardown and the git snapshot.
HTTP_MARGIN_S = 60


@dataclass(frozen=True)
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool
    truncated: bool
    head: str | None
    changed: list[dict[str, str]] | None
    snapshot_error: str | None


class ExecdError(Exception):
    def __init__(self, status: int | None, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.status = status
        self.code = code
        self.message = message


class ExecdClient:
    def __init__(
        self, base_url: str, token: str, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def exec(
        self,
        *,
        folder: str,
        exec_id: str,
        timeout_s: float,
        author: str,
        code: str | None = None,
        argv: list[str] | None = None,
        env_extra: dict[str, str] | None = None,
    ) -> ExecResult:
        if (code is None) == (argv is None):
            raise ValueError("exactly one of code and argv")
        body: dict[str, Any] = {"folder": folder, "exec_id": exec_id}
        if code is not None:
            body["code"] = code
        else:
            body["argv"] = list(argv or [])
        body.update({"timeout_s": timeout_s, "author": author, "env_extra": dict(env_extra or {})})
        try:
            r = await self._http.post(
                "/exec", json=body, timeout=httpx.Timeout(10, read=timeout_s + HTTP_MARGIN_S)
            )
        except httpx.HTTPError as e:
            raise ExecdError(None, "unreachable", str(e) or type(e).__name__) from e
        if r.status_code != 200:
            try:
                payload = r.json()
                code_, message = str(payload["error"]), str(payload.get("message", ""))
            except (ValueError, KeyError, TypeError):
                code_, message = f"http_{r.status_code}", r.text[:500]
            raise ExecdError(r.status_code, code_, message)
        data = r.json()
        return ExecResult(**{k: data.get(k) for k in ExecResult.__dataclass_fields__})

    async def health(self) -> bool:
        try:
            r = await self._http.get("/health", timeout=5)
        except httpx.HTTPError:
            return False
        return r.status_code == 200
