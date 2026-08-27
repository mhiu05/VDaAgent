'''Analyst-scoped Google Calendar OAuth and event endpoints.'''

# ruff: noqa: B008

from __future__ import annotations

import asyncio
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator
from src.api.dependencies import RequestContext, require_permission
from src.config import get_settings
from src.services.google_calendar import (
    GoogleCalendarClient,
    GoogleCalendarError,
    GoogleCalendarNotConfiguredError,
    GoogleCalendarOAuth,
    GoogleCalendarOAuthError,
)
from src.services.permissions import CALENDAR_READ, CALENDAR_WRITE
from src.services.repository import get_repository

router = APIRouter(prefix='/calendar', tags=['calendar'])


class CalendarEventCreate(BaseModel):
    summary: str = Field(min_length=1, max_length=200)
    start: datetime
    end: datetime
    time_zone: str = Field(default='Asia/Bangkok', min_length=1, max_length=80)
    description: str = Field(default='', max_length=5000)
    location: str = Field(default='', max_length=500)
    attendees: list[str] = Field(default_factory=list, max_length=50)

    @field_validator('start', 'end')
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError('start/end must include a timezone offset.')
        return value

    @field_validator('attendees')
    @classmethod
    def normalize_attendees(cls, value: list[str]) -> list[str]:
        normalized = []
        for email in value:
            candidate = email.strip().lower()
            if '@' not in candidate or '.' not in candidate.rsplit('@', 1)[-1]:
                raise ValueError(f'Invalid attendee email: {email}')
            normalized.append(candidate)
        return list(dict.fromkeys(normalized))


class CalendarEventUpdate(CalendarEventCreate):
    """Full replacement update; partial updates are normalized client-side."""

    version: int | None = Field(default=None, ge=1)


def _oauth_result_page(*, connected: bool, reason: str | None = None) -> HTMLResponse:
    settings = get_settings()
    frontend_url = settings.google_calendar_frontend_url.rstrip('/')
    parsed = urlsplit(frontend_url)
    origin = urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))
    payload = json.dumps(
        {
            'type': 'p170-google-calendar',
            'status': 'connected' if connected else 'error',
            'reason': reason,
        },
        ensure_ascii=False,
    )
    html = f'''<!doctype html>
<html lang=en><head><meta charset=utf-8><title>Google Calendar</title>
<style>body{{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f7fb;color:#17253d}}main{{max-width:440px;padding:28px;border:1px solid #dce4ef;border-radius:14px;background:white;text-align:center}}p{{color:#66758d}}</style>
</head><body><main><h1>Google Calendar</h1><p id=message></p></main>
<script>
const result = {payload};
const targetOrigin = {json.dumps(origin)};
document.getElementById('message').textContent = result.status === 'connected' ? 'Calendar connected. You can close this tab.' : 'Calendar connection failed.';
if (window.opener && !window.opener.closed) {{
  try {{ window.opener.postMessage(result, targetOrigin); }} catch (_) {{}}
  window.setTimeout(() => window.close(), 300);
}}
</script></body></html>'''
    return HTMLResponse(html)


