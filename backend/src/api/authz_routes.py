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
    ReportDraftItemCreate,
    ReportDraftItemUpdate,
    ReportDraftReorder,
    ReportPublishInput,
    ReportReviewInput,
    SelfSignupProvision,
    WorkspaceConfigurationUpdate,
    WorkspaceCreate,
)
from src.services.auth import AuthContext
from src.services.permissions import (
    REPORT_ARCHIVE,
    REPORT_DRAFT_WRITE,
    REPORT_PUBLISH,
    REPORT_PUBLISHED_EXPORT,
    REPORT_PUBLISHED_READ,
    REPORT_REVIEW,
    REPORT_SUBMIT,
    WORKSPACE_CREATE,
    WORKSPACE_DELETE,
    WORKSPACE_MEMBERS_MANAGE,
    WORKSPACE_SETTINGS_MANAGE,
    canonical_role,
    permissions_for_role,
    role_can_manage_target,
)
from src.services.report_draft_repository import (
    IdempotencyConflictError,
    get_report_draft_repository,
)
from src.services.repository import (
    datasets,
    get_repository,
    profile_runs,
    reports,
)
from src.services.security import get_audit
from src.services.workspace_configuration_repository import (
    ConfigurationStaleError,
    get_workspace_configuration_repository,
)

router = APIRouter(tags=["auth", "workspaces", "reports"])


def _audit(context: RequestContext, event: str, **fields: Any) -> None:
    get_audit().log(
        event,
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        **fields,
    )


def _require_command_center() -> None:
    if not get_settings().ux_command_center_enabled:
        raise HTTPException(status_code=404, detail="Command Center is not enabled.")


def _workspace_items(repo: Any, user_id: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for membership in repo.list_active_memberships_for_user(user_id):
        workspace = repo.get_workspace(str(membership["workspace_id"]))
        if workspace and workspace.get("status") == "active":
            settings = workspace.get("settings") or {}
            items.append(
                {
                    "id": workspace["id"],
                    "name": workspace["name"],
                    "slug": workspace["slug"],
                    "role": canonical_role(str(membership["role"])),
                    "created_by_user_id": workspace["created_by_user_id"],
                    "is_project": isinstance(settings, dict)
                    and bool(settings.get("project_workspace")),
                }
            )
    return items


@router.get("/session")
async def session(
    user: AuthContext = Depends(get_current_user),
    workspace_header: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """Return the authenticated workspace snapshot in one round trip."""
    repo = get_repository()
    if user.is_guest:
        # TTL cleanup can scan old workspaces and delete their storage
        # objects. It belongs in scheduled maintenance, never in a browser
        # request where it could make a new workspace appear unavailable.
        repo.ensure_guest_workspace(
            user.user_id, str(user.raw_claims.get("role", "analyst"))
        )
    else:
        # Keep the application identity projection in sync with the verified
        # Auth claim.
        repo.sync_user_profile(user.user_id, user.email)
    if user.is_legacy:
        repo.ensure_bootstrap_workspace(user.user_id)

    workspaces = _workspace_items(repo, user.user_id)
    if not workspaces and not user.is_guest and get_settings().auth_allow_signup:
        # A first sign-in used to require a second browser round trip to
        # /onboarding/provision. Provisioning here reuses the request that has
        # already verified the Supabase session, so a new account receives its
        # personal workspace before the frontend bootstrap watchdog can fire.
        repo.provision_self_signup_workspace(user.user_id, user.email, "analyst")
        workspaces = _workspace_items(repo, user.user_id)
    if not workspaces:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có membership workspace đang hoạt động.",
        )
    selected = (
        next((item for item in workspaces if item["id"] == workspace_header), None)
        if workspace_header
        else workspaces[0]
    )
    if workspace_header and selected is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy workspace."
        )
    assert selected is not None
    return {
        "user": {"id": user.user_id, "email": user.email},
        "workspace": {"id": selected["id"], "role": selected["role"]},
        "effective_permissions": sorted(permissions_for_role(selected["role"])),
        "workspaces": workspaces,
    }


@router.get("/me")
async def me(
    context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_READ)),
) -> dict[str, Any]:
    repo = get_repository()
    memberships = repo.list_active_memberships_for_user(context.user_id)
    workspaces = []
    for membership in memberships:
        workspace = repo.get_workspace(str(membership["workspace_id"]))
        if workspace:
            workspaces.append(
                {
                    "id": workspace["id"],
                    "name": workspace["name"],
                    "slug": workspace["slug"],
                    "role": membership["role"],
                    "status": membership["status"],
                }
            )
    return {
        "user": {"id": context.user_id, "email": context.actor.email},
        "workspace": {"id": context.workspace_id, "role": context.workspace.role},
        "effective_permissions": sorted(context.workspace.effective_permissions),
        "workspaces": workspaces,
    }


