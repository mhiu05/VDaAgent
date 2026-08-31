"""Application service for profiling submission, execution, and review."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import Any

from langgraph.types import Command
from sqlalchemy.exc import OperationalError
from src.agents.graph import get_profiling_graph
from src.agents.runtime.trace import complete_agent_run, fail_agent_run, start_agent_run
from src.agents.state import initial_profiling_state
from src.config import get_settings
from src.models.schemas import ConfirmRequest, ProfileRequest
from src.services.google_drive import is_google_drive_ref
from src.services.repository import Repository
from src.services.stats_tests import TESTS
from src.services.storage import is_supabase_ref
from src.services.datasource import connection_id_from_ref

logger = logging.getLogger(__name__)


class ProfileError(Exception):
    """Expected workflow error safe to translate at an API/worker boundary."""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        *,
        error_code: str = "profile_error",
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.retryable = retryable


class ProfileService:
    def __init__(self, repo: Repository) -> None:
        self.repo = repo
        self.settings = get_settings()

    @staticmethod
    def _thread_config(run_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": f"profile:{run_id}"}}

    async def submit_profile(
        self,
        request: ProfileRequest,
        workspace_id: str,
        user_id: str,
        idempotency_key: str,
        correlation_id: str | None = None,
        request_hash_override: str | None = None,
    ) -> dict[str, Any]:
        """Validate and transactionally persist a queued profiling run."""
        if request.dataset_id:
            dataset = self.repo.get_dataset(
                request.dataset_id, workspace_id=workspace_id
            )
            if not dataset:
                raise ProfileError("Không tìm thấy dataset trong workspace.", 404)
            dataset_id = str(dataset["id"])
            dataset_ref = str(dataset["source_ref"])
        else:
            dataset_ref = request.dataset_ref or ""
            if not dataset_ref:
                raise ProfileError("Cần dataset_id từ endpoint upload.", 422)
            if self.settings.app_env == "production":
                raise ProfileError(
                    "Production chỉ nhận dataset_id từ endpoint upload.", 422
                )
            source_type = (
                "parquet"
                if dataset_ref.lower().endswith(".parquet")
                else "json"
                if dataset_ref.lower().endswith(".json")
                else "csv"
            )
            dataset_id = self.repo.upsert_dataset(
                name=request.dataset_name or dataset_ref,
                source_type=source_type,
                source_ref=dataset_ref,
                workspace_id=workspace_id,
            )
            dataset = self.repo.get_dataset(dataset_id, workspace_id=workspace_id)
            if not dataset:
                raise ProfileError("Không tìm thấy dataset trong workspace.", 404)

        is_datasource = dataset_ref.lower().startswith("datasource://")
        if is_datasource:
            connection_id_from_ref(dataset_ref)
        if self.settings.app_env == "production" and not (
            is_supabase_ref(dataset_ref) or is_google_drive_ref(dataset_ref) or is_datasource
        ):
            raise ProfileError(
                "Production chỉ nhận dataset_ref từ storage đã cấu hình.", 400
            )

        scan_mode = request.scan_mode or self.settings.profiling_default_scan_mode
        sampling_config = request.sampling.model_dump() if request.sampling else None
        request_hash = request_hash_override or hashlib.sha256(
            json.dumps(
                request.model_dump(mode="json"),
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        created = self.repo.create_profile_job(
            dataset_id=dataset_id,
            scan_mode=scan_mode,
            workspace_id=workspace_id,
            created_by_user_id=user_id,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            correlation_id=correlation_id,
            max_attempts=self.settings.profiling_worker_max_attempts,
            source_content_sha256=dataset.get("content_sha256"),
            source_version=dataset.get("source_version"),
            sampling_strategy=(sampling_config or {}).get("strategy")
            if scan_mode == "sample"
            else None,
            sample_size=(sampling_config or {}).get("sample_size")
            if scan_mode == "sample"
            else None,
            random_seed=(sampling_config or {}).get("random_seed")
            if scan_mode == "sample"
            else None,
            initial_question=request.question,
            run_name=request.run_name,
        )
        if created["conflict"]:
            raise ProfileError(
                "Idempotency-Key was already used for a different profiling request.",
                409,
                error_code="idempotency_conflict",
            )
        run = created["run"]
        return {
            "run_id": str(run["id"]),
            "dataset_id": str(run["dataset_id"]),
            "duplicate": bool(created["duplicate"]),
            "job": run,
        }

    async def execute_profile_job(self, job: dict[str, Any]) -> dict[str, Any]:
        """Execute a claimed job through the unchanged profiling graph."""
        run_id = str(job["id"])
        workspace_id = str(job["workspace_id"])
        user_id = str(job["created_by_user_id"])
        dataset_id = str(job["dataset_id"])
        dataset = self.repo.get_dataset(dataset_id, workspace_id=workspace_id)
        if not dataset:
            raise ProfileError(
                "The profiling dataset is no longer available.",
                404,
                error_code="dataset_not_found",
            )

        if str(job.get("status") or "") in {"pending_review", "completed"}:
            return {"run_id": run_id, "agent_run_id": job.get("agent_run_id")}

        resume_payload = job.get("job_payload")
        if isinstance(resume_payload, dict):
            return await self._execute_profile_resume(
                run_id=run_id,
                workspace_id=workspace_id,
                payload=resume_payload,
                persisted_agent_run_id=job.get("agent_run_id"),
            )

        agent_run_id = job.get("agent_run_id")
        if not agent_run_id:
            agent_run_id = start_agent_run(
                workspace_id=workspace_id,
                actor_user_id=user_id,
                run_type="profile",
                resource_bindings={
                    "profile_run_id": run_id,
                    "dataset_id": dataset_id,
                    "job_id": run_id,
                },
                request_for_hash={"job_request_hash": job.get("job_request_hash")},
                correlation_id=job.get("job_correlation_id"),
            )
            self.repo.update_profile_run(
                run_id,
                workspace_id=workspace_id,
                agent_run_id=agent_run_id,
            )

        sampling_config = (
            {
                "strategy": job.get("sampling_strategy") or "reservoir",
                "sample_size": job.get("sample_size")
                or self.settings.profiling_sample_size,
                "random_seed": job.get("random_seed"),
            }
            if job.get("scan_mode") == "sample"
            else None
        )
        state = initial_profiling_state(
            dataset_ref=str(dataset["source_ref"]),
            dataset_name=str(dataset.get("name") or dataset["source_ref"]),
            scan_mode=job.get("scan_mode") or self.settings.profiling_default_scan_mode,
            sampling_config=sampling_config,
            requested_by=user_id,
            question=job.get("initial_question"),
            dataset_id=dataset_id,
            profile_run_id=run_id,
            workspace_id=workspace_id,
            agent_run_id=agent_run_id,
        )
        graph = get_profiling_graph()
        graph_input: Any = state
        config = self._thread_config(run_id)
        if int(job.get("job_attempt_count") or 0) > 1:
            try:
                checkpoint = await asyncio.to_thread(graph.get_state, config)
                if checkpoint and checkpoint.values and checkpoint.next:
                    graph_input = None
            except OperationalError as exc:
                raise ProfileError(
                    "Profiling temporarily unavailable.",
                    503,
                    error_code="database_unavailable",
                    retryable=True,
                ) from exc

        try:
            result = await asyncio.to_thread(graph.invoke, graph_input, config)
        except OperationalError as exc:
            fail_agent_run(agent_run_id, workspace_id=workspace_id, error=exc)
            raise ProfileError(
                "Profiling temporarily unavailable.",
                503,
                error_code="database_unavailable",
                retryable=True,
            ) from exc
        except Exception as exc:
            logger.exception("Profiling job failed job_id=%s", run_id)
            fail_agent_run(agent_run_id, workspace_id=workspace_id, error=exc)
            raise ProfileError(
                "Profiling failed.", 500, error_code="profiling_failed"
            ) from exc

        if result.get("error"):
            fail_agent_run(
                agent_run_id,
                workspace_id=workspace_id,
                error=str(result["error"]),
                error_code="profile_error",
            )
            raise ProfileError(
                "Profiling could not process this dataset.",
                400,
                error_code="invalid_dataset",
            )
        profile_status = (
            self.repo.get_profile_run(run_id, workspace_id=workspace_id) or {}
        ).get("status")
        complete_agent_run(
            agent_run_id,
            workspace_id=workspace_id,
            status="awaiting_approval"
            if profile_status == "pending_review"
            else "completed",
        )
        return {"run_id": run_id, "agent_run_id": agent_run_id}

    async def _execute_profile_resume(
        self,
        *,
        run_id: str,
        workspace_id: str,
        payload: dict[str, Any],
        persisted_agent_run_id: object,
    ) -> dict[str, Any]:
        """Resume one existing checkpoint from a worker, never an HTTP request."""
        config = self.repo.execution_config(run_id, workspace_id=workspace_id)
        if not config:
            raise ProfileError(
                "Profile run has no safe checkpoint mapping.",
                409,
                error_code="checkpoint_not_found",
            )

        graph = get_profiling_graph()
        agent_run_id = str(persisted_agent_run_id) if persisted_agent_run_id else None
        try:
            checkpoint = await asyncio.to_thread(graph.get_state, config)
            agent_run_id = (checkpoint.values or {}).get("agent_run_id") or agent_run_id
            # A pre-durable-review run can have already passed the HITL
            # interrupt and be checkpointed directly at ``summarize``.  In
            # that case Command(resume=...) is a no-op because there is no
            # pending interrupt to resume; continue the checkpoint normally.
            if payload.get("legacy_resume") and checkpoint.next == ("summarize",):
                result = await asyncio.to_thread(graph.invoke, None, config)
            else:
                result = await asyncio.to_thread(
                    graph.invoke,
                    Command(resume=payload, update={"resume_requested": True}),
                    config,
                )
            agent_run_id = result.get("agent_run_id") or agent_run_id
        except OperationalError as exc:
            raise ProfileError(
                "Profiling temporarily unavailable.",
                503,
                error_code="database_unavailable",
                retryable=True,
            ) from exc
        except Exception as exc:
            logger.exception("Profile resume job failed job_id=%s", run_id)
            fail_agent_run(agent_run_id, workspace_id=workspace_id, error=exc)
            raise ProfileError(
                "Resume workflow failed.",
                500,
                error_code="resume_failed",
            ) from exc

        current = self.repo.get_profile_run(run_id, workspace_id=workspace_id) or {}
        if agent_run_id:
            complete_agent_run(
                agent_run_id,
                workspace_id=workspace_id,
                status="awaiting_approval"
                if current.get("status") == "pending_review"
                else "completed",
            )
        return {"run_id": run_id, "agent_run_id": agent_run_id}

    async def confirm_proposals(
        self,
        run_id: str,
        request: ConfirmRequest,
        workspace_id: str,
        user_id: str,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Apply an atomic review and resume the existing graph checkpoint."""
        run = self.repo.get_profile_run(run_id, workspace_id=workspace_id)
        if not run:
            raise ProfileError(f"Profile run '{run_id}' không tồn tại.", 404)

        action = request.action
        if action is None:
            if any(item.decision == "reject" for item in request.decisions):
                action = "reject"
            elif any(item.decision == "edit" for item in request.decisions):
                action = "edit"
            else:
                action = "confirm"

        test_requests = [dict(item) for item in request.test_requests]
        if action == "request_test":
            if not test_requests:
                raise ProfileError("request_test cần ít nhất một test spec.", 422)
            columns = set(self.repo.get_column_stats(run_id))
            for spec in test_requests:
                if spec.get("test_type") not in TESTS:
                    raise ProfileError(
                        f"Kiểm định không hỗ trợ: {spec.get('test_type')}.",
                        422,
                    )
                if not isinstance(spec.get("columns"), list) or not spec["columns"]:
                    raise ProfileError("Mỗi test spec cần danh sách columns.", 422)
                if any(column not in columns for column in spec["columns"]):
                    raise ProfileError(
                        "Test spec chứa column không thuộc profile run.", 422
                    )
        elif not request.decisions:
            raise ProfileError("Review cần decisions hoặc action=request_test.", 422)

        resume_payload = (
            {"action": action, "test_requests": test_requests}
            if request.resume
            else None
        )
        if resume_payload is not None and not self.repo.execution_config(
            run_id, workspace_id=workspace_id
        ):
            raise ProfileError(
                "Profile run has no safe checkpoint/thread mapping.", 409
            )

        applied_result = self.repo.apply_review_and_start(
            run_id,
            action=action,
            decisions=[item.model_dump() for item in request.decisions],
            confirmed_by=user_id,
            idempotency_key=idempotency_key,
            workspace_id=workspace_id,
            resume_payload=resume_payload,
            max_attempts=self.settings.profiling_worker_max_attempts,
        )
        self._raise_review_error(applied_result)

        current = applied_result.get("run") or run
        agent_run_id = current.get("agent_run_id")
        summary = (
            self.repo.agent_trace_summary(agent_run_id, workspace_id=workspace_id)
            if agent_run_id
            else None
        )
        return {
            "run_id": run_id,
            "agent_run_id": agent_run_id,
            "trace_summary": summary,
            "applied_result": applied_result,
            "action": action,
        }

    @staticmethod
    def _raise_review_error(result: dict[str, Any]) -> None:
        if result.get("ok"):
            return
        code = result.get("code")
        if code == "not_found":
            raise ProfileError("Profile run không tồn tại.", 404)
        if code == "invalid_state":
            raise ProfileError(
                f"Run đang ở trạng thái {result.get('status')}, không thể resume.",
                409,
            )
        if code == "edit_requires_final_type":
            raise ProfileError(
                "Quyết định chỉnh sửa cần giá trị phân loại chính thức.",
                422,
            )
        if code == "edit_requires_note":
            raise ProfileError(
                "Quyết định chỉnh sửa cần lý do review.", 422
            )
        if code == "edit_not_supported":
            raise ProfileError(
                "Candidate key chỉ hỗ trợ xác nhận hoặc từ chối.", 422
            )
        if code == "concurrent_review":
            raise ProfileError("Review khác đang resume run này.", 409)
        raise ProfileError(
            "Proposal không thuộc profile run hoặc đã được xử lý.", 404
        )
