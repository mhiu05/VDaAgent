"""Notebook LLM API: durable cells, workspace sharing and safe export."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from src.api.dependencies import RequestContext, require_permission
from src.models.notebook_schemas import (
    NotebookCellCreate,
    NotebookCellUpdate,
    NotebookCreate,
    NotebookShare,
    NotebookUpdate,
)
from src.services.notebook_repository import get_notebook_repository
from src.services.permissions import NOTEBOOK_READ, NOTEBOOK_SHARE, NOTEBOOK_WRITE
from src.services.repository import get_repository
from src.services.security import get_audit, get_rate_limiter

router = APIRouter(prefix="/notebooks", tags=["notebooks"])


def _audit(context: RequestContext, event: str, **fields: Any) -> None:
    get_audit().log(
        event,
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        **fields,
    )


def _notebook_or_404(notebook_id: str, context: RequestContext) -> dict[str, Any]:
    item = get_notebook_repository().get(
        notebook_id,
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        role=context.workspace.role,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy notebook trong workspace.")
    return item


@router.get("")
async def list_notebooks(
    profile_run_id: str | None = Query(default=None),
    context: RequestContext = Depends(require_permission(NOTEBOOK_READ)),
) -> list[dict[str, Any]]:
    get_rate_limiter().check(context.user_id)
    items = get_notebook_repository().list(
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        role=context.workspace.role,
    )
    if profile_run_id:
        items = [item for item in items if item["profile_run_id"] == profile_run_id]
    return items


@router.post("", status_code=201)
async def create_notebook(
    payload: NotebookCreate,
    context: RequestContext = Depends(require_permission(NOTEBOOK_WRITE)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        item = get_notebook_repository().create(
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            profile_run_id=payload.profile_run_id,
            title=payload.title,
            description=payload.description,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _audit(context, "notebook_created", resource_type="notebook", resource_id=item["id"], profile_run_id=payload.profile_run_id)
    return item


@router.get("/{notebook_id}")
async def get_notebook(
    notebook_id: str,
    context: RequestContext = Depends(require_permission(NOTEBOOK_READ)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    return _notebook_or_404(notebook_id, context)


@router.patch("/{notebook_id}")
async def update_notebook(
    notebook_id: str,
    payload: NotebookUpdate,
    context: RequestContext = Depends(require_permission(NOTEBOOK_WRITE)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        item = get_notebook_repository().update(
            notebook_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            role=context.workspace.role,
            title=payload.title,
            description=payload.description,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy notebook.")
    _audit(context, "notebook_updated", resource_type="notebook", resource_id=notebook_id)
    return item


@router.post("/{notebook_id}/share")
async def share_notebook(
    notebook_id: str,
    payload: NotebookShare,
    context: RequestContext = Depends(require_permission(NOTEBOOK_SHARE)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        item = get_notebook_repository().set_visibility(
            notebook_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            role=context.workspace.role,
            visibility=payload.visibility,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy notebook.")
    _audit(context, "notebook_shared", resource_type="notebook", resource_id=notebook_id, visibility=payload.visibility)
    return item


@router.delete("/{notebook_id}")
async def archive_notebook(
    notebook_id: str,
    context: RequestContext = Depends(require_permission(NOTEBOOK_WRITE)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        archived = get_notebook_repository().archive(
            notebook_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            role=context.workspace.role,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not archived:
        raise HTTPException(status_code=404, detail="Không tìm thấy notebook.")
    _audit(context, "notebook_archived", resource_type="notebook", resource_id=notebook_id)
    return {"archived": True, "notebook_id": notebook_id}


@router.post("/{notebook_id}/cells", status_code=201)
async def create_cell(
    notebook_id: str,
    payload: NotebookCellCreate,
    context: RequestContext = Depends(require_permission(NOTEBOOK_WRITE)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        cell = get_notebook_repository().add_cell(
            notebook_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            role=context.workspace.role,
            kind=payload.kind,
            source=payload.source,
            title=payload.title,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not cell:
        raise HTTPException(status_code=404, detail="Không tìm thấy notebook.")
    _audit(context, "notebook_cell_created", resource_type="notebook_cell", resource_id=cell["id"], notebook_id=notebook_id, cell_kind=payload.kind)
    return cell


@router.patch("/{notebook_id}/cells/{cell_id}")
async def update_cell(
    notebook_id: str,
    cell_id: str,
    payload: NotebookCellUpdate,
    context: RequestContext = Depends(require_permission(NOTEBOOK_WRITE)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        cell = get_notebook_repository().update_cell(
            notebook_id,
            cell_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            role=context.workspace.role,
            source=payload.source,
            title=payload.title,
            result=payload.result,
            cell_status=payload.status,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not cell:
        raise HTTPException(status_code=404, detail="Không tìm thấy notebook cell.")
    _audit(context, "notebook_cell_updated", resource_type="notebook_cell", resource_id=cell_id, notebook_id=notebook_id, cell_status=cell.get("status"))
    return cell


@router.delete("/{notebook_id}/cells/{cell_id}")
async def delete_cell(
    notebook_id: str,
    cell_id: str,
    context: RequestContext = Depends(require_permission(NOTEBOOK_WRITE)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        deleted = get_notebook_repository().delete_cell(
            notebook_id,
            cell_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            role=context.workspace.role,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy notebook cell.")
    _audit(context, "notebook_cell_deleted", resource_type="notebook_cell", resource_id=cell_id, notebook_id=notebook_id)
    return {"deleted": True, "cell_id": cell_id}


@router.get("/{notebook_id}/export")
async def export_notebook(
    notebook_id: str,
    context: RequestContext = Depends(require_permission(NOTEBOOK_READ)),
) -> Response:
    """Download a bounded JSON report; the UI can print the same snapshot to PDF."""
    get_rate_limiter().check(context.user_id)
    item = _notebook_or_404(notebook_id, context)
    profile = get_repository().full_profile(
        item["profile_run_id"], mask_pii=True, workspace_id=context.workspace_id
    ) or {}
    dataset = profile.get("dataset") or {}
    run = profile.get("run") or {}
    profile_snapshot = {
        "dataset": {
            key: dataset.get(key)
            for key in ("id", "name", "source_type", "created_at", "last_profiled_at")
        },
        "run": {
            key: run.get(key)
            for key in ("id", "version", "created_at", "scan_mode", "row_count", "status", "is_approximate", "risk_warnings", "narrative_report")
        },
        "column_stats": [
            {key: value for key, value in stat.items() if key != "top_k_values"}
            for stat in (profile.get("column_stats") or [])
        ],
    }
    payload = {
        "notebook": {
            key: item.get(key)
            for key in ("id", "title", "description", "visibility", "created_by_user_id", "created_at", "updated_at")
        },
        "profile_snapshot": profile_snapshot,
        "cells": item["cells"],
        "export_policy": {"raw_dataset": False, "raw_rows": False, "pii_values": False},
    }
    _audit(context, "notebook_exported", resource_type="notebook", resource_id=notebook_id, format="json")
    return Response(
        content=json.dumps(payload, ensure_ascii=False, default=str, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="notebook-{notebook_id}.json"', "Cache-Control": "no-store"},
    )


__all__ = ["router"]
