"""Workspace-admin Google Drive connection endpoints."""

# FastAPI dependencies are intentionally constructed inline to keep the
# permission requirement next to each endpoint.
# ruff: noqa: B008

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from src.api.dependencies import RequestContext, require_permission
from src.config import get_settings
from src.services.google_drive import (
    GoogleDriveError,
    GoogleDriveNotConfiguredError,
    GoogleDriveOAuth,
    GoogleDriveOAuthError,
    new_oauth_state_id,
    oauth_state_expiry,
)
from src.services.permissions import DATASET_READ, WORKSPACE_SETTINGS_MANAGE
from src.services.repository import get_repository

router = APIRouter(prefix="/google-drive", tags=["google-drive"])


def _frontend_redirect(path: str, **params: str) -> RedirectResponse:
    settings = get_settings()
    safe_path = path if path.startswith("/") and not path.startswith("//") else "/datasets/new"
    base = settings.google_drive_frontend_url.rstrip("/") + safe_path
    parsed = urlsplit(base)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)
    target = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))
    return RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/status")
async def google_drive_status(
    context: RequestContext = Depends(require_permission(DATASET_READ)),
) -> dict[str, Any]:
    settings = get_settings()
    connection = get_repository().get_google_drive_connection(context.workspace_id)
    provider = settings.guest_storage_provider if context.actor.is_guest else settings.storage_provider
    return {
        "provider": provider,
        "configured": settings.google_drive_configured,
        "connected": connection is not None,
        "folder_id": connection.get("folder_id") if connection else None,
        "can_connect": WORKSPACE_SETTINGS_MANAGE in context.workspace.effective_permissions,
    }


@router.get("/connect")
async def google_drive_connect(
    context: RequestContext = Depends(require_permission(WORKSPACE_SETTINGS_MANAGE)),
) -> dict[str, str]:
    settings = get_settings()
    try:
        oauth = GoogleDriveOAuth(settings)
    except GoogleDriveNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    state_id = new_oauth_state_id()
    get_repository().create_google_drive_oauth_state(
        state_id, context.workspace_id, context.user_id, oauth_state_expiry(settings)
    )
    return {"authorization_url": oauth.authorization_url(state_id)}


@router.get("/callback", include_in_schema=False)
async def google_drive_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> RedirectResponse:
    if error or not code or not state:
        return _frontend_redirect("/datasets/new", google_drive="error", reason="oauth_denied")
    state_row = get_repository().consume_google_drive_oauth_state(state)
    if not state_row:
        return _frontend_redirect("/datasets/new", google_drive="error", reason="invalid_state")
    settings = get_settings()
    try:
        oauth = GoogleDriveOAuth(settings)
        refresh_token = await asyncio.to_thread(oauth.exchange_code, code)
        encrypted = oauth.encrypt_refresh_token(refresh_token)
        get_repository().save_google_drive_connection(
            state_row["workspace_id"],
            settings.google_drive_folder_id,
            encrypted,
            state_row["user_id"],
        )
    except (GoogleDriveError, GoogleDriveOAuthError) as exc:
        return _frontend_redirect("/datasets/new", google_drive="error", reason=str(exc)[:160])
    except Exception:  # noqa: BLE001
        return _frontend_redirect("/datasets/new", google_drive="error", reason="connection_failed")
    return _frontend_redirect("/datasets/new", google_drive="connected")


@router.delete("/connection")
async def google_drive_disconnect(
    context: RequestContext = Depends(require_permission(WORKSPACE_SETTINGS_MANAGE)),
) -> dict[str, bool]:
    return {"deleted": get_repository().delete_google_drive_connection(context.workspace_id)}


__all__ = ["router"]
