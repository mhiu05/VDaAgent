"""`GET /api/dashboard/dataset` (doc 15 "Business dashboard"; doc 19)."""

from __future__ import annotations

from fastapi import APIRouter

from backend.api.deps import Conn, UserRole
from backend.reports.dataset import dashboard_view

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/dataset")
async def dataset(conn: Conn, user: UserRole) -> dict:
    return await dashboard_view(conn, user.id)
