"""Unit contract coverage for the versioned, evidence-safe QA SSE stream."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest

from src.api import routes
from src.models.schemas import QARequest


class _ConnectedRequest:
    async def is_disconnected(self) -> bool:
        return False


class _Repository:
    agent_run: dict[str, Any] | None = None

    def get_profile_run(self, _run_id: str | None, *, workspace_id: str) -> dict[str, Any]:
        assert workspace_id == "workspace-1"
        return {
            "dataset_id": "dataset-1",
            "scan_mode": "full",
            "is_approximate": False,
        }

    def agent_trace_summary(self, _run_id: str, *, workspace_id: str) -> dict[str, Any]:
        assert workspace_id == "workspace-1"
        return {"status": "completed", "terminal": True}

    def get_agent_run(self, _run_id: str | None, *, workspace_id: str) -> dict[str, Any] | None:
        assert workspace_id == "workspace-1"
        return self.agent_run


class _Graph:
    def invoke(self, state: dict[str, Any]) -> dict[str, Any]:
        callback = state.get("progress_callback")
        if callable(callback):
            callback({"stage": "classifying"})
            callback({"stage": "running_tool"})
            callback({"stage": "validating"})
        return {
            "question_type": "quantitative",
            "qa_path": "deterministic_profile",
            "fast_path_intent": "row_count",
            "answer": "The Profile Run contains 10 rows. [S1]",
            "answer_sources": [{
                "type": "tool", "citation_id": "S1", "tool": "get_profile_overview",
                "args": {}, "status": "ok", "profile_run_id": "run-1", "workspace_id": "workspace-1",
            }],
            "evidence_status": "verified",
            "deterministic_claims": [{
                "text": "The Profile Run contains 10 rows. [S1]",
                "citations": [{
                    "citation_id": "S1", "source_type": "tool", "metric": "row_count",
                    "value": 10, "unit": "rows",
                }],
            }],
        }


def _event(frame: str) -> tuple[int, str, dict[str, Any]]:
    lines = dict(line.split(": ", 1) for line in frame.strip().splitlines())
    return int(lines["id"]), lines["event"], json.loads(lines["data"])


def test_qa_stream_contract_is_versioned_ordered_and_evidence_safe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = _Repository()
    monkeypatch.setattr(routes, "get_qa_graph", lambda: _Graph())
    monkeypatch.setattr(routes, "get_repository", lambda: repository)
    monkeypatch.setattr(routes, "start_agent_run", lambda **_kwargs: ("agent-1", True))
    monkeypatch.setattr(routes, "complete_agent_run", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(routes, "fail_agent_run", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(routes, "cancel_agent_run", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(routes, "_audit", lambda *_args, **_kwargs: None)

    async def collect() -> list[str]:
        return [
            frame
            async for frame in routes._qa_stream_frames(
                request=QARequest(
                    question="How many rows are in this dataset?",
                    profile_run_id="run-1",
                    request_id="request-123",
                ),
                request_id="request-123",
                context=SimpleNamespace(workspace_id="workspace-1", user_id="user-1"),
                http_request=_ConnectedRequest(),
                state={},
            )
        ]

    events = [_event(frame) for frame in asyncio.run(collect())]
    ids, names, payloads = zip(*events, strict=True)

    assert ids == tuple(range(1, len(events) + 1))
    assert names[0] == "status"
    assert names[-1] == "done"
    assert all(payload["schema_version"] == "chat_stream.v1" for payload in payloads)
    assert all(payload["request_id"] == "request-123" for payload in payloads)
    token = next(payload for name, payload in zip(names, payloads, strict=True) if name == "token")
    assert token["delivery"] == "validated_replay"
    done = payloads[-1]
    assert done["evidence_status"] == "verified"
    assert done["answer_envelope"]["schema_version"] == "v2"
    assert done["answer_envelope"]["findings"][0]["citations"][0]["value"] == 10
    assert all("workspace_id" not in source for source in next(
        payload["sources"] for name, payload in zip(names, payloads, strict=True) if name == "source"
    ))


def test_qa_stream_replays_a_completed_idempotent_answer_without_new_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = _Repository()
    repository.agent_run = {
        "status": "completed",
        "usage": {
            "chat_recovery": {
                "question_type": "quantitative",
                "answer": "The Profile Run contains 10 rows. [S1]",
                "sources": [{
                    "type": "tool", "citation_id": "S1", "tool": "get_profile_overview",
                    "status": "ok", "profile_run_id": "run-1", "workspace_id": "workspace-1",
                }],
                "evidence_status": "verified",
                "is_approximate": False,
                "answer_detail": "standard",
                "answerability": "answerable",
                "answer_envelope": {
                    "schema_version": "v2", "summary": "The Profile Run contains 10 rows. [S1]",
                    "findings": [], "limitations": [], "actions": [], "evidence_status": "verified",
                    "is_approximate": False, "provenance": {"profile_run_id": "run-1", "agent_run_id": "agent-1"},
                },
            }
        },
    }
    monkeypatch.setattr(routes, "get_repository", lambda: repository)
    monkeypatch.setattr(routes, "get_qa_graph", lambda: (_ for _ in ()).throw(AssertionError("duplicate must not execute graph")))
    monkeypatch.setattr(routes, "start_agent_run", lambda **_kwargs: ("agent-1", False))

    async def collect() -> list[str]:
        return [frame async for frame in routes._qa_stream_frames(
            request=QARequest(question="How many rows are in this dataset?", profile_run_id="run-1", request_id="request-123"),
            request_id="request-123",
            context=SimpleNamespace(workspace_id="workspace-1", user_id="user-1"),
            http_request=_ConnectedRequest(),
            state={},
        )]

    events = [_event(frame) for frame in asyncio.run(collect())]
    names = [name for _, name, _ in events]
    done = events[-1][2]

    assert names == ["status", "status", "meta", "source", "token", "done"]
    assert done["recovered"] is True
    assert done["answer_envelope"]["provenance"]["agent_run_id"] == "agent-1"


def test_qa_stream_reports_in_progress_duplicate_as_reconnectable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = _Repository()
    repository.agent_run = {"status": "running", "usage": {}}
    monkeypatch.setattr(routes, "get_repository", lambda: repository)
    monkeypatch.setattr(routes, "start_agent_run", lambda **_kwargs: ("agent-1", False))

    async def collect() -> list[str]:
        return [frame async for frame in routes._qa_stream_frames(
            request=QARequest(question="How many rows are in this dataset?", profile_run_id="run-1", request_id="request-123"),
            request_id="request-123",
            context=SimpleNamespace(workspace_id="workspace-1", user_id="user-1"),
            http_request=_ConnectedRequest(),
            state={},
        )]

    events = [_event(frame) for frame in asyncio.run(collect())]
    error = events[-1][2]

    assert events[-1][1] == "error"
    assert error["code"] == "REQUEST_IN_PROGRESS"
    assert error["recovery_actions"] == ["reconnect"]
