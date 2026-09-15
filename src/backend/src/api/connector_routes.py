"""Connector-center endpoints with a fail-closed database-connector boundary."""

from __future__ import annotations

from typing import Any, NoReturn

from fastapi import APIRouter, Depends, HTTPException

from src.api.dependencies import RequestContext, require_permission
from src.config import DATABASE_CONNECTOR_KINDS, get_settings
from src.models.schemas import (
    ConnectorListResponse,
    ConnectorOut,
    ConnectorStatus,
    DisabledDatabaseConnectorRequest,
)
from src.services.datasource import (
    DatasourceError,
    datasource_error_detail,
    reject_database_connector,
)
from src.services.permissions import DATASET_READ, WORKSPACE_STORAGE_CONNECT
from src.services.repository import get_repository
from src.services.security import get_audit, get_rate_limiter

router = APIRouter(prefix="/connectors", tags=["connectors"])


def _status(value: Any) -> ConnectorStatus:
    try:
        return ConnectorStatus(str(value or "connected"))
    except ValueError:
        return ConnectorStatus.attention_required


def _reject_database_connector(kind: str, context: RequestContext, *, route: str) -> NoReturn:
    """Return one audited, redacted error before a legacy side effect."""

    try:
        reject_database_connector(kind)
    except DatasourceError as exc:
        get_audit().log(
            "database_connector.rejected",
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            provider=str(kind).strip().lower(),
            route=route,
            error_code=exc.code,
            outcome="denied",
        )
        raise HTTPException(status_code=403, detail=datasource_error_detail(exc)) from exc


def _connector_from_datasource(row: dict[str, Any], context: RequestContext) -> ConnectorOut:
    provider = str(row.get("kind", "")).lower()
    # Never decrypt legacy configuration merely to render a card.  The name,
    # provider, status, and dataset count are enough for an Owner to clean it up.
    return ConnectorOut(
        id=f"datasource:{row['id']}",
        provider=provider,
        category="data",
        name=str(row.get("name") or provider),
        owner_scope="workspace",
        owner_user_id=None,
        connected_by_user_id=(
            str(row.get("created_by_user_id")) if row.get("created_by_user_id") else None
        ),
        status=ConnectorStatus.disabled,
        safe_target={"unavailable": True},
        last_tested_at=row.get("last_tested_at"),
        last_success_at=row.get("last_success_at"),
        last_error_at=row.get("last_error_at"),
        last_error_code="database_connectors_disabled",
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        version=int(row.get("version") or 1),
        dataset_count=int(row.get("dataset_count") or 0),
        unavailable=True,
        can_test=False,
        can_edit=False,
        can_disconnect=WORKSPACE_STORAGE_CONNECT in context.workspace.effective_permissions,
    )


def _connector_from_drive(row: dict[str, Any] | None, context: RequestContext) -> ConnectorOut:
    settings = get_settings()
    return ConnectorOut(
        id=f"google-drive:{context.workspace_id}",
        provider="google_drive",
        category="storage",
        name="Google Drive",
        owner_scope="workspace",
        connected_by_user_id=(
            str(row.get("connected_by_user_id"))
            if row and row.get("connected_by_user_id")
            else None
        ),
        status=_status(row.get("status") if row else "disconnected"),
        safe_target={
            "folder_configured": bool(row and row.get("folder_id")),
            "configured": settings.google_drive_configured,
        },
        last_tested_at=row.get("last_tested_at") if row else None,
        last_success_at=row.get("last_success_at") if row else None,
        last_error_at=row.get("last_error_at") if row else None,
        last_error_code=row.get("last_error_code") if row else None,
        created_at=row.get("created_at") if row else None,
        updated_at=row.get("updated_at") if row else None,
        version=int(row.get("version") or 1) if row else 1,
        can_test=WORKSPACE_STORAGE_CONNECT in context.workspace.effective_permissions,
        can_edit=False,
        can_disconnect=WORKSPACE_STORAGE_CONNECT in context.workspace.effective_permissions,
    )


