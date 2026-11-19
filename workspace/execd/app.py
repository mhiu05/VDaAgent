"""execd HTTP app on :7000 (doc 11 "`execd` API").

`GET /health` is unauthenticated so the compose healthcheck can call it. `POST /exec`
needs `Authorization: Bearer $EXECD_TOKEN`.
"""

from __future__ import annotations

import asyncio
import hmac
import os
from collections import defaultdict
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from execd import run as runner
from execd import snapshot

app = FastAPI(title="execd", docs_url=None, redoc_url=None, openapi_url=None)

# A second guard behind api's job lock: calls for one folder never overlap.
_folder_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


class ExecRequest(BaseModel):
    folder: str
    exec_id: str = Field(min_length=1, max_length=100)
    code: str | None = None
    argv: list[str] | None = None
    timeout_s: float = Field(default=120, gt=0, le=3600)
    author: str = Field(default="contoso-harness", min_length=1, max_length=200)
    env_extra: dict[str, str] = Field(default_factory=dict)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


@app.exception_handler(RequestValidationError)
async def _invalid(request: Request, exc: RequestValidationError) -> JSONResponse:
    return _error(400, "invalid_request", "invalid request body")


def _authorized(request: Request) -> bool:
    expected = os.environ.get("EXECD_TOKEN", "")
    header = request.headers.get("Authorization", "")
    if not expected or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header.removeprefix("Bearer ").encode(), expected.encode())


@app.get("/health")
async def health() -> dict[str, Any]:
    """`fs_isolation`: `landlock` (per-exec folder sandbox enforced), `unavailable` or `off`."""
    return {"ok": True, "fs_isolation": runner.isolation()}


@app.post("/exec", response_model=None)
async def exec_(request: Request, body: ExecRequest) -> dict[str, Any] | JSONResponse:
    if not _authorized(request):
        return _error(401, "unauthenticated", "missing or wrong execd token")
    if (body.code is None) == (body.argv is None) or body.argv == []:
        return _error(400, "invalid_request", "exactly one of code and argv is required")
    folder = runner.resolve_folder(body.folder)
    if folder is None:
        return _error(400, "invalid_folder", "folder must be a git repo under the folders root")

    mem_mb = int(os.environ.get("EXEC_MEM_MB") or 2048)
    async with _folder_locks[str(folder)]:
        old_head = await snapshot.current_head(folder)
        result = await runner.run(
            folder,
            runner.command(folder, body.code, body.argv),
            runner.build_env(folder, body.env_extra),
            body.timeout_s,
            mem_mb,
        )
        snap = await snapshot.take(folder, old_head, body.author, body.exec_id)
    return {
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "duration_ms": result.duration_ms,
        "timed_out": result.timed_out,
        "truncated": result.truncated,
        "head": snap.head,
        "changed": snap.changed,
        "snapshot_error": snap.snapshot_error,
    }