@router.get("/workspaces")
async def list_my_workspaces(
    user: AuthContext = Depends(get_current_user),
) -> dict[str, Any]:
    repo = get_repository()
    if user.is_guest:
        repo.ensure_guest_workspace(
            user.user_id, str(user.raw_claims.get("role", "analyst"))
        )
    return {"workspaces": _workspace_items(repo, user.user_id)}


@router.get("/workspaces/archived")
async def list_my_archived_workspaces(
    context: RequestContext = Depends(require_permission(WORKSPACE_DELETE)),
) -> dict[str, Any]:
    """List archived project workspaces that the current user can restore."""
    return {
        "workspaces": get_repository().list_archived_workspaces_for_user(
            context.user_id
        )
    }


@router.post("/workspaces", status_code=201)
async def create_workspace(
    payload: WorkspaceCreate,
    context: RequestContext = Depends(require_permission(WORKSPACE_CREATE)),
) -> dict[str, Any]:
    workspace = get_repository().create_workspace(
        context.user_id, payload.name, context.workspace.role
    )
    get_workspace_configuration_repository().initialize(
        workspace["id"],
        context.user_id,
        context=payload.context.model_dump() if payload.context else None,
        theme=payload.theme.model_dump() if payload.theme else None,
    )
    _audit(
        context,
        "workspace_created",
        resource_type="workspace",
        resource_id=workspace["id"],
        name=workspace["name"],
    )
    return workspace


@router.get("/workspaces/current/configuration")
async def get_workspace_configuration(
    context: RequestContext = Depends(require_permission(WORKSPACE_SETTINGS_MANAGE)),
) -> dict[str, Any]:
    _require_command_center()
    return get_workspace_configuration_repository().get(
        context.workspace_id, context.user_id
    )


@router.patch("/workspaces/current/configuration")
async def update_workspace_configuration(
    payload: WorkspaceConfigurationUpdate,
    context: RequestContext = Depends(require_permission(WORKSPACE_SETTINGS_MANAGE)),
) -> dict[str, Any]:
    _require_command_center()
    try:
        configuration = get_workspace_configuration_repository().update(
            context.workspace_id, context.user_id, payload.model_dump()
        )
    except ConfigurationStaleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if payload.context is not None:
        _audit(
            context,
            "workspace_context_updated",
            resource_type="workspace",
            resource_id=context.workspace_id,
        )
    if payload.theme is not None:
        _audit(
            context,
            "workspace_theme_updated",
            resource_type="workspace",
            resource_id=context.workspace_id,
        )
    return configuration


