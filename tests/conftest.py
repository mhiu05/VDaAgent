"""Fixture dùng chung cho toàn bộ test suite.

Nguyên tắc: test phải chạy được **offline, không cần API key**, và không đụng
tới `data/` thật của máy dev. Muốn vậy thì biến môi trường phải được set
*trước* khi `src.config` bị import lần đầu, vì `get_settings()` có `lru_cache`
và đọc `.env` ngay lúc gọi. Đó là lý do khối `os.environ.update` nằm ở top-level
của file này chứ không nằm trong fixture — conftest được nạp trước mọi test
module, nên đây là chỗ sớm nhất còn kịp.

Cách cô lập này lấy đúng theo `scripts/smoke_test.py`, để test và smoke test
nhìn hệ thống ở cùng một trạng thái.
"""

from __future__ import annotations

import csv
import os
import random
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend"
# Ứng dụng đã tách sang backend/src. Giữ import `src.*` trong test để test
# vẫn phản chiếu đúng command phát triển: `cd backend; uvicorn src.main:app`.
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# --- Cô lập môi trường: phải chạy TRƯỚC khi import src.* -------------------- #
# Keep every temporary artifact inside the repository. On Windows, the user's
# default TEMP directory can be protected or contain non-ASCII segments that
# pytest cannot create a working directory in. Setting both the environment and
# tempfile cache before pytest creates its `tmp_path` fixtures makes local and
# CI runs deterministic.
_TMP_PARENT = ROOT / ".pytest_tmp"
_TMP_PARENT.mkdir(parents=True, exist_ok=True)
os.environ["TMP"] = str(_TMP_PARENT)
os.environ["TEMP"] = str(_TMP_PARENT)
tempfile.tempdir = str(_TMP_PARENT)
_TMP = Path(tempfile.mkdtemp(prefix="p170_tests_", dir=_TMP_PARENT))
_TEST_DATABASE_URL = (
    os.environ.get("P170_TEST_DATABASE_URL")
    or dotenv_values(ROOT / ".env").get("P170_TEST_DATABASE_URL")
    or ""
).strip()
if not _TEST_DATABASE_URL:
    raise RuntimeError(
        "P170_TEST_DATABASE_URL là bắt buộc khi chạy pytest. "
        "Hãy trỏ biến này tới một PostgreSQL database RIÊNG cho test; "
        "không dùng DATABASE_URL của ứng dụng hoặc production."
    )
if _TEST_DATABASE_URL.startswith("postgresql://"):
    _TEST_DATABASE_URL = _TEST_DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
elif _TEST_DATABASE_URL.startswith("postgres://"):
    _TEST_DATABASE_URL = _TEST_DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
os.environ.update(
    {
        "APP_ENV": "test",
        # Local tests use the explicit legacy bridge and never call Supabase.
        # This must override a developer's production AUTH_MODE in .env.
        "AUTH_MODE": "dual",
        # Không gọi LLM và không gửi trace đi đâu trong lúc test.
        "LANGCHAIN_TRACING_V2": "false",
        "LANGSMITH_TRACING": "false",
        "OPENAI_API_KEY": "",
        "LLM_API_KEY": "",
        # Keep the integration suite deterministic and profile-scoped. The
        # checked-in config enables external knowledge for staging, but tests
        # must not query that optional corpus or treat it as profile evidence.
        "RETRIEVAL_EXTERNAL_KNOWLEDGE_ENABLED": "false",
        # Upload tests must stay local and deterministic; never require a
        # developer's Google Drive or Supabase credentials.
        "STORAGE_PROVIDER": "local",
        # Tests require an explicit PostgreSQL test database.
        "DATABASE_URL": _TEST_DATABASE_URL,
        # LangGraph's PostgreSQL checkpointer must never fall back to the
        # production Supabase DSN while the integration suite is running.
        "DATABASE_CHECKPOINTER_URL": _TEST_DATABASE_URL,
        "RETRIEVAL_INDEX_DIR": str(_TMP / "index"),
        # API audit assertions use the same workspace-scoped database store as
        # the production activity endpoint. Unit tests for JSONL audit create
        # an explicit Audit instance instead.
        "SECURITY_AUDIT_LOG": "",
        "SECURITY_REQUIRE_API_TOKEN": "false",
        # Test suite có nhiều request nối tiếp trong một session; không để quota
        # production che khuất assertion nghiệp vụ của các endpoint cuối suite.
        "SECURITY_USER_RATE_PER_MINUTE": "1000",
        "APP_DATA_DIR": str(_TMP / "data"),
    }
)

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from src.main import app


