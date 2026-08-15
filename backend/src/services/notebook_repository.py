"""Persistence boundary for workspace-scoped LLM notebooks."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, select
from src.services.repository import (
    Repository,
    notebook_cells,
    notebooks,
    profile_runs,
    get_repository,
)


def _id() -> str:
    return uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class NotebookRepository:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository
        self.engine = repository.engine

    @staticmethod
    def _can_read(item: dict[str, Any], actor_user_id: str, role: str) -> bool:
        return item["created_by_user_id"] == actor_user_id or item["visibility"] == "workspace"

    @staticmethod
    def _can_edit(item: dict[str, Any], actor_user_id: str, role: str) -> bool:
        return item["created_by_user_id"] == actor_user_id or item["visibility"] == "workspace"

    def _with_profile_label(
        self, conn: Any, item: dict[str, Any], *, workspace_id: str
    ) -> dict[str, Any]:
        """Expose a friendly run label while keeping its ID internal to actions."""
        run = conn.execute(
            select(profile_runs.c.run_name, profile_runs.c.version).where(
                profile_runs.c.id == item["profile_run_id"],
                profile_runs.c.workspace_id == workspace_id,
            )
        ).mappings().first()
        item["profile_run_name"] = run.get("run_name") if run else None
        item["profile_run_version"] = run.get("version") if run else None
        return item

    def _row(
        self,
        conn: Any,
        notebook_id: str,
        *,
        workspace_id: str,
        actor_user_id: str | None = None,
        role: str = "analyst",
    ) -> dict[str, Any] | None:
        row = conn.execute(
            select(notebooks).where(
                notebooks.c.id == notebook_id,
                notebooks.c.workspace_id == workspace_id,
                notebooks.c.status == "active",
            )
        ).mappings().first()
        if not row:
            return None
        item = self._with_profile_label(conn, dict(row), workspace_id=workspace_id)
        if actor_user_id is not None and not self._can_read(item, actor_user_id, role):
            return None
        item["cells"] = [
            dict(cell)
            for cell in conn.execute(
                select(notebook_cells)
                .where(notebook_cells.c.notebook_id == notebook_id)
                .order_by(notebook_cells.c.position, notebook_cells.c.created_at)
            ).mappings()
        ]
        return item

    def create(
        self,
        *,
        workspace_id: str,
        actor_user_id: str,
        profile_run_id: str,
        title: str,
        description: str | None,
    ) -> dict[str, Any]:
        run = self.repository.get_profile_run(profile_run_id, workspace_id=workspace_id)
        if not run:
            raise LookupError("Không tìm thấy profile run trong workspace.")
        if run.get("status") != "completed":
            raise ValueError("Chỉ có thể tạo notebook từ profile run đã completed.")

        notebook = {
            "id": _id(),
            "workspace_id": workspace_id,
            "profile_run_id": profile_run_id,
            "title": title.strip(),
            "description": description.strip() if description else None,
            "visibility": "private",
            "status": "active",
            "created_by_user_id": actor_user_id,
            "shared_by_user_id": None,
            "shared_at": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        with self.engine.begin() as conn:
            conn.execute(notebooks.insert().values(**notebook))
            conn.execute(
                notebook_cells.insert().values(
                    id=_id(),
                    notebook_id=notebook["id"],
                    position=0,
                    kind="markdown",
                    title="Mục tiêu phân tích",
                    source=(
                        description.strip()
                        if description and description.strip()
                        else "Ghi lại mục tiêu, giả thuyết và các phát hiện quan trọng của phiên phân tích này."
                    ),
                    result=None,
                    status="draft",
                    created_by_user_id=actor_user_id,
                    created_at=_now(),
                    updated_at=_now(),
                )
            )
            return self._row(
                conn,
                notebook["id"],
                workspace_id=workspace_id,
                actor_user_id=actor_user_id,
                role="analyst",
            ) or notebook

    def list(
        self,
        *,
        workspace_id: str,
        actor_user_id: str,
        role: str,
        status: str = "active",
    ) -> list[dict[str, Any]]:
        if status not in {"active", "archived"}:
            raise ValueError("Trạng thái phiên phân tích không hợp lệ.")
        with self.engine.begin() as conn:
            statement = select(notebooks).where(
                notebooks.c.workspace_id == workspace_id,
                notebooks.c.status == status,
            )
            if status == "archived":
                statement = statement.where(
                    notebooks.c.created_by_user_id == actor_user_id
                )
            else:
                statement = statement.where(
                    (notebooks.c.visibility == "workspace")
                    | (notebooks.c.created_by_user_id == actor_user_id)
                )
            return [
                self._with_profile_label(conn, dict(row), workspace_id=workspace_id)
                for row in conn.execute(
                    statement.order_by(notebooks.c.updated_at.desc())
                ).mappings()
            ]

    def get(
        self, notebook_id: str, *, workspace_id: str, actor_user_id: str, role: str
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            return self._row(
                conn,
                notebook_id,
                workspace_id=workspace_id,
                actor_user_id=actor_user_id,
                role=role,
            )

    def update(
        self,
        notebook_id: str,
        *,
        workspace_id: str,
        actor_user_id: str,
        role: str,
        title: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            item = self._row(conn, notebook_id, workspace_id=workspace_id, actor_user_id=actor_user_id, role=role)
            if not item:
                return None
            if not self._can_edit(item, actor_user_id, role):
                raise PermissionError("Bạn không có quyền chỉnh sửa notebook này.")
            values: dict[str, Any] = {"updated_at": _now()}
            if title is not None:
                values["title"] = title.strip()
            if description is not None:
                values["description"] = description.strip() or None
            conn.execute(notebooks.update().where(notebooks.c.id == notebook_id).values(**values))
            return self._row(conn, notebook_id, workspace_id=workspace_id, actor_user_id=actor_user_id, role=role)

    def set_visibility(
        self,
        notebook_id: str,
        *,
        workspace_id: str,
        actor_user_id: str,
        role: str,
        visibility: str,
    ) -> dict[str, Any] | None:
        if visibility not in {"private", "workspace"}:
            raise ValueError("visibility chỉ nhận private hoặc workspace.")
        with self.engine.begin() as conn:
            item = self._row(conn, notebook_id, workspace_id=workspace_id, actor_user_id=actor_user_id, role=role)
            if not item:
                return None
            if not self._can_edit(item, actor_user_id, role):
                raise PermissionError("Chỉ người tạo notebook mới có thể chia sẻ notebook.")
            conn.execute(
                notebooks.update()
                .where(notebooks.c.id == notebook_id)
                .values(
                    visibility=visibility,
                    shared_by_user_id=actor_user_id if visibility == "workspace" else None,
                    shared_at=_now() if visibility == "workspace" else None,
                    updated_at=_now(),
                )
            )
            return self._row(conn, notebook_id, workspace_id=workspace_id, actor_user_id=actor_user_id, role=role)

    def archive(
        self, notebook_id: str, *, workspace_id: str, actor_user_id: str, role: str
    ) -> bool:
        with self.engine.begin() as conn:
            item = self._row(conn, notebook_id, workspace_id=workspace_id, actor_user_id=actor_user_id, role=role)
            if not item:
                return False
            if not self._can_edit(item, actor_user_id, role):
                raise PermissionError("Bạn không có quyền xóa notebook này.")
            result = conn.execute(
                notebooks.update()
                .where(notebooks.c.id == notebook_id)
                .values(status="archived", updated_at=_now())
            )
            return bool(result.rowcount)

    def restore(
        self, notebook_id: str, *, workspace_id: str, actor_user_id: str, role: str
    ) -> bool:
        with self.engine.begin() as conn:
            row = conn.execute(
                select(notebooks).where(
                    notebooks.c.id == notebook_id,
                    notebooks.c.workspace_id == workspace_id,
                    notebooks.c.status == "archived",
                )
            ).mappings().first()
            if not row:
                return False
            if not self._can_edit(dict(row), actor_user_id, role):
                raise PermissionError("Bạn không có quyền khôi phục phiên phân tích này.")
            result = conn.execute(
                notebooks.update()
                .where(notebooks.c.id == notebook_id)
                .where(notebooks.c.workspace_id == workspace_id)
                .where(notebooks.c.status == "archived")
                .values(status="active", updated_at=_now())
            )
            return bool(result.rowcount)

    def add_cell(
        self,
        notebook_id: str,
        *,
        workspace_id: str,
        actor_user_id: str,
        role: str,
        kind: str,
        source: str,
        title: str | None,
    ) -> dict[str, Any] | None:
        if kind not in {"markdown", "prompt"}:
            raise ValueError("Cell chỉ nhận loại markdown hoặc prompt.")
        with self.engine.begin() as conn:
            item = self._row(conn, notebook_id, workspace_id=workspace_id, actor_user_id=actor_user_id, role=role)
            if not item:
                return None
            if not self._can_edit(item, actor_user_id, role):
                raise PermissionError("Bạn không có quyền thêm cell vào notebook này.")
            position = len(item["cells"])
            cell = {
                "id": _id(),
                "notebook_id": notebook_id,
                "position": position,
                "kind": kind,
                "title": title.strip() if title else None,
                "source": source.strip(),
                "result": None,
                "status": "draft",
                "created_by_user_id": actor_user_id,
                "created_at": _now(),
                "updated_at": _now(),
            }
            conn.execute(notebook_cells.insert().values(**cell))
            conn.execute(notebooks.update().where(notebooks.c.id == notebook_id).values(updated_at=_now()))
            return cell

    def update_cell(
        self,
        notebook_id: str,
        cell_id: str,
        *,
        workspace_id: str,
        actor_user_id: str,
        role: str,
        source: str | None = None,
        title: str | None = None,
        result: dict[str, Any] | None = None,
        cell_status: str | None = None,
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            item = self._row(conn, notebook_id, workspace_id=workspace_id, actor_user_id=actor_user_id, role=role)
            if not item:
                return None
            if not self._can_edit(item, actor_user_id, role):
                raise PermissionError("Bạn không có quyền chỉnh sửa cell này.")
            cell = conn.execute(
                select(notebook_cells).where(
                    notebook_cells.c.id == cell_id,
                    notebook_cells.c.notebook_id == notebook_id,
                )
            ).mappings().first()
            if not cell:
                return None
            values: dict[str, Any] = {"updated_at": _now()}
            if source is not None:
                values["source"] = source.strip()
            if title is not None:
                values["title"] = title.strip() or None
            if result is not None:
                values["result"] = result
            if cell_status is not None:
                values["status"] = cell_status
            conn.execute(notebook_cells.update().where(notebook_cells.c.id == cell_id).values(**values))
            conn.execute(notebooks.update().where(notebooks.c.id == notebook_id).values(updated_at=_now()))
            updated = conn.execute(select(notebook_cells).where(notebook_cells.c.id == cell_id)).mappings().first()
            return dict(updated) if updated else None

    def delete_cell(
        self, notebook_id: str, cell_id: str, *, workspace_id: str, actor_user_id: str, role: str
    ) -> bool:
        with self.engine.begin() as conn:
            item = self._row(conn, notebook_id, workspace_id=workspace_id, actor_user_id=actor_user_id, role=role)
            if not item:
                return False
            if not self._can_edit(item, actor_user_id, role):
                raise PermissionError("Bạn không có quyền xóa cell này.")
            deleted = conn.execute(
                delete(notebook_cells).where(
                    notebook_cells.c.id == cell_id,
                    notebook_cells.c.notebook_id == notebook_id,
                )
            )
            if not deleted.rowcount:
                return False
            remaining = list(
                conn.execute(
                    select(notebook_cells.c.id)
                    .where(notebook_cells.c.notebook_id == notebook_id)
                    .order_by(notebook_cells.c.position, notebook_cells.c.created_at)
                ).scalars()
            )
            for position, current_id in enumerate(remaining):
                conn.execute(notebook_cells.update().where(notebook_cells.c.id == current_id).values(position=position))
            conn.execute(notebooks.update().where(notebooks.c.id == notebook_id).values(updated_at=_now()))
            return True


def get_notebook_repository() -> NotebookRepository:
    return NotebookRepository(get_repository())


__all__ = ["NotebookRepository", "get_notebook_repository"]
