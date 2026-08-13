"""Public contracts for workspace, report, and administration endpoints."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

WorkspaceRole = Literal["admin", "analyst", "viewer"]


class SelfSignupProvision(BaseModel):
    role: WorkspaceRole


class InvitationCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: WorkspaceRole

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().casefold()
        if "@" not in value:
            raise ValueError("Email không hợp lệ.")
        return value


class InvitationAccept(BaseModel):
    token: str = Field(min_length=24, max_length=512)


class MembershipUpdate(BaseModel):
    role: WorkspaceRole | None = None
    status: Literal["active", "suspended", "removed"] | None = None


class ReportSectionInput(BaseModel):
    kind: Literal["narrative", "methodology", "findings", "limitations", "recommendations"]
    title: str | None = Field(default=None, max_length=255)
    content: dict[str, Any] = Field(default_factory=dict)


class ReportVisualizationInput(BaseModel):
    chart_type: Literal["kpi", "bar", "line", "table"]
    title: str | None = Field(default=None, max_length=255)
    visualization_spec: dict[str, Any] = Field(default_factory=dict)
    query_execution_id: str = Field(min_length=1, max_length=64)


class ReportCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    slug: str | None = Field(default=None, max_length=160)
    executive_summary: str | None = Field(default=None, max_length=20_000)
    scope: dict[str, Any] | None = None
    time_range: dict[str, Any] | None = None
    sections: list[ReportSectionInput] = Field(default_factory=list, max_length=50)
    visualizations: list[ReportVisualizationInput] = Field(default_factory=list, max_length=50)


class ReportReviewInput(BaseModel):
    decision: Literal["approved", "changes_requested", "rejected"]
    comment: str | None = Field(default=None, max_length=10_000)
    admin_override: bool = False


class ReportPublishInput(BaseModel):
    admin_override: bool = False
    reason: str | None = Field(default=None, max_length=2_000)


__all__ = [
    "InvitationAccept",
    "InvitationCreate",
    "MembershipUpdate",
    "ReportCreate",
    "ReportPublishInput",
    "ReportReviewInput",
    "SelfSignupProvision",
]
