"""Workspace/member/report APIs guarded by capability-based authorization."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import func, select
from src.api.dependencies import RequestContext, get_current_user, require_permission
from src.config import get_settings
from src.models.auth_schemas import (
    InvitationAccept,
    InvitationCreate,
    MembershipUpdate,
    ReportCreate,
    ReportPublishInput,
    ReportReviewInput,
    SelfSignupProvision,
    WorkspaceCreate,
)
from src.services.auth import AuthContext
from src.services.permissions import (
    REPORT_ARCHIVE,
    REPORT_DRAFT_WRITE,
    REPORT_PUBLISH,
    REPORT_PUBLISHED_READ,
    REPORT_REVIEW,
    REPORT_SUBMIT,
    WORKSPACE_CREATE,
    WORKSPACE_DELETE,
    WORKSPACE_MEMBERS_MANAGE,
    canonical_role,
    permissions_for_role,
    role_can_manage_target,
)
from src.services.repository import (
    analysis_sessions,
    datasets,
    get_repository,
    profile_runs,
    reports,
)
from src.services.security import get_audit

router = APIRouter(tags=["auth", "workspaces", "reports"])


def _audit(context: RequestContext, event: str, **fields: Any) -> None:
    get_audit().log(event, workspace_id=context.workspace_id, actor_user_id=context.user_id, **fields)


def _workspace_items(repo: Any, user_id: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for membership in repo.list_active_memberships_for_user(user_id):
        workspace = repo.get_workspace(str(membership["workspace_id"]))
        if workspace and workspace.get("status") == "active":
            settings = workspace.get("settings") or {}
            items.append({
                "id": workspace["id"],
                "name": workspace["name"],
                "slug": workspace["slug"],
                "role": canonical_role(str(membership["role"])),
                "created_by_user_id": workspace["created_by_user_id"],
                "is_project": isinstance(settings, dict) and bool(settings.get("project_workspace")),
            })
    return items


@router.get("/session")
async def session(
    user: AuthContext = Depends(get_current_user),
    workspace_header: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """Return the authenticated workspace snapshot in one round trip."""
    repo = get_repository()
    if user.is_guest:
        repo.purge_expired_guest_workspaces(get_settings().guest_retention_hours)
        repo.ensure_guest_workspace(user.user_id, str(user.raw_claims.get("role", "analyst")))
    if user.is_legacy:
        repo.ensure_bootstrap_workspace(user.user_id)

    workspaces = _workspace_items(repo, user.user_id)
    if not workspaces:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bạn không có membership workspace đang hoạt động.")
    selected = next((item for item in workspaces if item["id"] == workspace_header), None) if workspace_header else workspaces[0]
    if workspace_header and selected is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy workspace.")
    assert selected is not None
    return {
        "user": {"id": user.user_id, "email": user.email},
        "workspace": {"id": selected["id"], "role": selected["role"]},
        "effective_permissions": sorted(permissions_for_role(selected["role"])),
        "workspaces": workspaces,
    }


@router.get("/me")
async def me(context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_READ))) -> dict[str, Any]:
    repo = get_repository()
    memberships = repo.list_active_memberships_for_user(context.user_id)
    workspaces = []
    for membership in memberships:
        workspace = repo.get_workspace(str(membership["workspace_id"]))
        if workspace:
            workspaces.append({
                "id": workspace["id"], "name": workspace["name"], "slug": workspace["slug"],
                "role": membership["role"], "status": membership["status"],
            })
    return {
        "user": {"id": context.user_id, "email": context.actor.email},
        "workspace": {"id": context.workspace_id, "role": context.workspace.role},
        "effective_permissions": sorted(context.workspace.effective_permissions),
        "workspaces": workspaces,
    }


@router.get("/workspaces")
async def list_my_workspaces(user: AuthContext = Depends(get_current_user)) -> dict[str, Any]:
    repo = get_repository()
    if user.is_guest:
        repo.ensure_guest_workspace(user.user_id, str(user.raw_claims.get("role", "analyst")))
    return {"workspaces": _workspace_items(repo, user.user_id)}


@router.post("/workspaces", status_code=201)
async def create_workspace(payload: WorkspaceCreate, context: RequestContext = Depends(require_permission(WORKSPACE_CREATE))) -> dict[str, Any]:
    workspace = get_repository().create_workspace(context.user_id, payload.name, context.workspace.role)
    _audit(context, "workspace_created", resource_type="workspace", resource_id=workspace["id"], name=workspace["name"])
    return workspace


@router.delete("/workspaces/{workspace_id}/permanent")
async def purge_workspace(workspace_id: str, context: RequestContext = Depends(require_permission(WORKSPACE_DELETE))) -> dict[str, Any]:
    """Permanently delete a project workspace and its owned resources."""
    try:
        deleted = get_repository().purge_workspace(workspace_id, context.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy workspace đang hoạt động.")
    # The workspace row no longer exists, so this audit event is deliberately
    # global (workspace_id=NULL) to avoid violating the audit FK constraint.
    get_audit().log(
        "workspace_purged",
        workspace_id=None,
        actor_user_id=context.user_id,
        resource_type="workspace",
        resource_id=workspace_id,
    )
    return {"deleted": True, "workspace_id": workspace_id}


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str, context: RequestContext = Depends(require_permission(WORKSPACE_DELETE))) -> dict[str, Any]:
    """Archive a project workspace (soft delete) without destroying its data."""
    try:
        deleted = get_repository().delete_workspace(workspace_id, context.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy workspace đang hoạt động.")
    _audit(context, "workspace_archived", resource_type="workspace", resource_id=workspace_id)
    return {"deleted": True, "workspace_id": workspace_id}


@router.post("/onboarding/provision", status_code=201)
async def provision_self_signup(payload: SelfSignupProvision, user: AuthContext = Depends(get_current_user)) -> dict[str, Any]:
    settings = get_settings()
    if not settings.auth_allow_signup:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Self-signup đang tắt.")
    try:
        workspace = get_repository().provision_self_signup_workspace(user.user_id, user.email, payload.role)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    get_audit().log(
        "self_signup_provisioned",
        workspace_id=workspace["workspace_id"],
        actor_user_id=user.user_id,
        resource_type="workspace_membership",
        resource_id=user.user_id,
        target_role=workspace["role"],
    )
    return workspace


@router.delete("/guest/session")
async def cleanup_guest_session(user: AuthContext = Depends(get_current_user)) -> dict[str, bool]:
    if not user.is_guest:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ guest session mới có thể được dọn dẹp.")
    return {"deleted": get_repository().purge_guest_workspace(user.user_id)}


@router.post("/invitations/accept")
async def accept_invitation(payload: InvitationAccept, user: AuthContext = Depends(get_current_user)) -> dict[str, Any]:
    membership = get_repository().accept_invitation(payload.token, user.user_id, user.email)
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lời mời không hợp lệ, hết hạn hoặc không thuộc email này.")
    get_audit().log(
        "invitation_accepted", workspace_id=membership["workspace_id"], actor_user_id=user.user_id,
        resource_type="membership", resource_id=user.user_id,
    )
    return {"workspace_id": membership["workspace_id"], "role": membership["role"]}


@router.get("/workspaces/current/members")
async def list_members(context: RequestContext = Depends(require_permission(WORKSPACE_MEMBERS_MANAGE))) -> dict[str, Any]:
    return {"members": get_repository().list_memberships(context.workspace_id)}


@router.post("/workspaces/current/invitations", status_code=201)
async def invite_member(
    payload: InvitationCreate,
    context: RequestContext = Depends(require_permission(WORKSPACE_MEMBERS_MANAGE)),
) -> dict[str, Any]:
    if not role_can_manage_target(context.workspace.role, payload.role):
        raise HTTPException(status_code=403, detail="Role hiện tại không thể mời role mục tiêu.")
    invitation, _token = get_repository().create_invitation(
        context.workspace_id, payload.email, payload.role, context.user_id,
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    # Sending email is delegated to Supabase Auth in deployment.  The opaque
    # acceptance token is intentionally never returned by this domain API.
    _audit(context, "member_invited", resource_type="invitation", resource_id=invitation["id"], target_email=payload.email, target_role=payload.role)
    return {"id": invitation["id"], "email": invitation["normalized_email"], "role": invitation["role"], "expires_at": invitation["expires_at"], "status": invitation["status"]}


@router.patch("/workspaces/current/members/{user_id}")
async def update_member(
    user_id: str,
    payload: MembershipUpdate,
    context: RequestContext = Depends(require_permission(WORKSPACE_MEMBERS_MANAGE)),
) -> dict[str, Any]:
    repo = get_repository()
    target = repo.get_membership(context.workspace_id, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Không tìm thấy membership.")
    target_role = canonical_role(str(target["role"]))
    next_role = payload.role or target_role
    next_status = payload.status or str(target["status"])
    if not role_can_manage_target(context.workspace.role, target_role) or not role_can_manage_target(context.workspace.role, next_role):
        raise HTTPException(status_code=403, detail="Role hiện tại không thể thay đổi membership này.")
    next_role = canonical_role(next_role)
    membership = repo.save_membership(context.workspace_id, user_id, next_role, next_status)
    _audit(context, "membership_updated", resource_type="membership", resource_id=user_id, target_role=next_role, target_status=next_status)
    return membership


@router.get("/reports")
async def list_published_reports(context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_READ))) -> dict[str, Any]:
    # Viewers only see published snapshots. Analysts/Admins also need to see
    # drafts and in-review reports they create from a completed profile run.
    published_only = context.workspace.role == "viewer"
    return {"reports": get_repository().list_reports(context.workspace_id, published_only=published_only)}


@router.get("/reports/{report_id}")
async def get_published_report(report_id: str, context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_READ))) -> dict[str, Any]:
    published_only = context.workspace.role == "viewer"
    report = get_repository().get_report(report_id, context.workspace_id, published_only=published_only)
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    return report


@router.post("/reports", status_code=201)
async def create_report(payload: ReportCreate, context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE))) -> dict[str, Any]:
    try:
        report = get_repository().create_report(context.workspace_id, context.user_id, payload.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _audit(context, "report_created", resource_type="report", resource_id=report["id"])
    return report


@router.patch("/reports/{report_id}")
async def update_report(report_id: str, payload: ReportCreate, context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE))) -> dict[str, Any]:
    try:
        report = get_repository().update_report_draft(report_id, context.workspace_id, context.user_id, payload.model_dump())
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_updated", resource_type="report", resource_id=report_id)
    return report


@router.delete("/reports/{report_id}")
async def delete_report(report_id: str, context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE))) -> dict[str, Any]:
    try:
        deleted = get_repository().delete_report_draft(report_id, context.workspace_id, context.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_deleted", resource_type="report", resource_id=report_id)
    return {"deleted": True, "report_id": report_id}


@router.post("/reports/{report_id}/submit")
async def submit_report(report_id: str, context: RequestContext = Depends(require_permission(REPORT_SUBMIT))) -> dict[str, Any]:
    try:
        report = get_repository().submit_report(report_id, context.workspace_id, context.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_submitted", resource_type="report", resource_id=report_id)
    return report


@router.post("/reports/{report_id}/review")
async def review_report(report_id: str, payload: ReportReviewInput, context: RequestContext = Depends(require_permission(REPORT_REVIEW))) -> dict[str, Any]:
    if payload.admin_override and context.workspace.role != "admin":
        raise HTTPException(status_code=403, detail="Chỉ admin mới có thể override separation of duties.")
    try:
        report = get_repository().review_report(report_id, context.workspace_id, context.user_id, payload.decision, payload.comment, allow_admin_override=payload.admin_override)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, f"report_{payload.decision}", resource_type="report", resource_id=report_id, admin_override=payload.admin_override)
    return report


@router.post("/reports/{report_id}/publish")
async def publish_report(report_id: str, payload: ReportPublishInput, context: RequestContext = Depends(require_permission(REPORT_PUBLISH))) -> dict[str, Any]:
    if payload.admin_override and context.workspace.role != "admin":
        raise HTTPException(status_code=403, detail="Chỉ admin mới có thể override separation of duties.")
    try:
        report = get_repository().publish_report(report_id, context.workspace_id, context.user_id, allow_admin_override=payload.admin_override, reason=payload.reason)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_published", resource_type="report", resource_id=report_id, admin_override=payload.admin_override)
    return report


@router.post("/reports/{report_id}/archive")
async def archive_report(report_id: str, context: RequestContext = Depends(require_permission(REPORT_ARCHIVE))) -> dict[str, bool]:
    if not get_repository().archive_report(report_id, context.workspace_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_archived", resource_type="report", resource_id=report_id)
    return {"archived": True}


@router.get("/dashboard")
async def dashboard(context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_READ))) -> dict[str, Any]:
    """Small role-discriminated read model; it intentionally excludes raw rows."""
    repo = get_repository()
    if context.workspace.role == "viewer":
        return {"kind": "viewer", "reports": repo.list_reports(context.workspace_id, published_only=True)}
    with repo.engine.begin() as conn:
        counts = {
            "datasets": int(conn.execute(select(func.count()).select_from(datasets).where(datasets.c.workspace_id == context.workspace_id)).scalar() or 0),
            "profiles": int(conn.execute(select(func.count()).select_from(profile_runs).where(profile_runs.c.workspace_id == context.workspace_id)).scalar() or 0),
            "analyses": int(conn.execute(select(func.count()).select_from(analysis_sessions).where(analysis_sessions.c.workspace_id == context.workspace_id)).scalar() or 0),
            "reports": int(conn.execute(select(func.count()).select_from(reports).where(reports.c.workspace_id == context.workspace_id)).scalar() or 0),
        }
    if context.workspace.role == "analyst":
        return {"kind": "analyst", "counts": counts, "reports": repo.list_reports(context.workspace_id)}
    return {"kind": "admin", "counts": counts, "reports": repo.list_reports(context.workspace_id), "pending_review": [r for r in repo.list_reports(context.workspace_id) if r["status"] == "in_review"]}
