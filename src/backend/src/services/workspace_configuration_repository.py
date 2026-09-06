"""Versioned workspace Context and Theme persistence.

Configuration is tenant-scoped data, not a prompt template.  The repository
only stores bounded structured fields and uses optimistic versions so a stale
settings page cannot overwrite a concurrent edit.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

# pyrefly: ignore [missing-import]
from sqlalchemy import select
from src.services.repository import (
    Repository,
    workspace_context_versions,
    workspace_theme_versions,
)

DEFAULT_CONTEXT = {"domain": None, "primary_goal": None, "target_audience": None}
DEFAULT_THEME = {
    "primary_color": "#315EFB",
    "secondary_color": "#0F9D91",
    "tone": "professional",
    "default_language": "vi",
}


class ConfigurationStaleError(ValueError):
    pass


def _id() -> str:
    return uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class WorkspaceConfigurationRepository:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository
        self.engine = repository.engine

    def _active(
        self, conn: Any, table: Any, workspace_id: str
    ) -> dict[str, Any] | None:
        row = (
            conn.execute(
                select(table)
                .where(table.c.workspace_id == workspace_id, table.c.status == "active")
                .order_by(table.c.version.desc())
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    def _create_initial(
        self,
        conn: Any,
        workspace_id: str,
        actor: str,
        context: dict[str, Any] | None,
        theme: dict[str, Any] | None,
    ) -> None:
        if not self._active(conn, workspace_context_versions, workspace_id):
            conn.execute(
                workspace_context_versions.insert().values(
                    id=_id(),
                    workspace_id=workspace_id,
                    version=1,
                    status="active",
                    created_by_user_id=actor,
                    created_at=_now(),
                    **(DEFAULT_CONTEXT | (context or {})),
                )
            )
        if not self._active(conn, workspace_theme_versions, workspace_id):
            conn.execute(
                workspace_theme_versions.insert().values(
                    id=_id(),
                    workspace_id=workspace_id,
                    version=1,
                    status="active",
                    created_by_user_id=actor,
                    created_at=_now(),
                    **(DEFAULT_THEME | (theme or {})),
                )
            )

    def initialize(
        self,
        workspace_id: str,
        actor: str,
        *,
        context: dict[str, Any] | None = None,
        theme: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self.engine.begin() as conn:
            self._create_initial(conn, workspace_id, actor, context, theme)
        return self.get(workspace_id, actor)

    def get(self, workspace_id: str, actor: str) -> dict[str, Any]:
        with self.engine.begin() as conn:
            self._create_initial(conn, workspace_id, actor, None, None)
            context = self._active(conn, workspace_context_versions, workspace_id)
            theme = self._active(conn, workspace_theme_versions, workspace_id)
        return {"context": context, "theme": theme}

    def update(
        self, workspace_id: str, actor: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        next_context = payload.get("context")
        next_theme = payload.get("theme")
        if next_context is None and next_theme is None:
            raise ValueError("Provide context or theme to update configuration.")
        with self.engine.begin() as conn:
            self._create_initial(conn, workspace_id, actor, None, None)
            context = self._active(conn, workspace_context_versions, workspace_id)
            theme = self._active(conn, workspace_theme_versions, workspace_id)
            assert context and theme
            expected_context = payload.get("expected_context_version")
            expected_theme = payload.get("expected_theme_version")
            if next_context is not None and expected_context != context["version"]:
                raise ConfigurationStaleError(
                    "configuration_stale: context version has changed"
                )
            if next_theme is not None and expected_theme != theme["version"]:
                raise ConfigurationStaleError(
                    "configuration_stale: theme version has changed"
                )
            if next_context is not None:
                conn.execute(
                    workspace_context_versions.update()
                    .where(workspace_context_versions.c.id == context["id"])
                    .values(status="superseded")
                )
                conn.execute(
                    workspace_context_versions.insert().values(
                        id=_id(),
                        workspace_id=workspace_id,
                        version=int(context["version"]) + 1,
                        status="active",
                        created_by_user_id=actor,
                        created_at=_now(),
                        **(DEFAULT_CONTEXT | next_context),
                    )
                )
            if next_theme is not None:
                conn.execute(
                    workspace_theme_versions.update()
                    .where(workspace_theme_versions.c.id == theme["id"])
                    .values(status="superseded")
                )
                conn.execute(
                    workspace_theme_versions.insert().values(
                        id=_id(),
                        workspace_id=workspace_id,
                        version=int(theme["version"]) + 1,
                        status="active",
                        created_by_user_id=actor,
                        created_at=_now(),
                        **(DEFAULT_THEME | next_theme),
                    )
                )
        return self.get(workspace_id, actor)


def get_workspace_configuration_repository() -> WorkspaceConfigurationRepository:
    from src.services.repository import get_repository

    return WorkspaceConfigurationRepository(get_repository())
