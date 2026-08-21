"""Public contracts for workspace, report, and Analyst endpoints."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

WorkspaceRole = Literal["analyst"]


class SelfSignupProvision(BaseModel):
    role: WorkspaceRole = "analyst"


class InvitationCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: WorkspaceRole = "analyst"

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


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    context: WorkspaceContextInput | None = None
    theme: WorkspaceThemeInput | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Tên workspace phải có ít nhất 2 ký tự.")
        return value


class WorkspaceContextInput(BaseModel):
    domain: str | None = Field(default=None, max_length=120)
    primary_goal: str | None = Field(default=None, max_length=500)
    target_audience: str | None = Field(default=None, max_length=120)


class WorkspaceThemeInput(BaseModel):
    primary_color: str = "#315EFB"
    secondary_color: str = "#0F9D91"
    tone: Literal["concise", "professional", "friendly"] = "professional"
    default_language: Literal["vi", "en"] = "vi"

    @field_validator("primary_color", "secondary_color")
    @classmethod
    def validate_hex_color(cls, value: str) -> str:
        value = value.strip()
        if (
            len(value) != 7
            or not value.startswith("#")
            or any(char not in "0123456789abcdefABCDEF" for char in value[1:])
        ):
            raise ValueError("Theme colors must use the #RRGGBB format.")
        return value.upper()


class WorkspaceConfigurationUpdate(BaseModel):
    context: WorkspaceContextInput | None = None
    theme: WorkspaceThemeInput | None = None
    expected_context_version: int | None = Field(default=None, ge=1)
    expected_theme_version: int | None = Field(default=None, ge=1)


class ReportSectionInput(BaseModel):
    kind: Literal[
        "narrative", "methodology", "findings", "limitations", "recommendations"
    ]
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
    visualizations: list[ReportVisualizationInput] = Field(
        default_factory=list, max_length=50
    )


class ReportReviewInput(BaseModel):
    decision: Literal["approved", "changes_requested", "rejected"]
    comment: str | None = Field(default=None, max_length=10_000)


class ReportPublishInput(BaseModel):
    reason: str | None = Field(default=None, max_length=2_000)


class ReportDraftItemCreate(BaseModel):
    item_type: Literal[
        "profile_section", "chart", "agent_answer", "note", "legacy_notebook"
    ]
    query_execution_id: str | None = Field(default=None, max_length=64)
    agent_run_id: str | None = Field(default=None, max_length=64)
    title: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=20_000)
    content: dict[str, Any] | None = None


class ReportDraftItemUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=20_000)


class ReportDraftReorder(BaseModel):
    item_ids: list[str] = Field(min_length=1, max_length=100)
    expected_draft_version: int = Field(ge=1)


__all__ = [
    "InvitationAccept",
    "InvitationCreate",
    "MembershipUpdate",
    "ReportCreate",
    "ReportPublishInput",
    "ReportReviewInput",
    "SelfSignupProvision",
    "WorkspaceCreate",
]
