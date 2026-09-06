"""Điểm vào FastAPI của agent profiling dữ liệu.

Chạy dev:
    .\\.venv\\Scripts\\python.exe -m uvicorn src.main:app --app-dir backend --reload --port 8000

Lần khởi động đầu tiên, log sẽ liệt kê các biến môi trường còn thiếu để bạn
biết cần điền gì vào `.env`. Agent vẫn khởi động được khi chưa có LLM key —
phần tính toán thống kê chạy hoàn toàn offline, chỉ mất phần diễn giải bằng
ngôn ngữ tự nhiên.
"""

from __future__ import annotations

from src.api.connector_routes import router as connector_router
import logging
import re
import time
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Request

# pyrefly: ignore [missing-import]
from fastapi.exceptions import RequestValidationError

# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware

# pyrefly: ignore [missing-import]
from fastapi.responses import JSONResponse
# pyrefly: ignore [missing-import]
from sqlalchemy.exc import OperationalError
from src.api.agent_routes import router as agent_router
from src.api.analysis_routes import (
    router as analysis_router,
    profile_router as command_center_router,
)
from src.api.admin_routes import router as admin_router
from src.api.authz_routes import router as authz_router
from src.api.google_drive_routes import router as google_drive_router
from src.api.routes import router
from src.api.skill_routes import router as skill_router
from src.config import get_settings
from src.models.schemas import HealthResponse

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.app_log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("p170")

_CORRELATION_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")

# PERF-001: concrete IDs are collapsed to a stable route template so telemetry
# cardinality stays bounded and no workspace/resource identifier is ever logged.
# Ordered longest-prefix first; the first match wins.
_ROUTE_TEMPLATE_RULES: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern), template)
    for pattern, template in (
        (r"^/api/v1/workspace-bootstrap$", "/workspace-bootstrap"),
        (r"^/api/v1/session$", "/session"),
        (r"^/api/v1/dashboard$", "/dashboard"),
        (r"^/api/v1/workspaces(/.*)?$", "/workspaces"),
        (r"^/api/v1/datasets/[^/]+/runs$", "/datasets/{id}/runs"),
        (r"^/api/v1/datasets(/[^/]+)?$", "/datasets"),
        (r"^/api/v1/profiling-jobs/[^/]+$", "/profiling-jobs/{id}"),
        (r"^/api/v1/profile/[^/]+/explorer/.*$", "/profile/{id}/explorer"),
        (r"^/api/v1/profile/[^/]+/charts/.*$", "/profile/{id}/charts"),
        (r"^/api/v1/profile/[^/]+/report-draft$", "/profile/{id}/report-draft"),
        (r"^/api/v1/profile/[^/]+/report$", "/profile/{id}/report"),
        (r"^/api/v1/profile/[^/]+/drift$", "/profile/{id}/drift"),
        (r"^/api/v1/profile/[^/]+/.*$", "/profile/{id}/*"),
        (r"^/api/v1/profile/[^/]+$", "/profile/{id}"),
        (r"^/api/v1/profile$", "/profile"),
        (r"^/api/v1/activity$", "/activity"),
        (r"^/api/v1/compare(/.*)?$", "/compare"),
        (r"^/api/v1/qa/stream$", "/qa/stream"),
        (r"^/api/v1/qa$", "/qa"),
        (r"^/api/v1/connectors/[^/]+/test$", "/connectors/{id}/test"),
        (r"^/api/v1/connectors/[^/]+$", "/connectors/{id}"),
        (r"^/api/v1/connectors(/.*)?$", "/connectors"),
    )
)


def _route_template(path: str) -> str | None:
    """Map a concrete request path to a low-cardinality, PII-safe template."""
    for pattern, template in _ROUTE_TEMPLATE_RULES:
        if pattern.match(path):
            return template
    return None


def _request_correlation_id(request: Request) -> str:
    supplied = request.headers.get("x-correlation-id", "").strip()
    return supplied if _CORRELATION_ID.fullmatch(supplied) else uuid4().hex


def _preflight_supabase_jwks(current_settings: Any) -> bool:
    """Warm the JWKS cache without making transient network outages fatal.

    Authentication remains fail-closed at request time: if the keys cannot be
    fetched then, bearer verification is denied. Startup only needs to avoid
    coupling application availability to a single remote warm-up request.
    """

    from jwt.exceptions import PyJWKClientConnectionError
    from src.services.auth import get_jwt_verifier

    try:
        keys = get_jwt_verifier(current_settings)._jwks_client().get_signing_keys()
    except (PyJWKClientConnectionError, TimeoutError, OSError):
        logger.warning(
            "Supabase JWKS chưa truy cập được lúc khởi động; tiếp tục ở chế độ "
            "degraded và sẽ thử lại khi xác thực request."
        )
        return False
    if not keys:
        raise RuntimeError("JWKS không có signing key.")
    return True