@router.get("/profile/{run_id}/report-draft")
async def get_profile_report_draft(
    run_id: str,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    _require_command_center()
    try:
        return get_report_draft_repository().get_or_create(
            context.workspace_id, run_id, context.user_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/profile/{run_id}/report-draft", status_code=201)
async def create_profile_report_draft(
    run_id: str,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    _require_command_center()
    try:
        draft = get_report_draft_repository().get_or_create(
            context.workspace_id, run_id, context.user_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _audit(
        context,
        "report_draft_created",
        resource_type="report",
        resource_id=draft["id"],
        profile_run_id=run_id,
    )
    return draft


@router.delete("/workspaces/{workspace_id}/permanent")
async def purge_workspace(
    workspace_id: str,
    context: RequestContext = Depends(require_permission(WORKSPACE_DELETE)),
) -> dict[str, Any]:
    """Permanently delete a project workspace and its owned resources."""
    try:
        deleted = get_repository().purge_workspace(workspace_id, context.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(
            status_code=404, detail="Không tìm thấy workspace đang hoạt động."
        )
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


@router.post("/workspaces/{workspace_id}/restore")
async def restore_workspace(
    workspace_id: str,
    context: RequestContext = Depends(require_permission(WORKSPACE_DELETE)),
) -> dict[str, Any]:
    try:
        restored = get_repository().restore_workspace(workspace_id, context.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not restored:
        raise HTTPException(
            status_code=404, detail="Không tìm thấy workspace đã lưu trữ."
        )
    _audit(
        context,
        "workspace_restored",
        resource_type="workspace",
        resource_id=workspace_id,
    )
    return {"restored": True, "workspace_id": workspace_id}


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(
    workspace_id: str,
    context: RequestContext = Depends(require_permission(WORKSPACE_DELETE)),
) -> dict[str, Any]:
    """Archive a project workspace (soft delete) without destroying its data."""
    try:
        deleted = get_repository().delete_workspace(workspace_id, context.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(
            status_code=404, detail="Không tìm thấy workspace đang hoạt động."
        )
    _audit(
        context,
        "workspace_archived",
        resource_type="workspace",
        resource_id=workspace_id,
    )
    return {"deleted": True, "workspace_id": workspace_id}


@router.post("/onboarding/provision", status_code=201)
async def provision_self_signup(
    payload: SelfSignupProvision, user: AuthContext = Depends(get_current_user)
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.auth_allow_signup:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Self-signup đang tắt."
        )
    try:
        workspace = get_repository().provision_self_signup_workspace(
            user.user_id, user.email, payload.role
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
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
async def cleanup_guest_session(
    user: AuthContext = Depends(get_current_user),
) -> dict[str, bool]:
    if not user.is_guest:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ guest session mới có thể được dọn dẹp.",
        )
    return {"deleted": get_repository().purge_guest_workspace(user.user_id)}


@router.post("/invitations/accept")
async def accept_invitation(
    payload: InvitationAccept, user: AuthContext = Depends(get_current_user)
) -> dict[str, Any]:
    membership = get_repository().accept_invitation(
        payload.token, user.user_id, user.email
    )
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lời mời không hợp lệ, hết hạn hoặc không thuộc email này.",
        )
    get_audit().log(
        "invitation_accepted",
        workspace_id=membership["workspace_id"],
        actor_user_id=user.user_id,
        resource_type="membership",
        resource_id=user.user_id,
    )
    return {"workspace_id": membership["workspace_id"], "role": membership["role"]}


@router.get("/workspaces/current/members")
async def list_members(
    context: RequestContext = Depends(require_permission(WORKSPACE_MEMBERS_MANAGE)),
) -> dict[str, Any]:
    return {"members": get_repository().list_memberships(context.workspace_id)}


@router.get("/workspaces/current/invitations")
async def list_invitations(
    context: RequestContext = Depends(require_permission(WORKSPACE_MEMBERS_MANAGE)),
) -> dict[str, Any]:
    return {"invitations": get_repository().list_invitations(context.workspace_id)}


@router.post("/workspaces/current/invitations", status_code=201)
async def invite_member(
    payload: InvitationCreate,
    context: RequestContext = Depends(require_permission(WORKSPACE_MEMBERS_MANAGE)),
) -> dict[str, Any]:
    if payload.role != "analyst":
        raise HTTPException(
            status_code=422, detail="Workspace chỉ hỗ trợ role Analyst."
        )
    invitation, _token = get_repository().create_invitation(
        context.workspace_id,
        payload.email,
        payload.role,
        context.user_id,
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    # Sending email is delegated to Supabase Auth in deployment.  The opaque
    # acceptance token is intentionally never returned by this domain API.
    _audit(
        context,
        "member_invited",
        resource_type="invitation",
        resource_id=invitation["id"],
        target_email=payload.email,
        target_role=payload.role,
    )
    return {
        "id": invitation["id"],
        "email": invitation["normalized_email"],
        "role": invitation["role"],
        "expires_at": invitation["expires_at"],
        "status": invitation["status"],
    }


@router.delete("/workspaces/current/invitations/{invitation_id}")
async def cancel_invitation(
    invitation_id: str,
    context: RequestContext = Depends(require_permission(WORKSPACE_MEMBERS_MANAGE)),
) -> dict[str, bool]:
    if not get_repository().cancel_invitation(context.workspace_id, invitation_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy lời mời đang chờ.")
    _audit(
        context,
        "invitation_cancelled",
        resource_type="invitation",
        resource_id=invitation_id,
    )
    return {"cancelled": True}


@router.patch("/workspaces/current/members/{user_id}")
async def update_member(
    user_id: str,
    payload: MembershipUpdate,
    context: RequestContext = Depends(require_permission(WORKSPACE_MEMBERS_MANAGE)),
) -> dict[str, Any]:
    if payload.role is None and payload.status is None:
        raise HTTPException(
            status_code=422, detail="Cần cập nhật role hoặc trạng thái membership."
        )
    repo = get_repository()
    target = repo.get_membership(context.workspace_id, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Không tìm thấy membership.")
    target_role = canonical_role(str(target["role"]))
    next_role = "analyst"
    next_status = payload.status or str(target["status"])
    if not role_can_manage_target(context.workspace.role, target_role):
        raise HTTPException(
            status_code=403, detail="Role hiện tại không thể thay đổi membership này."
        )
    membership = repo.save_membership(
        context.workspace_id, user_id, next_role, next_status
    )
    _audit(
        context,
        "membership_updated",
        resource_type="membership",
        resource_id=user_id,
        target_role=next_role,
        target_status=next_status,
    )
    return membership


@router.get("/reports")
async def list_published_reports(
    context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_READ)),
) -> dict[str, Any]:
    return {
        "reports": get_repository().list_reports(
            context.workspace_id,
            published_only=False,
            exclude_rejected=True,
        )
    }


@router.get("/reports/{report_id}")
async def get_published_report(
    report_id: str,
    context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_READ)),
) -> dict[str, Any]:
    report = get_repository().get_report(
        report_id, context.workspace_id, published_only=False
    )
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    return report


@router.get("/reports/{report_id}/export-source")
async def get_published_report_export_source(
    report_id: str,
    sections: str | None = None,
    context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_EXPORT)),
) -> dict[str, Any]:
    """Return the PII-safe detailed profile payload attached to a published report.

    The payload is generated by the same bounded exporter used for PDF export.
    """
    report = get_repository().get_report(
        report_id, context.workspace_id, published_only=False
    )
    if not report:
        raise HTTPException(
            status_code=404, detail="Không tìm thấy báo cáo đã xuất bản."
        )
    versions = report.get("versions") or []
    scope = versions[0].get("scope") if versions else None
    run_id = scope.get("profile_run_id") if isinstance(scope, dict) else None
    if not isinstance(run_id, str) or not run_id:
        raise HTTPException(
            status_code=409, detail="Báo cáo chưa có profile run để xuất."
        )
    # Keep one implementation of masking and bounded export.  Importing here
    # avoids a router import cycle during application startup.
    from src.api.routes import _report_profile

    payload = _report_profile(run_id, str(report["workspace_id"]), sections)
    repo = get_report_draft_repository()
    snapshot = repo.latest_snapshot(report_id, context.workspace_id)
    if not snapshot:
        draft = repo.get_draft(report_id, context.workspace_id)
        if draft:
            snapshot = {
                "id": draft["id"],
                "title": draft.get("title"),
                "version": draft.get("version", 1),
                "snapshot_hash": "draft",
                "snapshot_at": draft.get("updated_at"),
                "items": draft.get("items", []),
            }
    if snapshot:
        payload["report_snapshot"] = snapshot
    _audit(
        context,
        "report_exported",
        resource_type="report",
        resource_id=report_id,
        profile_run_id=run_id,
    )
    return payload


@router.post("/reports", status_code=201)
async def create_report(
    payload: ReportCreate,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    try:
        report = get_repository().create_report(
            context.workspace_id, context.user_id, payload.model_dump()
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _audit(context, "report_created", resource_type="report", resource_id=report["id"])
    return report


@router.post("/reports/{report_id}/items", status_code=201)
async def pin_report_item(
    report_id: str,
    payload: ReportDraftItemCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    _require_command_center()
    if not idempotency_key:
        raise HTTPException(
            status_code=422,
            detail="Idempotency-Key is required when pinning a report item.",
        )
    try:
        draft = get_report_draft_repository().pin_item(
            report_id,
            context.workspace_id,
            context.user_id,
            payload.model_dump(),
            idempotency_key,
        )
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _audit(
        context,
        "report_item_pinned",
        resource_type="report",
        resource_id=report_id,
        item_type=payload.item_type,
    )
    return draft


@router.patch("/reports/{report_id}/items/reorder")
async def reorder_report_items(
    report_id: str,
    payload: ReportDraftReorder,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    _require_command_center()
    try:
        draft = get_report_draft_repository().reorder(
            report_id,
            context.workspace_id,
            context.user_id,
            payload.item_ids,
            payload.expected_draft_version,
        )
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _audit(
        context, "report_item_reordered", resource_type="report", resource_id=report_id
    )
    return draft


@router.patch("/reports/{report_id}/items/{item_id}")
async def update_report_item(
    report_id: str,
    item_id: str,
    payload: ReportDraftItemUpdate,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    _require_command_center()
    try:
        draft = get_report_draft_repository().update_item(
            report_id,
            item_id,
            context.workspace_id,
            context.user_id,
            payload.model_dump(exclude_unset=True),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _audit(
        context, "report_item_updated", resource_type="report", resource_id=report_id
    )
    return draft


@router.delete("/reports/{report_id}/items/{item_id}")
async def delete_report_item(
    report_id: str,
    item_id: str,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    _require_command_center()
    try:
        draft = get_report_draft_repository().delete_item(
            report_id, item_id, context.workspace_id, context.user_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _audit(
        context, "report_item_unpinned", resource_type="report", resource_id=report_id
    )
    return draft


@router.post("/reports/{report_id}/snapshots", status_code=201)
async def snapshot_report_draft(
    report_id: str,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    _require_command_center()
    try:
        snapshot = get_report_draft_repository().snapshot(
            report_id, context.workspace_id, context.user_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _audit(
        context,
        "report_snapshot_created",
        resource_type="report",
        resource_id=report_id,
        snapshot_hash=snapshot["snapshot_hash"],
    )
    return snapshot


@router.patch("/reports/{report_id}")
async def update_report(
    report_id: str,
    payload: ReportCreate,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    try:
        report = get_repository().update_report_draft(
            report_id, context.workspace_id, context.user_id, payload.model_dump()
        )
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
async def delete_report(
    report_id: str,
    context: RequestContext = Depends(require_permission(REPORT_DRAFT_WRITE)),
) -> dict[str, Any]:
    try:
        deleted = get_repository().delete_report_draft(
            report_id, context.workspace_id, context.user_id
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_deleted", resource_type="report", resource_id=report_id)
    return {"deleted": True, "report_id": report_id}


@router.post("/reports/{report_id}/submit")
async def submit_report(
    report_id: str, context: RequestContext = Depends(require_permission(REPORT_SUBMIT))
) -> dict[str, Any]:
    try:
        # Keep the legacy endpoint for old clients, but publishing is now
        # immediate for Analyst-owned reports and never waits for Admin.
        report = get_repository().publish_report(
            report_id,
            context.workspace_id,
            context.user_id,
            reason="Tự động xuất bản report do Analyst tạo.",
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_published", resource_type="report", resource_id=report_id)
    return report


@router.post("/reports/{report_id}/review")
async def review_report(
    report_id: str,
    payload: ReportReviewInput,
    context: RequestContext = Depends(require_permission(REPORT_REVIEW)),
) -> dict[str, Any]:
    try:
        report = get_repository().review_report(
            report_id,
            context.workspace_id,
            context.user_id,
            payload.decision,
            payload.comment,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(
        context,
        f"report_{payload.decision}",
        resource_type="report",
        resource_id=report_id,
    )
    return report


@router.post("/reports/{report_id}/publish")
async def publish_report(
    report_id: str,
    payload: ReportPublishInput,
    context: RequestContext = Depends(require_permission(REPORT_PUBLISH)),
) -> dict[str, Any]:
    try:
        report = get_repository().publish_report(
            report_id, context.workspace_id, context.user_id, reason=payload.reason
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_published", resource_type="report", resource_id=report_id)
    return report


@router.post("/reports/{report_id}/archive")
async def archive_report(
    report_id: str,
    context: RequestContext = Depends(require_permission(REPORT_ARCHIVE)),
) -> dict[str, bool]:
    if not get_repository().archive_report(report_id, context.workspace_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy report.")
    _audit(context, "report_archived", resource_type="report", resource_id=report_id)
    return {"archived": True}


@router.get("/dashboard")
async def dashboard(
    context: RequestContext = Depends(require_permission(REPORT_PUBLISHED_READ)),
) -> dict[str, Any]:
    """Small Analyst read model; it intentionally excludes raw rows."""
    repo = get_repository()
    with repo.engine.begin() as conn:
        counts = {
            "datasets": int(
                conn.execute(
                    select(func.count())
                    .select_from(datasets)
                    .where(datasets.c.workspace_id == context.workspace_id)
                ).scalar()
                or 0
            ),
            "profiles": int(
                conn.execute(
                    select(func.count())
                    .select_from(profile_runs)
                    .where(profile_runs.c.workspace_id == context.workspace_id)
                ).scalar()
                or 0
            ),
            "reports": int(
                conn.execute(
                    select(func.count())
                    .select_from(reports)
                    .where(reports.c.workspace_id == context.workspace_id)
                ).scalar()
                or 0
            ),
        }
    workspace_reports = repo.list_reports(context.workspace_id)
    return {"kind": "analyst", "counts": counts, "reports": workspace_reports}
