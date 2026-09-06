"""Authenticated production session bootstrap without credential persistence."""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

import httpx


class AuthenticationError(RuntimeError):
    """Raised only after all provided, legitimate login methods fail."""


@dataclass
class AuthenticatedSession:
    access_token: str
    method: str
    session: dict
    refresh_token: str | None = None
    _supabase_url: str = ""
    _publishable_key: str = ""
    _email: str = ""
    _password: str = ""

    def refresh_or_reauthenticate(self, *, api_url: str, timeout: float = 30) -> bool:
        """Refresh/re-authenticate once in memory after an API 401."""
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            if self.refresh_token and self._supabase_url and self._publishable_key:
                refresh = client.post(
                    f"{self._supabase_url}/auth/v1/token?grant_type=refresh_token",
                    headers={"apikey": self._publishable_key},
                    json={"refresh_token": self.refresh_token},
                )
                if refresh.status_code == 200:
                    payload = refresh.json()
                    token = str(payload.get("access_token") or "")
                    if token and (session := _api_session(client, api_url, token)) is not None:
                        self.access_token = token
                        self.refresh_token = str(payload.get("refresh_token") or self.refresh_token)
                        self.session = session
                        self.method = "refreshed_password_session"
                        return True
            if self._email and self._password:
                renewed = authenticate(
                    api_url=api_url,
                    email=self._email,
                    password=self._password,
                    timeout=timeout,
                )
                self.access_token, self.refresh_token = renewed.access_token, renewed.refresh_token
                self.session, self.method = renewed.session, "reauthenticated_password_session"
                return True
        return False


def _api_session(client: httpx.Client, api_url: str, token: str) -> dict | None:
    response = client.get(f"{api_url.rstrip('/')}/session", headers={"Authorization": f"Bearer {token}"})
    return response.json() if response.status_code == 200 else None


def authenticate(*, api_url: str, bearer_token: str = "", email: str = "", password: str = "", timeout: float = 30) -> AuthenticatedSession:
    """Return an application-authenticated session without writing secrets anywhere.

    The normal Supabase password flow is attempted first whenever credentials
    are supplied. A bearer token is only a verified fallback. The caller owns
    all tokens only in memory and must never serialize this object.
    """
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        if email and password:
            supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
            publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
            if not (supabase_url and publishable_key):
                raise AuthenticationError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for password authentication.")
            login = client.post(f"{supabase_url}/auth/v1/token?grant_type=password", headers={"apikey": publishable_key}, json={"email": email, "password": password})
            if login.status_code in {400, 401, 403}:
                raise AuthenticationError(f"SUPABASE_LOGIN_FAILED ({login.status_code}).")
            login.raise_for_status()
            payload = login.json()
            token = str(payload.get("access_token") or "")
            if not token:
                raise AuthenticationError("SUPABASE_LOGIN_FAILED (missing access token).")
            session = _api_session(client, api_url, token)
            if session is None:
                raise AuthenticationError("API_AUTH_FAILED (application /session did not return 2xx).")
            return AuthenticatedSession(token, "password_session", session, str(payload.get("refresh_token") or "") or None, supabase_url, publishable_key, email, password)
        if bearer_token and (session := _api_session(client, api_url, bearer_token)) is not None:
            return AuthenticatedSession(bearer_token, "verified_bearer", session)
        raise AuthenticationError("ENV_MISSING (set VDAGENT_PASSWORD; VDAGENT_EMAIL defaults to the benchmark account).")


def authenticate_local_guest(
    *, api_url: str, timeout: float = 30, identity: str | None = None
) -> AuthenticatedSession:
    """Use the documented local frontend guest-session flow in memory only."""
    subject = (
        uuid.uuid5(uuid.NAMESPACE_URL, f"p170-benchmark:{identity}")
        if identity
        else uuid.uuid4()
    )
    token = f"guest.{subject}.analyst"
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        session = _api_session(client, api_url, token)
    if session is None:
        raise AuthenticationError("LOCAL_GUEST_AUTH_FAILED (local /session did not accept the configured guest flow).")
    return AuthenticatedSession(token, "local_guest", session)
