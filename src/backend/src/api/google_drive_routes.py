"""Workspace-scoped Google Drive connection endpoints."""

# FastAPI dependencies are intentionally constructed inline to keep the
# permission requirement next to each endpoint.
# ruff: noqa: B008

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path, PurePath
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import HTMLResponse
from src.api.dependencies import RequestContext, require_permission
from src.config import get_settings
from src.services.google_drive import (
    GoogleDriveError,
    GoogleDriveConnector,
    GoogleDriveNotConfiguredError,
    GoogleDriveOAuth,
    GoogleDriveOAuthError,
    new_oauth_state_id,
    oauth_state_expiry,
)
from src.models.schemas import GoogleDriveFileOut, GoogleDriveImportRequest, UploadResponse
from src.services.ingestion import DatasetIngestionService, IngestionError, source_format
from src.services.permissions import (
    DATASET_READ,
    DATASET_UPLOAD,
    WORKSPACE_SETTINGS_MANAGE,
    WORKSPACE_STORAGE_CONNECT,
)
from src.services.repository import get_repository
from src.services.security import get_audit, safe_filename

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
    return {
        "provider": "google_drive",
        "configured": settings.google_drive_configured,
        "connected": connection is not None,
        "folder_id": connection.get("folder_id") if connection else None,
        "can_connect": WORKSPACE_STORAGE_CONNECT in context.workspace.effective_permissions,
    }


@router.get("/files", response_model=list[GoogleDriveFileOut])
async def list_google_drive_files(
    context: RequestContext = Depends(require_permission(DATASET_READ)),
) -> list[GoogleDriveFileOut]:
    """List only files visible to the app's narrow ``drive.file`` scope."""
    try:
        rows = await asyncio.to_thread(
            GoogleDriveConnector().list_files, context.workspace_id
        )
    except GoogleDriveError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return [
        GoogleDriveFileOut(
            id=str(row["id"]),
            name=str(row["name"]),
            size_bytes=int(row["size"]) if row.get("size") else None,
            content_type=str(row.get("mimeType")) if row.get("mimeType") else None,
            revision=str(row.get("version")) if row.get("version") else None,
            modified_at=row.get("modifiedTime"),
        )
        for row in rows
    ]


@router.post("/import", response_model=UploadResponse, status_code=201)
async def import_google_drive_file(
    payload: GoogleDriveImportRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=255),
    context: RequestContext = Depends(require_permission(DATASET_UPLOAD)),
) -> UploadResponse:
    """Copy one Drive file into canonical storage before creating a ready dataset."""
    started = time.perf_counter()
    connector = GoogleDriveConnector()
    settings = get_settings()
    try:
        metadata_started = time.perf_counter()
        metadata = await asyncio.to_thread(
            connector.metadata, context.workspace_id, payload.file_id
        )
        metadata_ms = round((time.perf_counter() - metadata_started) * 1000, 2)
        filename = safe_filename(str(metadata.get("name") or ""))
        source_format(filename)
        declared_size = int(metadata.get("size") or 0)
        limit = settings.security_max_upload_mb * 1024 * 1024
        if declared_size <= 0:
            raise HTTPException(status_code=422, detail="Google Drive file is empty or has no downloadable size.")
        if declared_size > limit:
            raise HTTPException(status_code=413, detail="Google Drive file exceeds the configured upload limit.")
        content_type = str(metadata.get("mimeType") or "application/octet-stream")
        source_metadata = {
            "external_file_id": payload.file_id,
            "external_revision": metadata.get("version"),
            "external_modified_at": metadata.get("modifiedTime"),
            "original_filename": filename,
            "imported_at": datetime.now(UTC).isoformat(),
        }
        ingestion_service = DatasetIngestionService(settings=settings)
        ingestion = await asyncio.to_thread(
            ingestion_service.reserve,
            workspace_id=context.workspace_id,
            user_id=context.user_id,
            idempotency_key=idempotency_key,
            kind="google_drive",
            filename=filename,
            dataset_name=(payload.dataset_name or PurePath(filename).stem).strip(),
            expected_size_bytes=declared_size,
            content_type=content_type,
            source_type="google_drive",
            source_metadata=source_metadata,
        )
        download_ms = 0.0
        if ingestion.get("status") != "finalized":
            fd, temp_name = tempfile.mkstemp(prefix="p170-drive-import-", suffix=PurePath(filename).suffix)
            os.close(fd)
            temporary = Path(temp_name)
            try:
                download_started = time.perf_counter()
                await asyncio.to_thread(
                    connector.download,
                    context.workspace_id,
                    payload.file_id,
                    temporary,
                    max_bytes=limit,
                )
                download_ms = round((time.perf_counter() - download_started) * 1000, 2)
                if temporary.stat().st_size != declared_size:
                    raise IngestionError(
                        "Google Drive file changed while it was being imported.",
                        code="source_changed_during_import",
                        retryable=True,
                    )
                ingestion = await asyncio.to_thread(
                    ingestion_service.ingest_path,
                    temporary,
                    workspace_id=context.workspace_id,
                    user_id=context.user_id,
                    idempotency_key=idempotency_key,
                    kind="google_drive",
                    filename=filename,
                    dataset_name=(payload.dataset_name or PurePath(filename).stem).strip(),
                    content_type=content_type,
                    source_type="google_drive",
                    source_metadata=source_metadata,
                    source_version=str(metadata.get("version") or metadata.get("md5Checksum") or "") or None,
                )
            finally:
                temporary.unlink(missing_ok=True)
    except HTTPException:
        raise
    except (GoogleDriveError, IngestionError, ValueError) as exc:
        status = 409 if isinstance(exc, IngestionError) and exc.code == "idempotency_conflict" else 502
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    dataset = get_repository().get_dataset(
        str(ingestion["dataset_id"]), workspace_id=context.workspace_id
    )
    artifact = get_repository().get_dataset_artifact(
        str(ingestion["artifact_id"]), workspace_id=context.workspace_id
    )
    if not dataset or not artifact:
        raise HTTPException(status_code=500, detail="Imported dataset metadata is missing.")
    get_audit().log(
        "drive.imported",
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        resource_type="dataset",
        resource_id=str(dataset["id"]),
        source_type="google_drive",
        bytes=int(artifact.get("size_bytes") or 0),
        drive_metadata_ms=metadata_ms,
        drive_download_ms=download_ms,
        import_total_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return UploadResponse(
        dataset_ref=str(dataset["source_ref"]),
        dataset_id=str(dataset["id"]),
        filename=filename,
        size_bytes=int(artifact.get("size_bytes") or 0),
        suggested_name=str(dataset["name"]),
    )


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
