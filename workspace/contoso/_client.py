"""JSON POSTs to `api:8001/internal/v1/*` with the exec token (doc 11). Standard library only."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


class ContosoError(Exception):
    """A helper call failed. `code` and `message` come from the API's error body."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class ContosoValueError(ContosoError, ValueError):
    """Bad arguments (unknown thread, receiver, file …): 400, 404 and 422 responses."""


class ContosoConflictError(ContosoError, RuntimeError):
    """The call isn't allowed right now (for example during compaction): 409 responses."""


def _error_for(status: int, code: str, message: str) -> ContosoError:
    if status in (400, 404, 422):
        return ContosoValueError(code, message)
    if status == 409:
        return ContosoConflictError(code, message)
    return ContosoError(code, message)


TIMEOUT_S = 60


def post(helper: str, body: dict[str, Any]) -> dict[str, Any] | None:
    url = os.environ.get("CONTOSO_API_URL")
    token = os.environ.get("CONTOSO_EXEC_TOKEN")
    if not url or not token:
        raise ContosoError("not_in_exec", "contoso helpers only work inside an agent exec")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/internal/v1/{helper}",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw)
            code, message = str(payload["error"]), str(payload.get("message", ""))
        except (ValueError, KeyError, TypeError):
            code, message = f"http_{e.code}", raw.decode("utf-8", "replace")[:500] or e.reason
        raise _error_for(e.code, code, message) from None
    except urllib.error.URLError as e:
        raise ContosoError("unreachable", f"internal API unreachable: {e.reason}") from None
    return json.loads(raw) if raw else None
