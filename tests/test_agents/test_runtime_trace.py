"""Unit contracts for the additive execution trace foundation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from src.agents.runtime.trace import redact_trace_payload
from src.agents.runtime.versioning import stable_hash
from src.config import Settings


def test_trace_redaction_removes_sensitive_payload_content() -> None:
    payload = redact_trace_payload(
        {
            "token": "must-not-persist",
            "source_ref": "C:/private/dataset.csv",
            "messages": [{"content": "raw prompt"}],
            "count": 3,
            "nested": {"raw_rows": [{"email": "person@example.com"}], "ok": True},
        }
    )

    assert payload["token"] == "[redacted]"
    assert payload["source_ref"] == "[redacted]"
    assert payload["messages"] == "[redacted]"
    assert payload["nested"]["raw_rows"] == "[redacted]"
    assert payload["count"] == 3


def test_stable_hash_is_order_independent() -> None:
    assert stable_hash({"a": 1, "b": [2, 3]}) == stable_hash({"b": [2, 3], "a": 1})


def test_unreleased_planner_flag_fails_closed() -> None:
    with pytest.raises(ValidationError, match="AGENT_PLANNER_ENABLED"):
        Settings(
            database_url="postgresql+psycopg://user:password@localhost/test",
            agent_planner_enabled=True,
        )
