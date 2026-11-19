"""Helper library for agent code (doc 11 "Helper library `contoso`", doc 08).

Standard library only. Each helper posts JSON to `$CONTOSO_API_URL/internal/v1/<helper>` with
`$CONTOSO_EXEC_TOKEN`; a non-2xx answer raises `ContosoError(code, message)` (a `ValueError` for bad
arguments, a `RuntimeError` for conflicts such as compaction).
"""

from __future__ import annotations

import os
from collections.abc import Sequence

from contoso._client import ContosoConflictError, ContosoError, ContosoValueError, post

__all__ = [
    "ContosoConflictError",
    "ContosoError",
    "ContosoValueError",
    "end_task",
    "fail_report",
    "publish_dataset",
    "publish_report",
    "queue_task",
    "send_to_agent",
    "send_to_user",
    "start_report",
    "write_summary",
]


def send_to_user(
    text: str | None = None,
    *,
    files: Sequence[str] = (),
    choices: Sequence[dict] | None = None,
    reports: Sequence[str] = (),
    thread: str | None = None,
    reply_to: str | None = None,
    final: bool = False,
) -> str:
    """Send a message the user sees; returns its id. `thread` defaults to CONTOSO_DEFAULT_THREAD."""
    body = {
        "text": text,
        "files": list(files),
        "choices": [dict(c) for c in choices] if choices is not None else None,
        "reports": list(reports),
        "thread": thread if thread is not None else os.environ.get("CONTOSO_DEFAULT_THREAD"),
        "reply_to": reply_to,
        "final": bool(final),
    }
    return post("send_to_user", body)["message_id"]


def send_to_agent(
    receivers: Sequence[str],
    content: str,
    *,
    files: Sequence[str] = (),
    thread: str | None = None,
    reply_to: str | None = None,
) -> str:
    """Message other agents of the team; returns the message id."""
    if isinstance(receivers, str):
        receivers = [receivers]
    body = {
        "receivers": list(receivers),
        "content": content,
        "files": list(files),
        "thread": thread,
        "reply_to": reply_to,
    }
    return post("send_to_agent", body)["message_id"]


def end_task(outcome: str, status: str = "done") -> int:
    """Lead only: end the running task; returns its id."""
    return post("end_task", {"outcome": outcome, "status": status})["task_id"]


def queue_task(description: str) -> int:
    """Lead only: queue a task directly; returns its id."""
    return post("queue_task", {"description": description})["task_id"]


def write_summary(text: str) -> None:
    """During compaction only: set the summary of the next epoch."""
    post("write_summary", {"text": text})


def start_report(
    title: str,
    type: str,
    *,
    projects: Sequence[str] = (),
    markets: Sequence[str] = (),
    report_id: str | None = None,
) -> dict:
    """Start a report attempt; returns `{"report_id", "attempt_id"}`."""
    body = {
        "title": title,
        "type": type,
        "projects": list(projects),
        "markets": list(markets),
        "report_id": report_id,
    }
    resp = post("reports/start", body)
    return {"report_id": resp["report_id"], "attempt_id": resp["attempt_id"]}


def publish_report(
    attempt_id: str,
    schema_path: str,
    *,
    artifacts: Sequence[str] = (),
    evidence: Sequence = (),
    source: str | None = None,
) -> str:
    """Publish a report version from files in the folder; returns the version id."""
    body = {
        "attempt_id": attempt_id,
        "schema_path": schema_path,
        "artifacts": list(artifacts),
        "evidence": list(evidence),
        "source": source,
    }
    return post("reports/publish", body)["version_id"]


def fail_report(attempt_id: str, reason: str) -> None:
    """Mark a report attempt as failed."""
    post("reports/fail", {"attempt_id": attempt_id, "reason": reason})


def publish_dataset(kind: str, path: str) -> str:
    """Publish a dataset (e.g. the dashboard's) from a file in the folder; returns its id."""
    return post("datasets/publish", {"kind": kind, "path": path})["dataset_id"]
