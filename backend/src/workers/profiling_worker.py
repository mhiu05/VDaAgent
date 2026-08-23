"""Bounded PostgreSQL-backed worker for durable profiling jobs."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import os
import signal
import socket
import time
from datetime import datetime
from uuid import uuid4

from src.config import Settings, get_settings
from src.services.profile_service import ProfileError, ProfileService
from src.services.repository import Repository, get_repository
from src.services.security import get_audit

logger = logging.getLogger(__name__)


class ProfilingWorker:
    """Claim and execute jobs with process-local bounded concurrency."""

    def __init__(
        self,
        repo: Repository | None = None,
        settings: Settings | None = None,
        *,
        worker_id: str | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.repo = repo or get_repository()
        self.service = ProfileService(self.repo)
        self.worker_id = worker_id or (
            f"{socket.gethostname()}:{os.getpid()}:{uuid4().hex[:8]}"
        )
        self._stop = asyncio.Event()
        self._tasks: set[asyncio.Task[None]] = set()

    def request_stop(self) -> None:
        """Stop claiming; current jobs retain leases until finished or process exit."""
        self._stop.set()

    async def recover_stale_jobs(self) -> int:
        recovered = await asyncio.to_thread(self.repo.recover_stale_profile_jobs)
        for item in recovered:
            get_audit().log(
                "profile_job_recovered",
                workspace_id=item["workspace_id"],
                profile_run_id=item["job_id"],
                job_id=item["job_id"],
                recovered_status=item["status"],
            )
        if recovered:
            logger.warning("profile_jobs_recovered count=%d", len(recovered))
        return len(recovered)

    async def run_once(self) -> bool:
        """Claim and fully process at most one job; useful for tests and tooling."""
        await self.recover_stale_jobs()
        job = await asyncio.to_thread(
            self.repo.claim_profile_job,
            worker_id=self.worker_id,
            lease_seconds=self.settings.profiling_worker_lease_seconds,
        )
        if not job:
            return False
        await self._execute_claimed(job)
        return True

    async def run_forever(self) -> None:
        logger.info(
            "profiling_worker_started worker_id=%s concurrency=%d",
            self.worker_id,
            self.settings.profiling_worker_concurrency,
        )
        last_recovery = 0.0
        while not self._stop.is_set():
            now = time.monotonic()
            if now - last_recovery >= max(
                10.0, self.settings.profiling_worker_lease_seconds / 2
            ):
                await self.recover_stale_jobs()
                last_recovery = now

            while (
                not self._stop.is_set()
                and len(self._tasks) < self.settings.profiling_worker_concurrency
            ):
                job = await asyncio.to_thread(
                    self.repo.claim_profile_job,
                    worker_id=self.worker_id,
                    lease_seconds=self.settings.profiling_worker_lease_seconds,
                )
                if not job:
                    break
                task = asyncio.create_task(self._execute_claimed(job))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)

            if self._tasks:
                await asyncio.wait(
                    self._tasks,
                    timeout=self.settings.profiling_worker_poll_seconds,
                    return_when=asyncio.FIRST_COMPLETED,
                )
            else:
                try:
                    await asyncio.wait_for(
                        self._stop.wait(),
                        timeout=self.settings.profiling_worker_poll_seconds,
                    )
                except TimeoutError:
                    pass

        if self._tasks:
            _, pending = await asyncio.wait(
                self._tasks,
                timeout=self.settings.profiling_worker_shutdown_grace_seconds,
            )
            if pending:
                logger.warning(
                    "profiling_worker_shutdown_grace_expired running=%d; "
                    "leases will be recovered after expiry",
                    len(pending),
                )
        logger.info("profiling_worker_stopped worker_id=%s", self.worker_id)

    async def _heartbeat(self, job_id: str, claim_token: str) -> None:
        interval = max(10.0, self.settings.profiling_worker_lease_seconds / 3)
        while True:
            await asyncio.sleep(interval)
            renewed = await asyncio.to_thread(
                self.repo.heartbeat_profile_job,
                job_id,
                claim_token=claim_token,
                lease_seconds=self.settings.profiling_worker_lease_seconds,
            )
            if not renewed:
                logger.error("profile_job_lease_lost job_id=%s", job_id)
                return

    async def _execute_claimed(self, job: dict[str, object]) -> None:
        job_id = str(job["id"])
        workspace_id = str(job["workspace_id"])
        claim_token = str(job["job_claim_token"])
        actor_user_id = str(job["created_by_user_id"])
        started = time.perf_counter()
        queue_wait_ms = _elapsed_ms(
            job.get("job_available_at") or job.get("created_at"),
            job.get("job_started_at"),
        )
        get_audit().log(
            "profile_job_started",
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            profile_run_id=job_id,
            job_id=job_id,
            worker_id=self.worker_id,
            attempt=int(job.get("job_attempt_count") or 0),
            queue_wait_ms=queue_wait_ms,
        )
        heartbeat = asyncio.create_task(self._heartbeat(job_id, claim_token))
        try:
            await self.service.execute_profile_job(job)
        except ProfileError as exc:
            result_status = await asyncio.to_thread(
                self.repo.fail_profile_job,
                job_id,
                claim_token=claim_token,
                error_code=exc.error_code,
                safe_message=exc.message,
                retryable=exc.retryable,
            )
            event = (
                "profile_job_retried"
                if result_status == "queued"
                else "profile_job_failed"
            )
            get_audit().log(
                event,
                workspace_id=workspace_id,
                actor_user_id=actor_user_id,
                profile_run_id=job_id,
                job_id=job_id,
                error_code=exc.error_code,
                attempt=int(job.get("job_attempt_count") or 0),
                execution_ms=round((time.perf_counter() - started) * 1000),
            )
            logger.warning(
                "profile_job_finished job_id=%s status=%s code=%s",
                job_id,
                result_status,
                exc.error_code,
            )
        except Exception:
            logger.exception("profile_job_unhandled_failure job_id=%s", job_id)
            result_status = await asyncio.to_thread(
                self.repo.fail_profile_job,
                job_id,
                claim_token=claim_token,
                error_code="worker_error",
                safe_message="Profiling failed.",
                retryable=False,
            )
            get_audit().log(
                "profile_job_failed",
                workspace_id=workspace_id,
                actor_user_id=actor_user_id,
                profile_run_id=job_id,
                job_id=job_id,
                error_code="worker_error",
                persisted_status=result_status,
                attempt=int(job.get("job_attempt_count") or 0),
                execution_ms=round((time.perf_counter() - started) * 1000),
            )
        else:
            completed = await asyncio.to_thread(
                self.repo.complete_profile_job,
                job_id,
                claim_token=claim_token,
            )
            if completed:
                execution_ms = round((time.perf_counter() - started) * 1000)
                get_audit().log(
                    "profile_job_succeeded",
                    workspace_id=workspace_id,
                    actor_user_id=actor_user_id,
                    profile_run_id=job_id,
                    job_id=job_id,
                    attempt=int(job.get("job_attempt_count") or 0),
                    queue_wait_ms=queue_wait_ms,
                    execution_ms=execution_ms,
                )
                logger.info(
                    "profile_job_succeeded job_id=%s queue_wait_ms=%s "
                    "execution_ms=%d",
                    job_id,
                    queue_wait_ms,
                    execution_ms,
                )
            else:
                logger.error("profile_job_completion_lease_lost job_id=%s", job_id)
        finally:
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat


def _elapsed_ms(start: object, end: object) -> int | None:
    if isinstance(start, datetime) and isinstance(end, datetime):
        return max(0, round((end - start).total_seconds() * 1000))
    return None


async def _serve_health(port: int, worker: ProfilingWorker) -> asyncio.Server:
    async def handle(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(reader.read(4096), timeout=2)
        status = "stopping" if worker._stop.is_set() else "ok"
        body = f'{{"status":"{status}","role":"profiling-worker"}}'.encode()
        response_status = (
            b"503 Service Unavailable" if worker._stop.is_set() else b"200 OK"
        )
        writer.write(
            b"HTTP/1.1 "
            + response_status
            + b"\r\nContent-Type: application/json\r\n"
            + f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
            + body
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    return await asyncio.start_server(handle, "0.0.0.0", port)


async def _main(args: argparse.Namespace) -> None:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.app_log_level),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    worker = ProfilingWorker(settings=settings)
    loop = asyncio.get_running_loop()
    for name in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, name, None)
        if sig is not None:
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(sig, worker.request_stop)

    if args.once:
        await worker.run_once()
        return
    server = await _serve_health(args.health_port, worker) if args.health_port else None
    try:
        await worker.run_forever()
    finally:
        if server:
            server.close()
            await server.wait_closed()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the durable profiling worker")
    parser.add_argument("--once", action="store_true", help="Process at most one job")
    parser.add_argument("--health-port", type=int, default=0)
    asyncio.run(_main(parser.parse_args()))


if __name__ == "__main__":
    main()
