"""Admin-only endpoints for user account and system management."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.api.dependencies import RequestContext, require_permission
from src.services.permissions import USER_ACCOUNT_MANAGE, USER_ACCOUNTS_READ
from src.services.repository import get_repository
from src.services.security import get_audit

router = APIRouter(prefix="/admin", tags=["admin"])


class UserStatusPayload(BaseModel):
    status: Literal["active", "locked"] = Field(..., description="Trạng thái tài khoản (active hoặc locked)")
    reason: str | None = Field(default=None, max_length=500, description="Lý do khóa tài khoản")


class UserRolePayload(BaseModel):
    role: Literal["analyst", "admin"] = Field(..., description="Vai trò hệ thống (analyst hoặc admin)")


@router.get("/users")
async def list_users(
    context: RequestContext = Depends(require_permission(USER_ACCOUNTS_READ)),
    search: str | None = Query(default=None, description="Tìm kiếm theo email, tên, user ID"),
    role: str | None = Query(default=None, description="Lọc theo role (admin, analyst, all)"),
    status_filter: str | None = Query(default=None, alias="status", description="Lọc theo status (active, locked, all)"),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Return all users in the system along with stats."""
    repo = get_repository()
    return repo.list_all_users(
        search=search,
        role=role,
        status=status_filter,
        limit=limit,
        offset=offset,
    )


@router.post("/users/{user_id}/status")
async def update_user_status(
    user_id: str,
    payload: UserStatusPayload,
    context: RequestContext = Depends(require_permission(USER_ACCOUNT_MANAGE)),
) -> dict[str, Any]:
    """Lock or unlock a user account."""
    if user_id == context.user_id and payload.status == "locked":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bạn không thể tự khóa tài khoản của chính mình.",
        )

    repo = get_repository()
    existing = repo.get_user_profile(user_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản người dùng.",
        )

    updated = repo.update_user_status(
        user_id=user_id,
        status=payload.status,
        reason=payload.reason,
        actor_user_id=context.user_id,
    )

    get_audit().log(
        "admin.user.status_updated",
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        resource_type="user_profile",
        resource_id=user_id,
        outcome="success",
        target_status=payload.status,
        reason=payload.reason,
    )

    return updated


@router.post("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    payload: UserRolePayload,
    context: RequestContext = Depends(require_permission(USER_ACCOUNT_MANAGE)),
) -> dict[str, Any]:
    """Update role for a user (admin / analyst)."""
    repo = get_repository()
    existing = repo.get_user_profile(user_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản người dùng.",
        )

    updated = repo.update_user_role(
        user_id=user_id,
        role=payload.role,
        actor_user_id=context.user_id,
    )

    get_audit().log(
        "admin.user.role_updated",
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        resource_type="user_profile",
        resource_id=user_id,
        outcome="success",
        target_role=payload.role,
    )

    return updated


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    context: RequestContext = Depends(require_permission(USER_ACCOUNT_MANAGE)),
) -> dict[str, Any]:
    """Permanently delete a user account."""
    if user_id == context.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bạn không thể tự xóa tài khoản của chính mình.",
        )

    repo = get_repository()
    existing = repo.get_user_profile(user_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản người dùng.",
        )

    try:
        result = repo.delete_user_account(user_id=user_id, actor_user_id=context.user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e

    get_audit().log(
        "admin.user.deleted",
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        resource_type="user_profile",
        resource_id=user_id,
        outcome="success",
        deleted_email=existing.get("email"),
    )

    return result
