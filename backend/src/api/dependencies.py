"""Request-scoped authentication, workspace selection, and permissions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Callable

from fastapi import Depends, Header, HTTPException, status
from src.services.auth import AuthContext, authenticate_bearer
from src.services.permissions import canonical_role, permissions_for_role
from src.services.repository import get_repository


@dataclass(frozen=True, slots=True)
class WorkspaceContext:
    workspace_id: str
    role: str
    effective_permissions: frozenset[str]


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


async def get_current_workspace(
    user: Annotated[AuthContext, Depends(get_current_user)],
    workspace_header: Annotated[str | None, Header(alias="X-Workspace-Id")] = None,
) -> WorkspaceContext:
    repo = get_repository()
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

    profile = repo.get_user_profile(user.user_id)
    profile_role = canonical_role(str(profile.get("role", "analyst"))) if profile else "analyst"
    role = canonical_role(str(membership["role"]))
    if profile_role == "admin":
        role = "admin"

    return WorkspaceContext(
        workspace_id=str(membership["workspace_id"]),
        role=role,
        effective_permissions=permissions_for_role(role),
    )


async def get_request_context(
    actor: Annotated[AuthContext, Depends(get_current_user)],
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


__all__ = [
    "RequestContext",
    "WorkspaceContext",
    "get_current_user",
    "get_current_workspace",
    "get_request_context",
    "require_permission",
]