@asynccontextmanager
async def lifespan(app: FastAPI) -> Any:
    """Khởi tạo DB và báo phần cấu hình còn thiếu.

    Production intentionally has no local persistence bootstrap: datasets,
    audit events and retrieval documents live in Supabase, while compute uses
    only ephemeral files downloaded for the current operation.
    """

    logger.info(
        "Khởi động %s (env=%s, provider=%s, model=%s)",
        settings.app_name,
        settings.app_env,
        settings.llm_provider,
        settings.llm_model,
    )

    # Tạo bảng ngay lúc start để request đầu tiên không phải chờ migrate.
    try:
        from src.services.repository import get_repository

        get_repository()
        logger.info("Metadata DB: %s", settings.database_url.split("://")[0])
    except Exception as exc:
        logger.error("Không kết nối được metadata DB: %s", exc)
        if settings.app_env == "production":
            raise RuntimeError(
                "Production yêu cầu kết nối được Supabase PostgreSQL."
            ) from exc

    missing = settings.missing_required()
    if missing:
        logger.warning(
            "Còn %d biến môi trường chưa điền trong .env: %s",
            len(missing),
            ", ".join(missing),
        )
        logger.warning("Xem hướng dẫn từng biến trong .env.example và README.md.")
    if settings.app_env == "production":
        critical = {
            "DATABASE_URL",
            "SUPABASE_URL",
            "SUPABASE_PUBLISHABLE_KEY",
            "DATASOURCE_ENCRYPTION_KEY",
            "AUTH_MODE=supabase",
        }
        if settings.canonical_storage_provider == "supabase":
            critical.add("SUPABASE_SECRET_KEY")
        if settings.auth_allow_guest and settings.guest_storage_provider == "supabase":
            critical.add("SUPABASE_SECRET_KEY (guest trial storage)")
        if settings.auth_allow_guest and settings.guest_storage_provider == "local":
            critical.add("GUEST_STORAGE_PROVIDER=supabase")
        missing_critical = sorted(critical.intersection(missing))
        if missing_critical:
            raise RuntimeError(
                "Thiếu cấu hình production: " + ", ".join(missing_critical)
            )
        if settings.auth_mode == "supabase":
            try:
                _preflight_supabase_jwks(settings)
            except Exception as exc:
                raise RuntimeError(
                    "Không kiểm tra được Supabase JWKS khi khởi động production."
                ) from exc
    if not settings.llm_configured:
        logger.warning(
            "Chưa có API key cho LLM — profiling và kiểm định vẫn chạy, nhưng báo cáo sẽ ở "
            "dạng bảng thay vì văn bản diễn giải."
        )
    if settings.security_require_api_token and not settings.api_token:
        logger.error(
            "require_api_token=true nhưng API_TOKEN đang trống — mọi request sẽ bị từ chối "
            "(503). Điền API_TOKEN trong .env."
        )

    yield
    logger.info("Đã dừng %s", settings.app_name)