def _rfc3339(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _client() -> GoogleCalendarClient:
    try:
        return GoogleCalendarClient()
    except GoogleCalendarNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _new_oauth_state_id() -> str:
    return secrets.token_urlsafe(32)


def _oauth_state_expiry(settings: Any) -> datetime:
    return datetime.now(UTC) + timedelta(
        seconds=settings.google_calendar_oauth_state_ttl_seconds
    )


@router.get('/status')
async def calendar_status(
    context: RequestContext = Depends(require_permission(CALENDAR_READ)),
) -> dict[str, Any]:
    settings = get_settings()
    connection = get_repository().get_google_calendar_connection(
        context.workspace_id, context.user_id
    )
    return {
        'provider': 'google_calendar',
        'configured': settings.google_calendar_configured,
        'connected': connection is not None,
        'calendar_id': connection.get('calendar_id') if connection else None,
        'account_label': connection.get('account_label') if connection else None,
        'can_connect': CALENDAR_WRITE in context.workspace.effective_permissions,
    }


@router.get('/connect')
async def calendar_connect(
    context: RequestContext = Depends(require_permission(CALENDAR_WRITE)),
) -> dict[str, str]:
    settings = get_settings()
    try:
        oauth = GoogleCalendarOAuth(settings)
    except GoogleCalendarNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    state_id = _new_oauth_state_id()
    get_repository().create_google_calendar_oauth_state(
        state_id,
        context.workspace_id,
        context.user_id,
        _oauth_state_expiry(settings),
    )
    return {'authorization_url': oauth.authorization_url(state_id)}


@router.get('/callback', include_in_schema=False)
async def calendar_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> HTMLResponse:
    if error or not code or not state:
        return _oauth_result_page(connected=False, reason='oauth_denied')
    state_row = get_repository().consume_google_calendar_oauth_state(state)
    if not state_row:
        return _oauth_result_page(connected=False, reason='invalid_state')
    settings = get_settings()
    try:
        oauth = GoogleCalendarOAuth(settings)
        refresh_token = await asyncio.to_thread(oauth.exchange_code, code)
        get_repository().save_google_calendar_connection(
            state_row['workspace_id'],
            state_row['user_id'],
            settings.google_calendar_default_id,
            oauth.encrypt_refresh_token(refresh_token),
        )
    except (GoogleCalendarError, GoogleCalendarOAuthError) as exc:
        return _oauth_result_page(connected=False, reason=str(exc)[:160])
    except Exception:  # noqa: BLE001
        return _oauth_result_page(connected=False, reason='connection_failed')
    return _oauth_result_page(connected=True)


@router.delete('/connection')
async def calendar_disconnect(
    context: RequestContext = Depends(require_permission(CALENDAR_WRITE)),
) -> dict[str, bool]:
    return {
        'deleted': get_repository().delete_google_calendar_connection(
            context.workspace_id, context.user_id
        )
    }


@router.get('/events')
async def calendar_events(
    time_min: datetime | None = Query(default=None),
    time_max: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    context: RequestContext = Depends(require_permission(CALENDAR_READ)),
) -> dict[str, Any]:
    now = datetime.now(UTC)
    start = time_min or now
    end = time_max or (now + timedelta(days=7))
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise HTTPException(status_code=422, detail='Invalid calendar time window.')
    try:
        events = await asyncio.to_thread(
            _client().list_events,
            context.workspace_id,
            context.user_id,
            time_min=_rfc3339(start),
            time_max=_rfc3339(end),
            limit=limit,
        )
    except GoogleCalendarError as exc:
        get_repository().mark_google_calendar_health(
            context.workspace_id, context.user_id, ok=False, error_code='PROVIDER_UNAVAILABLE'
        )
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    get_repository().mark_google_calendar_health(
        context.workspace_id, context.user_id, ok=True
    )
    return {'events': events, 'time_min': _rfc3339(start), 'time_max': _rfc3339(end)}


@router.get('/events/{event_id}')
async def calendar_get_event(
    event_id: str,
    context: RequestContext = Depends(require_permission(CALENDAR_READ)),
) -> dict[str, Any]:
    if not event_id or len(event_id) > 512:
        raise HTTPException(status_code=422, detail='Invalid event id.')
    try:
        event = await asyncio.to_thread(
            _client().get_event,
            context.workspace_id,
            context.user_id,
            event_id,
        )
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=409, detail='Không thể tải sự kiện Calendar.') from exc
    return {'event': event}


@router.post('/events', status_code=201)
async def calendar_create_event(
    request: CalendarEventCreate,
    context: RequestContext = Depends(require_permission(CALENDAR_WRITE)),
) -> dict[str, Any]:
    if request.end <= request.start:
        raise HTTPException(status_code=422, detail='Event end must be after start.')
    try:
        event = await asyncio.to_thread(
            _client().create_event,
            context.workspace_id,
            context.user_id,
            summary=request.summary,
            start=request.start.isoformat(),
            end=request.end.isoformat(),
            time_zone=request.time_zone,
            description=request.description,
            location=request.location,
            attendees=request.attendees,
        )
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {'event': event}


@router.patch('/events/{event_id}')
async def calendar_update_event(
    event_id: str,
    request: CalendarEventUpdate,
    context: RequestContext = Depends(require_permission(CALENDAR_WRITE)),
) -> dict[str, Any]:
    if not event_id or len(event_id) > 512:
        raise HTTPException(status_code=422, detail='Invalid event id.')
    if request.end <= request.start:
        raise HTTPException(status_code=422, detail='Event end must be after start.')
    try:
        event = await asyncio.to_thread(
            _client().update_event,
            context.workspace_id,
            context.user_id,
            event_id,
            summary=request.summary,
            start=request.start.isoformat(),
            end=request.end.isoformat(),
            time_zone=request.time_zone,
            description=request.description,
            location=request.location,
            attendees=request.attendees,
        )
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=409, detail='Không thể cập nhật sự kiện Calendar.') from exc
    return {'event': event}


@router.delete('/events/{event_id}')
async def calendar_delete_event(
    event_id: str,
    context: RequestContext = Depends(require_permission(CALENDAR_WRITE)),
) -> dict[str, bool]:
    if not event_id or len(event_id) > 512:
        raise HTTPException(status_code=422, detail='Invalid event id.')
    try:
        await asyncio.to_thread(
            _client().delete_event,
            context.workspace_id,
            context.user_id,
            event_id,
        )
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {'deleted': True}


__all__ = ['router']
