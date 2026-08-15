"""Điểm vào FastAPI của agent profiling dữ liệu.

Chạy dev:
    uvicorn src.main:app --reload

Lần khởi động đầu tiên, log sẽ liệt kê các biến môi trường còn thiếu để bạn
biết cần điền gì vào `.env`. Agent vẫn khởi động được khi chưa có LLM key —
phần tính toán thống kê chạy hoàn toàn offline, chỉ mất phần diễn giải bằng
ngôn ngữ tự nhiên.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from src.api.agent_routes import router as agent_router
from src.api.analysis_routes import router as analysis_router
from src.api.authz_routes import router as authz_router
from src.api.google_drive_routes import router as google_drive_router
from src.api.notebook_routes import router as notebook_router
from src.api.routes import router
from src.config import get_settings
from src.models.schemas import HealthResponse

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.app_log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("p170")


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
            "AUTH_MODE=supabase",
        }
        if settings.storage_provider == "supabase":
            critical.add("SUPABASE_SECRET_KEY")
        elif settings.storage_provider == "google_drive":
            critical.add("GOOGLE_DRIVE_* (storage provider google_drive)")
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
                from src.services.auth import get_jwt_verifier

                keys = get_jwt_verifier(settings)._jwks_client().get_signing_keys()
                if not keys:
                    raise RuntimeError("JWKS không có signing key.")
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")
app.include_router(agent_router, prefix="/api/v1")
app.include_router(analysis_router, prefix="/api/v1")
app.include_router(authz_router, prefix="/api/v1")
app.include_router(google_drive_router, prefix="/api/v1")
app.include_router(notebook_router, prefix="/api/v1")


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
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_env == "development",
    )
