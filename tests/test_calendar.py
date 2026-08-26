from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.agents.skills.registry import select_skill_for_question
from src.api.calendar_routes import CalendarEventCreate


def test_calendar_question_stays_out_of_mcp_skill_registry() -> None:
    # Calendar is a first-class HTTP capability; it must not be exposed as an
    # Agent/MCP skill. Generic Q&A can still answer with a safe redirect.
    assert select_skill_for_question('Hẹn lịch review profile ngày mai') != 'calendar-assistant'


def test_calendar_event_requires_timezone_and_ordered_window() -> None:
    with pytest.raises(ValidationError):
        CalendarEventCreate(
            summary='Missing timezone',
            start='2026-08-25T09:00:00',
            end='2026-08-25T10:00:00',
        )

    event = CalendarEventCreate(
        summary='Review profile',
        start='2026-08-25T09:00:00+07:00',
        end='2026-08-25T10:00:00+07:00',
    )
    assert event.start < event.end
