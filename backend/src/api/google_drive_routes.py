"""Workspace-scoped Google Drive connection endpoints."""

# FastAPI dependencies are intentionally constructed inline to keep the
# permission requirement next to each endpoint.
# ruff: noqa: B008

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
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
from src.services.permissions import (
    DATASET_READ,
    WORKSPACE_SETTINGS_MANAGE,
    WORKSPACE_STORAGE_CONNECT,
)
from src.services.repository import get_repository
from src.services.security import get_audit

router = APIRouter(prefix="/google-drive", tags=["google-drive"])


def _oauth_result_page(*, connected: bool, reason: str | None = None) -> HTMLResponse:
    settings = get_settings()
    frontend_url = settings.google_drive_frontend_url.rstrip("/")
    parsed = urlsplit(frontend_url)
    origin = urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    payload = json.dumps(
        {"type": "p170-google-drive", "status": "connected" if connected else "error", "reason": reason},
        ensure_ascii=False,
    )
    origin_json = json.dumps(origin)
    title = "Google Drive đã kết nối" if connected else "Kết nối Google Drive thất bại"
    message = "Bạn có thể đóng tab này." if connected else (reason or "Bạn có thể đóng tab này và thử lại.")
    html = f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f7fb;color:#17253d}}main{{max-width:440px;padding:28px;border:1px solid #dce4ef;border-radius:14px;background:white;text-align:center}}p{{color:#66758d}}a{{color:#3156d9;font-weight:700}}</style>
</head><body><main><h1>{title}</h1><p id="message"></p><a href="{frontend_url}/datasets/new">Quay lại trang upload</a></main>
<script>
const result = {payload};
const targetOrigin = {origin_json};
document.getElementById("message").textContent = {json.dumps(message, ensure_ascii=False)};
if (window.opener && !window.opener.closed) {{
  try {{ window.opener.postMessage(result, targetOrigin); }} catch (_) {{}}
  window.setTimeout(() => window.close(), 300);
}}
</script></body></html>"""
    return HTMLResponse(html)


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
        "can_connect": WORKSPACE_STORAGE_CONNECT in context.workspace.effective_permissions,
    }


@router.get("/connect")
async def google_drive_connect(
    context: RequestContext = Depends(require_permission(WORKSPACE_STORAGE_CONNECT)),
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
) -> HTMLResponse:
    if error or not code or not state:
        return _oauth_result_page(connected=False, reason="oauth_denied")
    state_row = get_repository().consume_google_drive_oauth_state(state)
    if not state_row:
        return _oauth_result_page(connected=False, reason="invalid_state")
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
        return _oauth_result_page(connected=False, reason=str(exc)[:160])
    except Exception:  # noqa: BLE001
        return _oauth_result_page(connected=False, reason="connection_failed")
    return _oauth_result_page(connected=True)


@router.delete("/connection")
async def delete_google_drive_connection(
    context: RequestContext = Depends(require_permission(WORKSPACE_SETTINGS_MANAGE)),
) -> dict[str, bool]:
    deleted = get_repository().delete_google_drive_connection(context.workspace_id)
    if deleted:
        get_audit().log(
            "connector.deleted",
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            resource_type="connector",
            resource_id=f"google-drive:{context.workspace_id}",
            provider="google_drive",
            outcome="success",
        )
    return {"deleted": deleted}


__all__ = ["router"]
