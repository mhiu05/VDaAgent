"""Admin-only endpoints for user account and system management."""

from __future__ import annotations

from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from src.api.dependencies import SystemContext, require_system_permission
from src.config import get_settings
from src.services.permissions import USER_ACCOUNT_MANAGE, USER_ACCOUNTS_READ
from src.services.repository import get_repository
from src.services.security import get_audit

router = APIRouter(prefix="/admin", tags=["admin"])


class UserStatusPayload(BaseModel):
    status: Literal["active", "locked"] = Field(..., description="Trạng thái tài khoản (active hoặc locked)")
    reason: str | None = Field(default=None, max_length=500, description="Lý do khóa tài khoản")


class UserRolePayload(BaseModel):
    role: Literal["analyst", "admin"] = Field(..., description="Vai trò hệ thống (analyst hoặc admin)")


class UserCreatePayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str | None = Field(default=None, min_length=8, max_length=128)
    send_invite: bool = True


@router.get("/users")
async def list_users(
    context: SystemContext = Depends(require_system_permission(USER_ACCOUNTS_READ)),
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


@router.post("/users", status_code=201)
async def create_user(
    payload: UserCreatePayload,
    request: Request,
    context: SystemContext = Depends(require_system_permission(USER_ACCOUNT_MANAGE)),
) -> dict[str, Any]:
    """Create an Analyst through the server-side Supabase Admin API.

    The service-role/secret key is read only by FastAPI and is never accepted
    from or returned to the browser.  The local profile is created only after
    Supabase confirms the identity.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_backend_key:
        raise HTTPException(status_code=503, detail="Supabase Admin API chưa được cấu hình.")
    email = payload.email.strip().casefold()
    endpoint = "/auth/v1/invite" if payload.send_invite else "/auth/v1/admin/users"
    request_body: dict[str, Any]
    if payload.send_invite:
        # ``POST /invite`` sends Supabase's Invite user email. Creating a user
        # with email confirmation disabled does not send an invitation.
        request_body = {"email": email}
    else:
        if not payload.password:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cần mật khẩu khi không gửi email mời.",
            )
        request_body = {
            "email": email,
            "password": payload.password,
            "email_confirm": True,
        }
    try:
        response = httpx.post(
            f"{settings.supabase_url.rstrip('/')}{endpoint}",
            headers={"apikey": settings.supabase_backend_key, "Authorization": f"Bearer {settings.supabase_backend_key}"},
            json=request_body,
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Không thể kết nối Supabase Auth.") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=409 if response.status_code == 422 else 502, detail="Không thể tạo tài khoản Analyst.")
    try:
        user = response.json()
        if isinstance(user, dict) and isinstance(user.get("user"), dict):
            user = user["user"]
        user_id = str(user["id"])
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Supabase trả về dữ liệu user không hợp lệ.") from exc
    repo = get_repository()
    repo.sync_user_profile(
        user_id,
        email,
        role="analyst",
        allow_default_admin_bootstrap=False,
    )
    created = repo.get_user_profile(user_id) or {"user_id": user_id, "email": email, "role": "analyst", "status": "active"}
    get_audit().log(
        "admin.user.created",
        workspace_id=None,
        actor_user_id=context.user_id,
        resource_type="user_profile",
        resource_id=user_id,
        outcome="success",
        target_email=email,
        target_role="analyst",
        request_id=getattr(request.state, "correlation_id", None),
    )
    return {**created, "invited": payload.send_invite}


@router.post("/users/{user_id}/status")
async def update_user_status(
    user_id: str,
    payload: UserStatusPayload,
    request: Request,
    context: SystemContext = Depends(require_system_permission(USER_ACCOUNT_MANAGE)),
) -> dict[str, Any]:
    """Lock or unlock a user account."""
    if user_id == context.user_id and payload.status == "locked":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bạn không thể tự khóa tài khoản của chính mình.",
        )

    repo = get_repository()
    existing = repo.get_user_profile(user_id)
    if not existing or existing.get("status") == "deleted":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản người dùng.",
        )

    try:
        updated = repo.update_user_status(
            user_id=user_id,
            status=payload.status,
            reason=payload.reason,
            actor_user_id=context.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    get_audit().log(
        "admin.user.status_updated",
        workspace_id=None,
        actor_user_id=context.user_id,
        resource_type="user_profile",
        resource_id=user_id,
        outcome="success",
        action="locked" if payload.status == "locked" else "unlocked",
        target_status=payload.status,
        reason=payload.reason,
        request_id=getattr(request.state, "correlation_id", None),
    )

    return updated


@router.post("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    payload: UserRolePayload,
    request: Request,
    context: SystemContext = Depends(require_system_permission(USER_ACCOUNT_MANAGE)),
) -> dict[str, Any]:
    """Update role for a user (admin / analyst)."""
    if user_id == context.user_id and payload.role != "admin":
        raise HTTPException(status_code=400, detail="Bạn không thể tự hạ quyền System Admin.")
    repo = get_repository()
    existing = repo.get_user_profile(user_id)
    if not existing or existing.get("status") == "deleted":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản người dùng.",
        )

    try:
        updated = repo.update_user_role(
            user_id=user_id,
            role=payload.role,
            actor_user_id=context.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    get_audit().log(
        "admin.user.role_updated",
        workspace_id=None,
        actor_user_id=context.user_id,
        resource_type="user_profile",
        resource_id=user_id,
        outcome="success",
        action="role_changed",
        target_role=payload.role,
        request_id=getattr(request.state, "correlation_id", None),
    )

    return updated


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    request: Request,
    context: SystemContext = Depends(require_system_permission(USER_ACCOUNT_MANAGE)),
) -> dict[str, Any]:
    """Permanently delete a user account."""
    if user_id == context.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bạn không thể tự xóa tài khoản của chính mình.",
        )

    repo = get_repository()
    existing = repo.get_user_profile(user_id)
    if not existing or existing.get("status") == "deleted":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản người dùng.",
        )

    try:
        result = repo.delete_user_account(user_id=user_id, actor_user_id=context.user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e

    get_audit().log(
        "admin.user.deleted",
        workspace_id=None,
        actor_user_id=context.user_id,
        resource_type="user_profile",
        resource_id=user_id,
        outcome="success",
        deleted_email=existing.get("email"),
        request_id=getattr(request.state, "correlation_id", None),
    )

    return result
