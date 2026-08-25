'''Google Calendar OAuth and bounded event operations for one Analyst.'''

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from src.config import Settings, get_settings
from src.services.repository import get_repository

CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'


class GoogleCalendarError(RuntimeError):
    '''Base error for expected calendar integration failures.'''


class GoogleCalendarNotConfiguredError(GoogleCalendarError):
    pass


class GoogleCalendarConnectionRequiredError(GoogleCalendarError):
    pass


class GoogleCalendarOAuthError(GoogleCalendarError):
    pass


class GoogleCalendarOAuth:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        if not self.settings.google_calendar_configured:
            raise GoogleCalendarNotConfiguredError(
                'Missing GOOGLE_CALENDAR_CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, '
                'or TOKEN_ENCRYPTION_KEY.'
            )
        try:
            from google_auth_oauthlib.flow import Flow
        except ImportError as exc:  # pragma: no cover
            raise GoogleCalendarNotConfiguredError(
                'Google OAuth dependencies are missing. Install requirements.txt.'
            ) from exc
        self._flow_cls = Flow

    def _client_config(self) -> dict[str, Any]:
        return {
            'web': {
                'client_id': self.settings.google_calendar_client_id,
                'client_secret': self.settings.google_calendar_client_secret,
                'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                'token_uri': 'https://oauth2.googleapis.com/token',
            }
        }

    def authorization_url(self, state: str) -> str:
        flow = self._flow_cls.from_client_config(
            self._client_config(),
            scopes=[CALENDAR_EVENTS_SCOPE],
            redirect_uri=self.settings.google_calendar_redirect_uri,
            autogenerate_code_verifier=False,
        )
        url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',
            state=state,
        )
        return url

    def exchange_code(self, code: str) -> str:
        flow = self._flow_cls.from_client_config(
            self._client_config(),
            scopes=[CALENDAR_EVENTS_SCOPE],
            redirect_uri=self.settings.google_calendar_redirect_uri,
            autogenerate_code_verifier=False,
        )
        try:
            flow.fetch_token(code=code)
        except Exception as exc:  # noqa: BLE001
            raise GoogleCalendarOAuthError(
                'Google OAuth authorization code exchange failed.'
            ) from exc
        refresh_token = getattr(flow.credentials, 'refresh_token', None)
        if not refresh_token:
            raise GoogleCalendarOAuthError(
                'Google did not return a refresh token. Revoke and reconnect the app.'
            )
        return refresh_token

    def encrypt_refresh_token(self, refresh_token: str) -> str:
        try:
            return Fernet(
                self.settings.google_calendar_token_encryption_key.encode()
            ).encrypt(refresh_token.encode()).decode()
        except Exception as exc:  # noqa: BLE001
            raise GoogleCalendarNotConfiguredError(
                'GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY must be a valid Fernet key.'
            ) from exc

    def decrypt_refresh_token(self, encrypted: str) -> str:
        try:
            return Fernet(
                self.settings.google_calendar_token_encryption_key.encode()
            ).decrypt(encrypted.encode()).decode()
        except (InvalidToken, ValueError) as exc:
            raise GoogleCalendarOAuthError(
                'Stored Google Calendar refresh token cannot be decrypted.'
            ) from exc


class GoogleCalendarClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.oauth = GoogleCalendarOAuth(self.settings)

    def _service(self, workspace_id: str, user_id: str) -> tuple[Any, str]:
        repository = get_repository(self.settings)
        connection = repository.get_google_calendar_connection(workspace_id, user_id)
        if not connection:
            raise GoogleCalendarConnectionRequiredError(
                'This Analyst has not connected Google Calendar in this workspace.'
            )
        try:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build
        except ImportError as exc:  # pragma: no cover
            raise GoogleCalendarNotConfiguredError(
                'Google Calendar dependencies are missing. Install requirements.txt.'
            ) from exc
        credentials = Credentials(
            token=None,
            refresh_token=self.oauth.decrypt_refresh_token(
                connection['encrypted_refresh_token']
            ),
            token_uri='https://oauth2.googleapis.com/token',
            client_id=self.settings.google_calendar_client_id,
            client_secret=self.settings.google_calendar_client_secret,
            scopes=[CALENDAR_EVENTS_SCOPE],
        )
        return (
            build('calendar', 'v3', credentials=credentials, cache_discovery=False),
            str(connection.get('calendar_id') or self.settings.google_calendar_default_id),
        )

    @staticmethod
    def _event(event: dict[str, Any]) -> dict[str, Any]:
        start = event.get('start') or {}
        end = event.get('end') or {}
        return {
            'id': event.get('id'),
            'status': event.get('status'),
            'summary': event.get('summary') or '(untitled)',
            'description': event.get('description') or '',
            'location': event.get('location') or '',
            'html_link': event.get('htmlLink'),
            'start': start.get('dateTime') or start.get('date'),
            'end': end.get('dateTime') or end.get('date'),
            'time_zone': start.get('timeZone'),
            'attendees': [
                {'email': item.get('email'), 'response_status': item.get('responseStatus')}
                for item in (event.get('attendees') or [])
                if item.get('email')
            ],
        }

    def list_events(
        self,
        workspace_id: str,
        user_id: str,
        *,
        time_min: str,
        time_max: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        service, calendar_id = self._service(workspace_id, user_id)
        response = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max(1, min(limit, self.settings.google_calendar_max_events)),
                singleEvents=True,
                orderBy='startTime',
            )
            .execute()
        )
        return [self._event(item) for item in response.get('items', [])]

    def create_event(
        self,
        workspace_id: str,
        user_id: str,
        *,
        summary: str,
        start: str,
        end: str,
        time_zone: str,
        description: str = '',
        location: str = '',
        attendees: list[str] | None = None,
    ) -> dict[str, Any]:
        service, calendar_id = self._service(workspace_id, user_id)
        body: dict[str, Any] = {
            'summary': summary,
            'description': description,
            'location': location,
            'start': {'dateTime': start, 'timeZone': time_zone},
            'end': {'dateTime': end, 'timeZone': time_zone},
        }
        if attendees:
            body['attendees'] = [{'email': email} for email in attendees]
        event = service.events().insert(
            calendarId=calendar_id,
            body=body,
            sendUpdates='all' if attendees else 'none',
        ).execute()
        return self._event(event)

    def delete_event(self, workspace_id: str, user_id: str, event_id: str) -> None:
        service, calendar_id = self._service(workspace_id, user_id)
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()


def default_calendar_window(settings: Settings | None = None) -> tuple[str, str]:
    current = datetime.now(UTC)
    return current.isoformat(), current.replace(hour=23, minute=59, second=59).isoformat()


__all__ = [
    'CALENDAR_EVENTS_SCOPE',
    'GoogleCalendarClient',
    'GoogleCalendarConnectionRequiredError',
    'GoogleCalendarError',
    'GoogleCalendarNotConfiguredError',
    'GoogleCalendarOAuth',
    'GoogleCalendarOAuthError',
    'default_calendar_window',
]