@router.get("", response_model=ConnectorListResponse)
async def list_connectors(
    include_available: bool = True,
    context: RequestContext = Depends(require_permission(DATASET_READ)),
) -> ConnectorListResponse:
    get_rate_limiter().check(context.user_id)
    repo = get_repository()
    connectors = [
        _connector_from_datasource(row, context)
        for row in repo.list_datasource_connections(workspace_id=context.workspace_id)
        if str(row.get("kind", "")).lower() in DATABASE_CONNECTOR_KINDS
    ]
    drive_connection = repo.get_google_drive_connection(context.workspace_id)
    if drive_connection:
        connectors.append(_connector_from_drive(drive_connection, context))
    available = (
        [
            {
                "provider": "google_drive",
                "category": "storage",
                "name": "Google Drive",
                "description": "Import a file into workspace storage.",
            }
        ]
        if include_available
        else []
    )
    return ConnectorListResponse(connectors=connectors, available=available)


@router.get("/{connection_id}", response_model=ConnectorOut)
async def get_connector(
    connection_id: str,
    context: RequestContext = Depends(require_permission(DATASET_READ)),
) -> ConnectorOut:
    repo = get_repository()
    if connection_id == f"google-drive:{context.workspace_id}":
        return _connector_from_drive(repo.get_google_drive_connection(context.workspace_id), context)
    if not connection_id.startswith("datasource:"):
        raise HTTPException(status_code=404, detail="Connector not found in this workspace.")
    raw_id = connection_id.removeprefix("datasource:")
    row = repo.get_datasource_connection(raw_id, workspace_id=context.workspace_id)
    if not row or row.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Connector not found in this workspace.")
    if str(row.get("kind", "")).lower() not in DATABASE_CONNECTOR_KINDS:
        raise HTTPException(status_code=404, detail="Connector not found in this workspace.")
    row["dataset_count"] = repo.count_datasets_for_datasource(
        raw_id, workspace_id=context.workspace_id
    )
    return _connector_from_datasource(row, context)


# Hidden compatibility endpoints deliberately remain deployed long enough for
# older clients to receive a stable, audited domain error instead of a 404.
@router.patch("/{connection_id}", include_in_schema=False)
async def update_saved_datasource(
    connection_id: str,
    request: DisabledDatabaseConnectorRequest,
    context: RequestContext = Depends(require_permission(WORKSPACE_STORAGE_CONNECT)),
) -> None:
    del connection_id
    _reject_database_connector(request.kind, context, route="connector.update")


@router.post("/datasource", status_code=201, include_in_schema=False)
async def save_datasource_connection(
    request: DisabledDatabaseConnectorRequest,
    context: RequestContext = Depends(require_permission(WORKSPACE_STORAGE_CONNECT)),
) -> None:
    _reject_database_connector(request.kind, context, route="connector.create")


@router.post("/datasource/test", include_in_schema=False)
async def test_new_datasource(
    request: DisabledDatabaseConnectorRequest,
    context: RequestContext = Depends(require_permission(WORKSPACE_STORAGE_CONNECT)),
) -> None:
    _reject_database_connector(request.kind, context, route="connector.test_new")


@router.post("/{connection_id}/test", include_in_schema=False)
async def test_saved_datasource(
    connection_id: str,
    context: RequestContext = Depends(require_permission(WORKSPACE_STORAGE_CONNECT)),
) -> None:
    if not connection_id.startswith("datasource:"):
        raise HTTPException(status_code=404, detail="Connector not found in this workspace.")
    raw_id = connection_id.removeprefix("datasource:")
    row = get_repository().get_datasource_connection(
        raw_id, workspace_id=context.workspace_id
    )
    if not row or row.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Connector not found in this workspace.")
    _reject_database_connector(str(row.get("kind", "")), context, route="connector.test_saved")


@router.delete("/{connection_id}")
async def delete_datasource(
    connection_id: str,
    context: RequestContext = Depends(require_permission(WORKSPACE_STORAGE_CONNECT)),
) -> dict[str, Any]:
    if not connection_id.startswith("datasource:"):
        raise HTTPException(status_code=404, detail="Connector not found in this workspace.")
    raw_id = connection_id.removeprefix("datasource:")
    repo = get_repository()
    row = repo.get_datasource_connection(raw_id, workspace_id=context.workspace_id)
    if not row or row.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Connector not found in this workspace.")
    if str(row.get("kind", "")).lower() not in DATABASE_CONNECTOR_KINDS:
        raise HTTPException(status_code=404, detail="Connector not found in this workspace.")
    deleted = repo.soft_delete_datasource_connection(raw_id, workspace_id=context.workspace_id)
    if deleted:
        get_audit().log(
            "connector.deleted",
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            resource_type="connector",
            resource_id=raw_id,
            provider=str(row.get("kind")),
            outcome="success",
        )
    return {"id": connection_id, "deleted": deleted}


__all__ = ["router"]
