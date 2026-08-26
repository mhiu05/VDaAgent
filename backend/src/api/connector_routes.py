"""Normalized connector-center endpoints.

Provider-specific routes remain available for compatibility.  This router
exposes safe lifecycle metadata and reusable datasource connections without
ever serializing encrypted configuration or OAuth tokens.
"""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from src.api.dependencies import RequestContext, require_permission
from src.config import get_settings
from src.models.schemas import (
    ConnectorListResponse,
    ConnectorOut,
    ConnectorStatus,
    ConnectorTestResponse,
    DatasourceRequest,
)
from src.services.datasource import DatasourceError, encrypt_config, normalize_config, probe
from src.services.permissions import DATASET_READ, DATASET_UPLOAD
from src.services.repository import get_repository
from src.services.security import get_audit, get_rate_limiter

router = APIRouter(prefix="/connectors", tags=["connectors"])


def _status(value: Any) -> ConnectorStatus:
    try:
        return ConnectorStatus(str(value or "connected"))
    except ValueError:
        return ConnectorStatus.attention_required


def _safe_datasource_target(kind: str, encrypted: str) -> dict[str, Any]:
    """Return display-only target metadata; never return credentials."""
    try:
        from src.services.datasource import decrypt_config

        config = decrypt_config(encrypted)
    except Exception:
        return {}
    if kind == "mysql":
        return {
            "host": str(config.get("host", "")),
            "port": int(config.get("port", 0) or 0),
            "database": str(config.get("database", "")),
            "object": str(config.get("table") or "query"),
        }
    if kind == "mongodb":
        parsed = urlsplit(str(config.get("uri", "")))
        safe_uri = urlunsplit((parsed.scheme, parsed.hostname or "", parsed.path, "", ""))
        return {
            "host": parsed.hostname or "",
            "database": str(config.get("database", "")),
            "object": str(config.get("collection", "")),
            "uri": safe_uri,
        }
    return {
        "file": str(config.get("path", "")).replace("\\", "/").rsplit("/", 1)[-1],
        "object": str(config.get("table") or "query"),
    }


