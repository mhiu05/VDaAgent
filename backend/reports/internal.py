"""`contoso.start_report`, `publish_report`, `fail_report`, `publish_dataset` (docs 11, 15, 19)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from backend.api.internal import Caller, harness_of
from backend.reports import service

router = APIRouter(prefix="/internal/v1")
Short = Annotated[str, StringConstraints(max_length=200)]


class StartReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    type: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    projects: list[Short] = Field(default_factory=list, max_length=50)
    markets: list[Short] = Field(default_factory=list, max_length=50)
    report_id: str | None = None


class PublishReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempt_id: str
    schema_path: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    artifacts: list[str] = Field(default_factory=list)
    evidence: list[Any] = Field(default_factory=list, max_length=500)
    source: Any = None


class FailReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempt_id: str
    reason: Annotated[str, StringConstraints(max_length=1000)] = ""


class DeleteReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    report_id: str


@router.post("/reports/start")
async def start_report(body: StartReport, caller: Caller, request: Request) -> dict:
    h = harness_of(request)
    async with h.db() as conn:
        out = await service.start(
            h,
            conn,
            caller,
            title=body.title,
            type_=body.type,
            projects=body.projects,
            markets=body.markets,
            report_id=body.report_id,
        )
    h.tracer.event(trace_id=caller.trace_id, name="start_report", metadata=out)
    return out


@router.post("/reports/publish")
async def publish_report(body: PublishReport, caller: Caller, request: Request) -> dict:
    h = harness_of(request)
    async with h.db() as conn:
        version = await service.publish(
            h,
            conn,
            caller,
            attempt_id=body.attempt_id,
            schema_path=body.schema_path,
            artifacts=body.artifacts,
            evidence=body.evidence,
            source=body.source,
        )
    h.tracer.event(
        trace_id=caller.trace_id, name="publish_report", metadata={"version_id": version}
    )
    return {"version_id": version}


@router.post("/reports/fail", status_code=204)
async def fail_report(body: FailReport, caller: Caller, request: Request) -> Response:
    h = harness_of(request)
    async with h.db() as conn:
        await service.fail(
            h, conn, caller, attempt_id=body.attempt_id, reason=body.reason or "failed"
        )
    return Response(status_code=204)


@router.post("/reports/delete", status_code=204)
async def delete_report(body: DeleteReport, caller: Caller, request: Request) -> Response:
    h = harness_of(request)
    async with h.db() as conn:
        await service.delete(conn, caller.user_id, report_id=body.report_id)
    return Response(status_code=204)


class PublishDataset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Annotated[str, StringConstraints(max_length=40)]
    path: Annotated[str, StringConstraints(min_length=1, max_length=500)]


@router.post("/datasets/publish")
async def publish_dataset(body: PublishDataset, caller: Caller, request: Request) -> dict:
    from backend.reports import dataset

    h = harness_of(request)
    async with h.db() as conn:
        dataset_id = await dataset.publish(conn, caller, kind=body.kind, path=body.path)
    h.tracer.event(
        trace_id=caller.trace_id,
        name="publish_dataset",
        metadata={"dataset_id": dataset_id, "kind": body.kind},
    )
    return {"dataset_id": dataset_id}
