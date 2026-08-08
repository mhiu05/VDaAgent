"""Audit log + rate limiting + kiểm tra API token + làm sạch tên file upload.

Bốn lớp bảo vệ tối thiểu cho một agent chạm vào dữ liệu thật:
    - `Audit`       — ghi lại mọi hành động quan trọng (JSON-lines, append-only).
    - `RateLimiter` — chặn một user gọi quá nhiều trong 60 giây.
    - `require_token` — FastAPI dependency kiểm tra Bearer token.
    - `safe_filename` — chặn path traversal từ tên file người dùng gửi lên.
"""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime
from pathlib import Path, PurePath
from typing import Any

from fastapi import Header, HTTPException, status

from src.config import Settings, get_settings

# Chỉ nhận định dạng bảng mà DuckDB đọc trực tiếp được.
ALLOWED_UPLOAD_SUFFIXES = frozenset({".csv", ".tsv", ".parquet", ".json"})

_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(raw: str) -> str:
    """Biến tên file người dùng gửi lên thành tên an toàn để ghi xuống đĩa.

    Chặn `../`, đường dẫn tuyệt đối, dấu phân cách của cả POSIX và Windows, và
    mọi ký tự ngoài `[A-Za-z0-9._-]`. Raise `ValueError` nếu phần đuôi không
    nằm trong `ALLOWED_UPLOAD_SUFFIXES` — fail-closed, không tự đổi đuôi.
    """
    # PurePath xử lý cả 'a/b' lẫn 'a\\b'; lấy .name để bỏ hết thành phần thư mục.
    name = PurePath(raw.replace("\\", "/")).name.strip()
    if not name or name in {".", ".."}:
        raise ValueError("Tên file không hợp lệ.")

    suffix = PurePath(name).suffix.lower()
    if suffix not in ALLOWED_UPLOAD_SUFFIXES:
        allowed = ", ".join(sorted(ALLOWED_UPLOAD_SUFFIXES))
        raise ValueError(f"Chỉ nhận file {allowed} — nhận được '{suffix or 'không có đuôi'}'.")

    stem = _UNSAFE_CHARS.sub("_", name[: -len(suffix)]).strip("._-")
    if not stem:
        raise ValueError("Tên file không hợp lệ sau khi làm sạch.")
    return f"{stem[:100]}{suffix}"


class Audit:
    """Ghi audit log dạng JSON-lines, mỗi dòng một sự kiện.

    Dùng cho: auto-confirm proposal (ADR-004 bắt buộc trace), Analyst confirm/
    reject, chạy kiểm định thống kê, và mọi lần từ chối vì lý do governance.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, event: str, **fields: Any) -> None:
        record = {
            "ts": datetime.now(UTC).isoformat(timespec="seconds"),
            "event": event,
            **fields,
        }
        line = json.dumps(record, ensure_ascii=False, default=str)
        with self._lock:
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")

    def tail(self, limit: int = 50) -> list[dict[str, Any]]:
        """Đọc `limit` sự kiện gần nhất — phục vụ UI review async."""
        if not self.path.exists():
            return []
        with self.path.open(encoding="utf-8") as fh:
            lines = fh.readlines()[-limit:]
        out: list[dict[str, Any]] = []
        for line in lines:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out


class RateLimiter:
    """Token bucket đơn giản theo user, cửa sổ trượt 60 giây."""

    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, user_id: str) -> bool:
        now = time.monotonic()
        with self._lock:
            bucket = self._hits[user_id]
            while bucket and now - bucket[0] > 60.0:
                bucket.popleft()
            if len(bucket) >= self.per_minute:
                return False
            bucket.append(now)
            return True

    def check(self, user_id: str) -> None:
        """Như `allow` nhưng raise HTTP 429 — dùng trực tiếp trong route."""
        if not self.allow(user_id):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Vượt giới hạn {self.per_minute} request/phút. Thử lại sau ít giây.",
            )


_audit: Audit | None = None
_limiter: RateLimiter | None = None
_lock = threading.Lock()


def get_audit(settings: Settings | None = None) -> Audit:
    global _audit
    with _lock:
        if _audit is None:
            cfg = settings or get_settings()
            _audit = Audit(cfg.audit_log_path)
        return _audit


def get_rate_limiter(settings: Settings | None = None) -> RateLimiter:
    global _limiter
    with _lock:
        if _limiter is None:
            cfg = settings or get_settings()
            _limiter = RateLimiter(cfg.security_user_rate_per_minute)
        return _limiter


async def require_token(authorization: str | None = Header(default=None)) -> str:
    """Fail-closed: bật `security.require_api_token` mà quên điền API_TOKEN thì chặn hết.

    Trả về user id thô để rate limiter phân biệt caller.
    """
    settings = get_settings()
    if not settings.security_require_api_token:
        return "anonymous"

    if not settings.api_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server bật require_api_token nhưng chưa cấu hình API_TOKEN trong .env.",
        )

    prefix = "bearer "
    token = ""
    if authorization and authorization.lower().startswith(prefix):
        token = authorization[len(prefix) :].strip()

    # compare_digest tránh timing attack khi so sánh token.
    if not token or not secrets.compare_digest(token, settings.api_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token không hợp lệ.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return f"token-{token[:8]}"


__all__ = [
    "ALLOWED_UPLOAD_SUFFIXES",
    "Audit",
    "RateLimiter",
    "get_audit",
    "get_rate_limiter",
    "require_token",
    "safe_filename",
]