app = FastAPI(
    title="VDaAgent — AI Data Profiling Agent",
    description=(
        "Agent tự động lập hồ sơ dữ liệu: tính thống kê, phát hiện PII, đề xuất "
        "candidate key và semantic type, chạy kiểm định thống kê, so sánh drift, "
        "và trả lời câu hỏi về dataset.\n\n"
        "Mọi con số đều do engine tính toán (DuckDB/pandas/scipy) — LLM chỉ diễn "
        "đạt lại, không tự tính. Đề xuất metadata cần Analyst xác nhận trước khi "
        "áp dụng."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if settings.app_env == "production" else "/docs",
    redoc_url=None if settings.app_env == "production" else "/redoc",
)


def _measure_payload(response: Any, perf_ctx: Any) -> None:
    """Record response size without buffering a streaming body (PERF-001)."""
    from starlette.responses import StreamingResponse
    from src.services import perf_telemetry

    content_length = response.headers.get("content-length")
    if content_length is not None:
        try:
            perf_telemetry.record_serialization(0.0, int(content_length))
        except ValueError:
            pass
        return
    if isinstance(response, StreamingResponse):
        perf_ctx.payload_streaming = True
        original_iterator = response.body_iterator

        async def _counting_iterator() -> Any:
            total = 0
            async for chunk in original_iterator:
                total += len(chunk) if isinstance(chunk, (bytes, bytearray)) else len(
                    str(chunk).encode("utf-8")
                )
                yield chunk
            perf_ctx.payload_bytes += total

        response.body_iterator = _counting_iterator()
        return
    body = getattr(response, "body", None)
    if isinstance(body, (bytes, bytearray)):
        perf_telemetry.record_serialization(0.0, len(body))


@app.middleware("http")
async def workspace_request_timing(request: Request, call_next: Any) -> Any:
    """Decompose each workspace request into PII-safe latency/query phases.

    PERF-001: for every workspace route this records total/auth/workspace/db/
    query_count/serialization/payload in a request-local contextvar, emits one
    structured log line, and (when guarded on) exposes a Server-Timing header.
    Non-workspace routes keep only the correlation id, exactly as before.
    """
    from src.services import perf_telemetry

    path = request.url.path
    correlation_id = _request_correlation_id(request)
    request.state.correlation_id = correlation_id
    template = _route_template(path)

    if template is None or not settings.perf_telemetry_enabled:
        response = await call_next(request)
        response.headers["X-Correlation-Id"] = correlation_id
        return response

    token = perf_telemetry.begin(template, correlation_id, request.method)
    perf_ctx = perf_telemetry.current()
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        total_ms = (time.perf_counter() - started) * 1000
        if perf_ctx is not None:
            perf_telemetry.emit_log(perf_ctx, 500, total_ms)
        # Preserve the legacy timing line so existing dashboards keep matching.
        logger.info(
            "workspace_request_timing route=%s status=500 "
            "duration_ms=%d correlation_id=%s",
            template,
            round(total_ms),
            correlation_id,
        )
        perf_telemetry.reset(token)
        raise

    if perf_ctx is not None:
        _measure_payload(response, perf_ctx)
    total_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Correlation-Id"] = correlation_id

    if perf_ctx is not None:
        if settings.perf_server_timing_enabled:
            response.headers["Server-Timing"] = (
                f"auth;dur={perf_ctx.auth_local_ms + perf_ctx.auth_remote_ms:.1f}, "
                f"ws;dur={perf_ctx.workspace_ms:.1f}, "
                f"db;dur={perf_ctx.db_ms:.1f};desc=\"q={perf_ctx.query_count}\", "
                f"total;dur={total_ms:.1f}"
            )
        perf_telemetry.emit_log(perf_ctx, response.status_code, total_ms)
        perf_telemetry.maybe_log_slow_query(
            settings.perf_slow_query_ms, settings.perf_slow_query_sample_rate
        )
        # Preserve the legacy timing contract that existing log consumers rely on.
        logger.info(
            "workspace_request_timing route=%s status=%d duration_ms=%d correlation_id=%s",
            template,
            response.status_code,
            round(total_ms),
            correlation_id,
        )
    perf_telemetry.reset(token)
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = [
        {key: value for key, value in error.items() if key not in {"input", "ctx"}}
        for error in exc.errors()
    ]
    logger.warning(
        "Request validation failed path=%s error_count=%d",
        request.url.path,
        len(errors),
    )
    return JSONResponse(
        status_code=422,
        content={"detail": errors},
    )


@app.exception_handler(OperationalError)
async def database_exception_handler(
    request: Request, exc: OperationalError
) -> JSONResponse:
    """Return a retryable response when PostgreSQL is temporarily unavailable."""
    correlation_id = _request_correlation_id(request)
    logger.warning(
        "Database unavailable path=%s correlation_id=%s error_type=%s",
        request.url.path,
        correlation_id,
        type(exc).__name__,
    )
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database đang tạm thời hết kết nối. Hãy thử lại sau ít giây.",
            "request_id": correlation_id,
        },
        headers={"X-Correlation-Id": correlation_id, "Retry-After": "3"},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    correlation_id = _request_correlation_id(request)
    logger.error(
        "Unhandled error path=%s correlation_id=%s error_type=%s",
        request.url.path,
        correlation_id,
        type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error.",
            "request_id": correlation_id,
        },
        headers={"X-Correlation-Id": correlation_id},
    )


app.include_router(router, prefix="/api/v1")
app.include_router(agent_router, prefix="/api/v1")
app.include_router(skill_router, prefix="/api/v1")
app.include_router(analysis_router, prefix="/api/v1")
app.include_router(command_center_router, prefix="/api/v1")
app.include_router(authz_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(google_drive_router, prefix="/api/v1")
app.include_router(connector_router, prefix="/api/v1")


@app.get("/")
async def root() -> dict[str, str]:
    """Điểm vào API.

    Frontend được triển khai độc lập trong ``frontend/`` (Next.js), vì vậy
    FastAPI không còn phục vụ file UI hay giữ asset frontend trong process API.
    """
    return {"service": settings.app_name, "docs": "/docs", "health": "/health"}


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    """ValueError từ compute/stats là lỗi input, không phải bug — trả 400."""
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Health check cho load balancer / Docker."""
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        env=settings.app_env,
        llm_configured=settings.llm_configured,
        command_center_enabled=settings.ux_command_center_enabled,
    )


# Keep CORS as the outermost ASGI layer.  FastAPI's regular middleware stack
# can bypass an inner CORSMiddleware when an unhandled exception escapes; the
# browser would then report a misleading CORS error instead of the real API
# response.  Wrapping after all routes/handlers are registered also covers
# errors raised by authentication and external service integrations.
app = CORSMiddleware(
    app,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


if __name__ == "__main__":
    # pyrefly: ignore [missing-import]
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_env == "development",
    )
