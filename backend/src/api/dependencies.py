"""Request-scoped authentication, workspace selection, and permissions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Callable

from fastapi import Depends, Header, HTTPException, status
from src.services import perf_telemetry
from src.services.auth import AuthContext, authenticate_bearer
from src.services.permissions import (
    canonical_role,
    canonical_workspace_role,
    permissions_for_role,
    system_permissions_for_role,
    workspace_permissions_for_role,
)
from src.services.repository import get_repository
import time
from functools import wraps

def ttl_cache(ttl_seconds: int):
    def decorator(func):
        cache = {}
        @wraps(func)
        def wrapper(user, workspace_header, *args, **kwargs):
            # Safe caching key for _resolve_workspace: user_id + workspace_header
            key = (user.user_id, workspace_header)
            if key in cache:
                val, exp = cache[key]
                if time.monotonic() < exp:
                    return val
                del cache[key]
            val = func(user, workspace_header, *args, **kwargs)
            cache[key] = (val, time.monotonic() + ttl_seconds)
            return val
        return wrapper
    return decorator


@dataclass(frozen=True, slots=True)
class WorkspaceContext:
    workspace_id: str
    role: str
    effective_permissions: frozenset[str]


@dataclass(frozen=True, slots=True)
class SystemContext:
    user_id: str
    email: str | None
    role: str
    effective_permissions: frozenset[str]
    status: str


@dataclass(frozen=True, slots=True)
class RequestContext:
    actor: AuthContext
    workspace: WorkspaceContext

    @property
    def user_id(self) -> str:
        return self.actor.user_id

    @property
    def workspace_id(self) -> str:
        return self.workspace.workspace_id


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> AuthContext:
    return authenticate_bearer(authorization)


def require_active_profile(
    user: AuthContext, repo: Any | None = None
) -> dict[str, Any] | None:
    """Return the current active profile for a permanent account.

    A valid JWT alone is insufficient: a system administrator may have locked
    or deleted its user after the token was issued. Guests and the temporary
    legacy principal use dedicated flows and intentionally have no profile.
    """
    if user.is_guest or user.is_legacy:
        return None

    repository = repo or get_repository()
    profile = repository.get_user_profile(user.user_id)
    if not profile or str(profile.get("status", "active")) != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị khóa hoặc vô hiệu hóa.",
        )
    return profile


async def get_active_user(
    user: Annotated[AuthContext, Depends(get_current_user)],
) -> AuthContext:
    """Authenticate and fail closed against the current account record."""
    if not user.is_guest and not user.is_legacy:
        # This refreshes only the identity projection. Stored role/status stay
        # authoritative inside ``sync_user_profile``.
        get_repository().sync_user_profile(user.user_id, user.email)
    require_active_profile(user)
    return user


async def get_active_analyst_user(
    user: Annotated[AuthContext, Depends(get_active_user)],
) -> AuthContext:
    """Require an active Analyst for workspace-entry operations."""
    profile = require_active_profile(user)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ tài khoản Analyst đang hoạt động mới có thể vào workspace.",
        )
    if canonical_role(str(profile.get("role", "analyst"))) == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System Admin không có quyền truy cập Analyst workspace.",
        )
    return user


async def get_current_workspace(
    user: Annotated[AuthContext, Depends(get_active_user)],
    workspace_header: Annotated[str | None, Header(alias="X-Workspace-Id")] = None,
) -> WorkspaceContext:
    # PERF-001: time the whole workspace-resolution phase. SQL run inside is
    # also attributed to db_ms/query_count by the engine hooks; workspace_ms is
    # the wall-clock cost of guard resolution including that SQL.
    with perf_telemetry.timed("workspace_ms"):
        return _resolve_workspace(user, workspace_header)


@ttl_cache(ttl_seconds=30)
def _resolve_workspace(
    user: AuthContext, workspace_header: str | None
) -> WorkspaceContext:
    repo = get_repository()
    profile = repo.get_user_profile(user.user_id)
    if not user.is_guest and not user.is_legacy and not profile:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản không còn hoạt động.")
    if profile and str(profile.get("status", "active")) != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản đã bị khóa hoặc vô hiệu hóa.")
    # System Admin is a separate authorization context and never a workspace
    # superuser, even when a stale membership/header is supplied.
    if profile and canonical_role(str(profile.get("role", "analyst"))) == "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System Admin không có quyền truy cập Analyst workspace.")
    legacy_workspace_id: str | None = None
    if user.is_guest:
        role = str(user.raw_claims.get("role", "analyst"))
        repo.ensure_guest_workspace(user.user_id, role)
    # In dual mode the legacy principal must always map to the one bootstrap
    # workspace, never to an unscoped query.
    if user.is_legacy:
        legacy_workspace_id = repo.ensure_bootstrap_workspace(user.user_id)

    memberships = repo.list_active_workspace_membership_contexts(user.user_id)
    if workspace_header:
        membership = next((item for item in memberships if item["workspace_id"] == workspace_header), None)
        if not membership:
            # Do not reveal whether a workspace id exists outside this tenant.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy workspace.")
    elif legacy_workspace_id:
        # Backward compatibility for scripts/tests using the shared legacy
        # token. New authenticated users with multiple workspaces must still
        # send X-Workspace-Id explicitly below.
        membership = next(
            (item for item in memberships if item["workspace_id"] == legacy_workspace_id),
            None,
        )
        if membership is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Legacy workspace không còn hoạt động.",
            )
    elif len(memberships) == 1:
        membership = memberships[0]
    elif len(memberships) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "workspace_required", "message": "Cần chọn workspace qua X-Workspace-Id."},
        )
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bạn không có membership workspace đang hoạt động.")

    if repo.is_user_locked(user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản của bạn đã bị khóa bởi Quản trị viên hệ thống. Vui lòng liên hệ quản trị để được hỗ trợ mở khóa.",
        )

    role = canonical_workspace_role(str(membership["role"]))

    return WorkspaceContext(
        workspace_id=str(membership["workspace_id"]),
        role=role,
        effective_permissions=workspace_permissions_for_role(role),
    )


async def get_request_context(
    actor: Annotated[AuthContext, Depends(get_active_user)],
    workspace: Annotated[WorkspaceContext, Depends(get_current_workspace)],
) -> RequestContext:
    return RequestContext(actor=actor, workspace=workspace)


def require_permission(permission: str) -> Callable[..., RequestContext]:
    """Create a reusable FastAPI dependency for one capability identifier."""

    async def dependency(
        context: Annotated[RequestContext, Depends(get_request_context)],
    ) -> RequestContext:
        if permission not in context.workspace.effective_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "insufficient_permission", "permission": permission},
            )
        return context

    return dependency


async def get_system_context(
    user: Annotated[AuthContext, Depends(get_active_user)],
) -> SystemContext:
    repo = get_repository()
    
    if repo.is_user_locked(user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản của bạn đã bị khóa bởi Quản trị viên hệ thống. Vui lòng liên hệ quản trị để được hỗ trợ mở khóa.",
        )

    profile = repo.get_user_profile(user.user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản không còn hoạt động.")
    role = canonical_role(str(profile.get("role", "analyst")))
    account_status = str(profile.get("status", "active"))
    if account_status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản đã bị khóa hoặc vô hiệu hóa.")
    
    return SystemContext(
        user_id=user.user_id,
        email=user.email or profile.get("email"),
        role=role,
        effective_permissions=system_permissions_for_role(role),
        status=account_status,
    )


def require_system_permission(permission: str) -> Callable[..., SystemContext]:
    """Create a reusable FastAPI dependency for system capabilities, independent of workspaces."""
    
    async def dependency(
        context: Annotated[SystemContext, Depends(get_system_context)],
    ) -> SystemContext:
        if permission not in context.effective_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "insufficient_permission", "permission": permission},
            )
        return context

    return dependency


__all__ = [
    "RequestContext",
    "SystemContext",
    "WorkspaceContext",
    "get_active_analyst_user",
    "get_active_user",
    "get_current_user",
    "get_current_workspace",
    "get_request_context",
    "get_system_context",
    "require_active_profile",
    "require_permission",
    "require_system_permission",
]
