"""Điểm vào FastAPI của agent profiling dữ liệu (P-170).

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
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

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
    """Tạo thư mục dữ liệu, khởi tạo DB, và báo phần cấu hình còn thiếu."""
    settings.data_path.mkdir(parents=True, exist_ok=True)
    settings.index_path.mkdir(parents=True, exist_ok=True)

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
    except Exception as exc:  # noqa: BLE001 - báo lỗi rõ ràng hơn là crash im lặng
        logger.error("Không kết nối được metadata DB: %s", exc)

    missing = settings.missing_required()
    if missing:
        logger.warning(
            "Còn %d biến môi trường chưa điền trong .env: %s", len(missing), ", ".join(missing)
        )
        logger.warning("Xem hướng dẫn từng biến trong .env.example và README.md.")
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
    title="P-170 — AI Data Profiling Agent",
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
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")

app.mount("/ui", StaticFiles(directory=Path(__file__).parent / "webui", html=True), name="ui")

@app.get("/")
async def root():
    return RedirectResponse(url="/ui/")


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