@pytest.fixture(scope="session")
def tmp_root() -> Path:
    """Thư mục tạm dùng chung cho cả session test."""
    return _TMP


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    """TestClient đồng bộ.

    Dùng `TestClient` (sync) thay vì `httpx.AsyncClient` vì graph chạy blocking
    qua `asyncio.to_thread` — client sync gọi đúng luồng thật của app và không
    cần `pytest-asyncio` cho phần API. Scope session để lifespan chỉ chạy 1 lần.
    """
    with TestClient(app) as test_client:
        yield test_client


def make_csv(path: Path, rows: int = 300, seed: int = 7, shift: bool = False) -> Path:
    """Sinh CSV mẫu có sẵn: khoá ứng viên, PII, outlier, cột hằng.

    `shift=True` đổi phân phối `salary` và tập `city` để test drift.
    """
    random.seed(seed)
    path.parent.mkdir(parents=True, exist_ok=True)
    mean = 26_000_000 if shift else 20_000_000
    cities = (
        ["Hà Nội", "TP HCM", "Hải Phòng", "Huế"] if shift else ["Hà Nội", "Đà Nẵng", "TP HCM"]
    )

    records = [
        {
            "user_id": i,
            "email": f"user{i}@example.com" if i % 17 else "",
            "phone": f"09{random.randint(10_000_000, 99_999_999)}",
            "age": random.randint(18, 70),
            # i % 50 == 0 -> giá trị cực lớn để chắc chắn có outlier.
            "salary": round(random.gauss(mean, 5_000_000), 2) if i % 50 else 900_000_000,
            "city": random.choice(cities),
            "status": "active",
        }
        for i in range(1, rows + 1)
    ]
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)
    return path


@pytest.fixture(scope="session")
def sample_csv(tmp_root: Path) -> Path:
    return make_csv(tmp_root / "users.csv")


@pytest.fixture(scope="session")
def shifted_csv(tmp_root: Path) -> Path:
    return make_csv(tmp_root / "users_v2.csv", seed=99, shift=True)


@pytest.fixture(scope="session")
def profile_run(client: TestClient, sample_csv: Path) -> dict:
    """Một profile run hoàn chỉnh (đã dừng ở điểm chờ HITL).

    Nhiều test cần một run có sẵn nhưng profiling khá tốn thời gian, nên chạy
    một lần cho cả session và chia sẻ kết quả.
    """
    response = client.post(
        "/api/v1/profile",
        json={
            "dataset_ref": str(sample_csv),
            "dataset_name": "users_test",
            "run_name": "Kiểm tra dữ liệu gốc",
            "scan_mode": "full",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture(scope="session")
def reviewed_profile_run(client: TestClient, sample_csv: Path) -> dict:
    """Run riêng đã qua HITL, dùng cho QA đúng với contract HTTP 409 hiện tại."""
    created_response = client.post(
        "/api/v1/profile",
        json={
            "dataset_ref": str(sample_csv),
            "dataset_name": "users_reviewed",
            "scan_mode": "full",
        },
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()

    decisions = [
        {"kind": kind, "proposal_id": proposal["id"], "decision": "confirm"}
        for kind in ("candidate_key", "semantic_type", "pii")
        for proposal in created["proposals"][kind]
        if proposal["status"] == "pending"
    ]
    confirmed = client.patch(
        f"/api/v1/profile/{created['profile_run_id']}/confirm",
        json={"confirmed_by": "qa-test", "decisions": decisions, "resume": True},
    )
    assert confirmed.status_code == 200, confirmed.text

    profile = client.get(f"/api/v1/profile/{created['profile_run_id']}")
    assert profile.status_code == 200, profile.text
    return profile.json()


@pytest.fixture
def frame() -> pd.DataFrame:
    """DataFrame nhỏ, giá trị dựng tay để assert được con số chính xác."""
    return pd.DataFrame(
        {
            # 1 null trong 10 dòng -> null_pct = 10.0
            "score": [10.0, 12.0, 11.0, 13.0, 12.0, 11.0, 10.0, 12.0, 1000.0, None],
            # unique toàn bộ -> uniqueness_ratio = 1.0
            "code": [f"C{i}" for i in range(10)],
            # một giá trị duy nhất -> cardinality = 1
            "flag": ["x"] * 10,
            "group": ["a", "a", "a", "a", "a", "b", "b", "b", "b", "b"],
        }
    )