def _connector_from_datasource(row: dict[str, Any], context: RequestContext) -> ConnectorOut:
    provider = str(row.get("kind", ""))
    return ConnectorOut(
        id=f"datasource:{row['id']}",
        provider=provider,
        category="data",
        name=str(row.get("name") or provider),
        owner_scope="workspace",
        owner_user_id=None,
        connected_by_user_id=str(row.get("created_by_user_id")) if row.get("created_by_user_id") else None,
        status=_status(row.get("status")),
        safe_target=_safe_datasource_target(provider, str(row.get("config_encrypted", ""))),
        last_tested_at=row.get("last_tested_at"),
        last_success_at=row.get("last_success_at"),
        last_error_at=row.get("last_error_at"),
        last_error_code=row.get("last_error_code"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        version=int(row.get("version") or 1),
        dataset_count=int(row.get("dataset_count") or 0),
        can_test=DATASET_UPLOAD in context.workspace.effective_permissions,
        can_edit=DATASET_UPLOAD in context.workspace.effective_permissions,
        can_disconnect=DATASET_UPLOAD in context.workspace.effective_permissions,
    )


def _connector_from_drive(row: dict[str, Any] | None, context: RequestContext) -> ConnectorOut:
    settings = get_settings()
    return ConnectorOut(
        id=f"google-drive:{context.workspace_id}",
        provider="google_drive",
        category="storage",
        name="Google Drive",
        owner_scope="workspace",
        connected_by_user_id=str(row.get("connected_by_user_id")) if row and row.get("connected_by_user_id") else None,
        status=_status(row.get("status") if row else "disconnected"),
        safe_target={"folder_configured": bool(row and row.get("folder_id")), "configured": settings.google_drive_configured},
        last_tested_at=row.get("last_tested_at") if row else None,
        last_success_at=row.get("last_success_at") if row else None,
        last_error_at=row.get("last_error_at") if row else None,
        last_error_code=row.get("last_error_code") if row else None,
        created_at=row.get("created_at") if row else None,
        updated_at=row.get("updated_at") if row else None,
        version=int(row.get("version") or 1) if row else 1,
        can_test=DATASET_READ in context.workspace.effective_permissions,
        can_edit=False,
        can_disconnect=DATASET_UPLOAD in context.workspace.effective_permissions,
    )


def _connector_from_calendar(row: dict[str, Any] | None, context: RequestContext) -> ConnectorOut:
    settings = get_settings()
    return ConnectorOut(
        id=f"google-calendar:{context.workspace_id}:{context.user_id}",
        provider="google_calendar",
        category="productivity",
        name="Google Calendar",
        owner_scope="workspace_user",
        owner_user_id=context.user_id,
        status=_status(row.get("status") if row else "disconnected"),
        safe_target={"calendar_id": str(row.get("calendar_id") or settings.google_calendar_default_id) if row else settings.google_calendar_default_id, "configured": settings.google_calendar_configured, "account_label": row.get("account_label") if row else None},
        last_tested_at=row.get("last_tested_at") if row else None,
        last_success_at=row.get("last_success_at") if row else None,
        last_error_at=row.get("last_error_at") if row else None,
        last_error_code=row.get("last_error_code") if row else None,
        created_at=row.get("created_at") if row else None,
        updated_at=row.get("updated_at") if row else None,
        version=int(row.get("version") or 1) if row else 1,
        can_test=DATASET_READ in context.workspace.effective_permissions,
        can_edit=False,
        can_disconnect="calendar.write" in context.workspace.effective_permissions,
    )


@router.get("", response_model=ConnectorListResponse)
async def list_connectors(
    include_available: bool = Query(default=True),
    context: RequestContext = Depends(require_permission(DATASET_READ)),
) -> ConnectorListResponse:
    get_rate_limiter().check(context.user_id)
    repo = get_repository()
    connectors = [_connector_from_datasource(row, context) for row in repo.list_datasource_connections(workspace_id=context.workspace_id)]
    connectors.append(_connector_from_drive(repo.get_google_drive_connection(context.workspace_id), context))
    connectors.append(_connector_from_calendar(repo.get_google_calendar_connection(context.workspace_id, context.user_id), context))
    available = []
    if include_available:
        available = [
            {"provider": "mysql", "category": "data", "name": "MySQL", "description": "Read-only relational source."},
            {"provider": "mongodb", "category": "data", "name": "MongoDB", "description": "Read-only collection source."},
            {"provider": "duckdb", "category": "data", "name": "DuckDB", "description": "Read-only DuckDB file on the backend."},
            {"provider": "google_drive", "category": "storage", "name": "Google Drive", "description": "Workspace dataset storage."},
            {"provider": "google_calendar", "category": "productivity", "name": "Google Calendar", "description": "Personal calendar capability in this workspace."},
        ]
    return ConnectorListResponse(connectors=connectors, available=available)


@router.get("/{connection_id}", response_model=ConnectorOut)
async def get_connector(
    connection_id: str,
    context: RequestContext = Depends(require_permission(DATASET_READ)),
) -> ConnectorOut:
    repo = get_repository()
    if connection_id == f"google-drive:{context.workspace_id}":
        return _connector_from_drive(repo.get_google_drive_connection(context.workspace_id), context)
    if connection_id == f"google-calendar:{context.workspace_id}:{context.user_id}":
        return _connector_from_calendar(repo.get_google_calendar_connection(context.workspace_id, context.user_id), context)
    if not connection_id.startswith("datasource:"):
        raise HTTPException(status_code=404, detail="Connector không tồn tại trong workspace.")
    raw_id = connection_id.removeprefix("datasource:")
    row = repo.get_datasource_connection(raw_id, workspace_id=context.workspace_id)
    if not row or row.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Connector không tồn tại trong workspace.")
    row["dataset_count"] = get_repository().count_datasets_for_datasource(raw_id, workspace_id=context.workspace_id)
    return _connector_from_datasource(row, context)


@router.patch("/{connection_id}", response_model=ConnectorOut)
async def update_saved_datasource(
    connection_id: str,
    request: DatasourceRequest,
    context: RequestContext = Depends(require_permission(DATASET_UPLOAD)),
    expected_version: int | None = Query(default=None, ge=1),
) -> ConnectorOut:
    if not connection_id.startswith("datasource:"):
        raise HTTPException(status_code=404, detail="Connector không tồn tại trong workspace.")
    raw_id = connection_id.removeprefix("datasource:")
    repo = get_repository()
    existing = repo.get_datasource_connection(raw_id, workspace_id=context.workspace_id)
    if not existing or existing.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Connector không tồn tại trong workspace.")
    try:
        normalized = normalize_config(request.kind, request.config)
        await asyncio.to_thread(probe, request.kind, normalized)
        encrypted = encrypt_config(normalized)
    except DatasourceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Không thể kết nối datasource.") from exc
    row = repo.update_datasource_connection(raw_id, workspace_id=context.workspace_id, name=request.name, kind=request.kind, config_encrypted=encrypted, expected_version=expected_version)
    if not row:
        raise HTTPException(status_code=409, detail={"code": "version_conflict", "message": "Connector đã được cập nhật ở tab khác."})
    row["dataset_count"] = repo.count_datasets_for_datasource(raw_id, workspace_id=context.workspace_id)
    get_audit().log("connector.updated", workspace_id=context.workspace_id, actor_user_id=context.user_id, resource_type="connector", resource_id=raw_id, provider=request.kind, outcome="success")
    return _connector_from_datasource(row, context)


@router.post("/datasource", response_model=ConnectorOut, status_code=201)
async def save_datasource_connection(
    request: DatasourceRequest,
    context: RequestContext = Depends(require_permission(DATASET_UPLOAD)),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> ConnectorOut:
    del idempotency_key  # reserved for the durable idempotency table phase
    get_rate_limiter().check(context.user_id)
    try:
        normalized = normalize_config(request.kind, request.config)
        await asyncio.to_thread(probe, request.kind, normalized)
        encrypted = encrypt_config(normalized)
    except DatasourceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Không thể kết nối datasource.") from exc
    connection_id = uuid4().hex
    repo = get_repository()
    repo.create_datasource_connection(
        connection_id,
        workspace_id=context.workspace_id,
        created_by_user_id=context.user_id,
        name=request.name,
        kind=request.kind,
        config_encrypted=encrypted,
    )
    row = repo.get_datasource_connection(connection_id, workspace_id=context.workspace_id)
    if not row:
        raise HTTPException(status_code=500, detail="Không thể lưu datasource.")
    get_audit().log("connector.created", workspace_id=context.workspace_id, actor_user_id=context.user_id, resource_type="connector", resource_id=connection_id, provider=request.kind, outcome="success")
    return _connector_from_datasource(row, context)


@router.post("/datasource/test", response_model=ConnectorTestResponse)
async def test_new_datasource(
    request: DatasourceRequest,
    context: RequestContext = Depends(require_permission(DATASET_UPLOAD)),
) -> ConnectorTestResponse:
    get_rate_limiter().check(context.user_id)
    try:
        normalized = normalize_config(request.kind, request.config)
        objects = await asyncio.to_thread(probe, request.kind, normalized)
    except DatasourceError as exc:
        return ConnectorTestResponse(provider=request.kind, ok=False, status=ConnectorStatus.attention_required, error_code="INVALID_CONFIGURATION", detail=str(exc))
    except Exception:  # noqa: BLE001
        return ConnectorTestResponse(provider=request.kind, ok=False, status=ConnectorStatus.attention_required, error_code="PROVIDER_UNAVAILABLE", detail="Không thể kết nối datasource.")
    return ConnectorTestResponse(provider=request.kind, ok=True, status=ConnectorStatus.connected, objects=objects, detail=f"Kết nối {request.kind} thành công.")


@router.post("/{connection_id}/test", response_model=ConnectorTestResponse)
async def test_saved_datasource(
    connection_id: str,
    context: RequestContext = Depends(require_permission(DATASET_UPLOAD)),
) -> ConnectorTestResponse:
    if not connection_id.startswith("datasource:"):
        raise HTTPException(status_code=404, detail="Connector không tồn tại trong workspace.")
    raw_id = connection_id.removeprefix("datasource:")
    repo = get_repository()
    row = repo.get_datasource_connection(raw_id, workspace_id=context.workspace_id)
    if not row or row.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Connector không tồn tại trong workspace.")
    try:
        from src.services.datasource import decrypt_config

        config = decrypt_config(str(row["config_encrypted"]))
        objects = await asyncio.to_thread(probe, str(row["kind"]), config)
    except DatasourceError:
        row = repo.mark_datasource_health(raw_id, workspace_id=context.workspace_id, ok=False, error_code="SECRET_DECRYPT_FAILED")
        return ConnectorTestResponse(id=connection_id, provider=str(row.get("kind") if row else "unknown"), ok=False, status=ConnectorStatus.attention_required, error_code="SECRET_DECRYPT_FAILED", detail="Không thể giải mã cấu hình. Hãy cập nhật lại connector.")
    except Exception:  # noqa: BLE001
        row = repo.mark_datasource_health(raw_id, workspace_id=context.workspace_id, ok=False, error_code="PROVIDER_UNAVAILABLE")
        return ConnectorTestResponse(id=connection_id, provider=str(row.get("kind") if row else "unknown"), ok=False, status=ConnectorStatus.attention_required, error_code="PROVIDER_UNAVAILABLE", detail="Không thể kết nối datasource.")
    row = repo.mark_datasource_health(raw_id, workspace_id=context.workspace_id, ok=True)
    get_audit().log("connector.tested", workspace_id=context.workspace_id, actor_user_id=context.user_id, resource_type="connector", resource_id=raw_id, provider=str(row.get("kind") if row else "unknown"), outcome="success")
    return ConnectorTestResponse(id=connection_id, provider=str(row.get("kind") if row else "unknown"), ok=True, objects=objects, status=ConnectorStatus.connected, detail="Kết nối datasource thành công.")


@router.delete("/{connection_id}")
async def disconnect_datasource(
    connection_id: str,
    context: RequestContext = Depends(require_permission(DATASET_UPLOAD)),
) -> dict[str, Any]:
    if not connection_id.startswith("datasource:"):
        raise HTTPException(status_code=404, detail="Connector không tồn tại trong workspace.")
    raw_id = connection_id.removeprefix("datasource:")
    repo = get_repository()
    row = repo.get_datasource_connection(raw_id, workspace_id=context.workspace_id)
    if not row or row.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Connector không tồn tại trong workspace.")
    count = repo.count_datasets_for_datasource(raw_id, workspace_id=context.workspace_id)
    if count:
        raise HTTPException(status_code=409, detail={"code": "connection_in_use", "dataset_count": count, "message": "Connector đang được dataset sử dụng."})
    deleted = repo.soft_delete_datasource_connection(raw_id, workspace_id=context.workspace_id)
    if deleted:
        get_audit().log("connector.disconnected", workspace_id=context.workspace_id, actor_user_id=context.user_id, resource_type="connector", resource_id=raw_id, provider=str(row.get("kind")), outcome="success")
    return {"id": connection_id, "deleted": deleted}


__all__ = ["router"]
