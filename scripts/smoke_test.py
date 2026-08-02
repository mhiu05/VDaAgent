"""Smoke test end-to-end: profiling → HITL → kiểm định → drift → Q&A.

Chạy offline hoàn toàn (không cần API key) để kiểm tra phần deterministic:

    python scripts/smoke_test.py

Script tự tạo dataset mẫu trong `data/`, dùng DB tạm, và in kết quả từng bước.
Dùng để verify nhanh sau khi sửa code, và để chứng minh các ràng buộc an toàn
(mask PII, không tự confirm, hiệu chỉnh đa kiểm định) thực sự có hiệu lực.
"""

from __future__ import annotations

import csv
import logging
import os
import random
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Cô lập khỏi .env của máy: không gọi LLM, không gửi trace, DB riêng.
_TMP = Path(tempfile.mkdtemp(prefix="p170_smoke_"))
os.environ.update(
    {
        "LANGCHAIN_TRACING_V2": "false",
        "LANGSMITH_TRACING": "false",
        "OPENAI_API_KEY": "",
        "LLM_API_KEY": "",
        "DATABASE_URL": f"sqlite:///{(_TMP / 'smoke.db').as_posix()}",
        "RETRIEVAL_INDEX_DIR": str(_TMP / "index"),
        "SECURITY_AUDIT_LOG": str(_TMP / "audit.jsonl"),
        "SECURITY_REQUIRE_API_TOKEN": "false",
    }
)
logging.disable(logging.WARNING)

from fastapi.testclient import TestClient  # noqa: E402

from src.main import app  # noqa: E402

SAMPLE = ROOT / "data" / "sample_users.csv"


def header(text: str) -> None:
    print(f"\n{'=' * 70}\n{text}\n{'=' * 70}")


def make_dataset(path: Path, rows: int = 1200, seed: int = 7, shift: bool = False) -> None:
    """Sinh dataset mẫu. `shift=True` để tạo phiên bản có drift."""
    random.seed(seed)
    path.parent.mkdir(parents=True, exist_ok=True)
    mean = 26_000_000 if shift else 20_000_000
    cities = ["Hà Nội", "Đà Nẵng", "TP HCM", "Cần Thơ"]
    if shift:
        cities = ["Hà Nội", "TP HCM", "Hải Phòng", "Huế", "Nha Trang"]

    records = []
    for i in range(1, rows + 1):
        records.append(
            {
                "user_id": i,
                "email": f"user{i}@example.com" if i % 17 else "",
                "phone": f"09{random.randint(10_000_000, 99_999_999)}",
                "age": random.randint(18, 70),
                "salary": round(random.gauss(mean, 5_000_000), 2) if i % 50 else 900_000_000,
                "city": random.choice(cities),
                "status": "active",
                "signup_date": f"2024-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
            }
        )
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)


def main() -> int:
    client = TestClient(app)
    failures: list[str] = []

    def check(label: str, condition: bool, detail: str = "") -> None:
        print(f"  [{'PASS' if condition else 'FAIL'}] {label}{f' — {detail}' if detail else ''}")
        if not condition:
            failures.append(label)

    make_dataset(SAMPLE)

    # --- 1. Profiling ---------------------------------------------------- #
    header("1. POST /profile — chạy pipeline tới điểm chờ HITL")
    response = client.post(
        "/api/v1/profile",
        json={"dataset_ref": str(SAMPLE), "dataset_name": "users", "scan_mode": "full"},
    )
    if response.status_code >= 400:
        print("  LỖI:", response.json())
        return 1
    profile = response.json()
    run_id = profile["profile_run_id"]

    print(f"  run_id      : {run_id}")
    print(f"  số dòng     : {profile['row_count']}")
    print(f"  số cột      : {profile['column_count']}")
    print(f"  query đã chạy: {profile['executed_query']}")
    print(f"  status      : {profile['status']}")

    check("Đếm đủ 1200 dòng", profile["row_count"] == 1200, str(profile["row_count"]))
    check("scan_mode=full thì không phải số ước lượng", profile["is_approximate"] is False)
    check("Có proposal chờ Analyst duyệt", profile["pending_proposals"] > 0,
          f"{profile['pending_proposals']} proposal")
    check("Lưu lại query để tái lập được (L5)", bool(profile["executed_query"]))

    print("\n  PII phát hiện được:")
    pii_columns = set()
    for item in profile["proposals"]["pii"]:
        pii_columns.add(item["column_name"])
        print(f"    - {item['column_name']:12} {str(item['pii_type']):12} "
              f"conf={item['confidence_score']:.2f}  {item['evidence'][:60]}")
    check("Nhận ra cột email là PII", "email" in pii_columns)
    check("Nhận ra cột phone là PII", "phone" in pii_columns)

    print("\n  Candidate key:")
    for item in profile["proposals"]["candidate_key"]:
        print(f"    - {item['columns']} conf={item['confidence_score']:.2f}")
    keys = [tuple(k["columns"]) for k in profile["proposals"]["candidate_key"]]
    check("Tìm ra user_id là candidate key", ("user_id",) in keys)
    check(
        "Candidate key KHÔNG tự động confirmed (eval C-03)",
        all(k["status"] == "pending" for k in profile["proposals"]["candidate_key"]),
    )

    print("\n  Semantic type:")
    for item in profile["proposals"]["semantic_type"]:
        print(f"    - {item['column_name']:12} {item['proposed_type']:12} "
              f"conf={item['confidence_score']:.2f} status={item['status']}")

    email_stats = profile["column_stats"]["email"]
    check(
        "Giá trị mẫu của cột PII bị ẩn (eval C-01)",
        not email_stats.get("top_k_values"),
        f"top_k_values={email_stats.get('top_k_values')}",
    )
    check("Cột status chỉ có 1 giá trị -> cardinality=1",
          profile["column_stats"]["status"]["cardinality"] == 1)
    check("Phát hiện outlier ở cột salary",
          (profile["column_stats"]["salary"]["outlier_count"] or 0) > 0,
          f"{profile['column_stats']['salary']['outlier_count']} outlier")

    print("\n  Cảnh báo rủi ro:")
    for warning in profile["risk_warnings"][:8]:
        print(f"    - {warning}")
    check("Có cảnh báo rủi ro", len(profile["risk_warnings"]) > 0)

    # --- 2. Export -------------------------------------------------------- #
    header("2. GET /profile/{id}/export — không xuất dữ liệu thô (eval C-02)")
    export = client.get(f"/api/v1/profile/{run_id}/export").json()
    print(f"  note: {export['note']}")
    raw_values = [
        row.get("top_k_values")
        for row in export["profile"]["column_stats"]
        if row.get("top_k_values")
    ]
    check("Export không chứa giá trị dữ liệu thô", not raw_values)

    # --- 3. HITL ---------------------------------------------------------- #
    header("3. PATCH /profile/{id}/confirm — Analyst xác nhận")
    decisions = [
        {"kind": "candidate_key", "proposal_id": k["id"], "decision": "confirm"}
        for k in profile["proposals"]["candidate_key"]
    ] + [
        {"kind": "pii", "proposal_id": p["id"], "decision": "confirm"}
        for p in profile["proposals"]["pii"]
    ] + [
        {"kind": "semantic_type", "proposal_id": s["id"], "decision": "confirm"}
        for s in profile["proposals"]["semantic_type"]
        if s["status"] == "pending"
    ]
    confirm = client.patch(
        f"/api/v1/profile/{run_id}/confirm",
        json={"confirmed_by": "analyst@example.com", "decisions": decisions, "resume": True},
    )
    if confirm.status_code >= 400:
        print("  LỖI:", confirm.json())
        return 1
    confirmed = confirm.json()
    print(f"  áp dụng: {confirmed['applied']} quyết định")
    print(f"  còn chờ: {confirmed['pending_proposals']}")
    print(f"  status : {confirmed['status']}")
    check("Đã áp dụng hết quyết định", confirmed["applied"] == len(decisions))
    check("Không còn proposal nào chờ", confirmed["pending_proposals"] == 0)
    check("Có báo cáo sau khi xác nhận", bool(confirmed.get("narrative_report")))

    bad = client.patch(
        f"/api/v1/profile/{run_id}/confirm",
        json={
            "confirmed_by": "analyst@example.com",
            "decisions": [
                {"kind": "pii", "proposal_id": "khong-ton-tai", "decision": "confirm"}
            ],
        },
    )
    check("Proposal id sai thì trả 404", bad.status_code == 404, f"HTTP {bad.status_code}")

    # --- 4. Kiểm định thống kê -------------------------------------------- #
    header("4. POST /profile/{id}/test — kiểm định + hiệu chỉnh đa kiểm định (L1)")
    tests = client.post(
        f"/api/v1/profile/{run_id}/test",
        json={
            "requested_by": "analyst@example.com",
            "tests": [
                {"test_type": "shapiro_wilk", "columns": ["salary"]},
                {"test_type": "shapiro_wilk", "columns": ["age"]},
                {"test_type": "pearson", "columns": ["age", "salary"]},
                {"test_type": "spearman", "columns": ["age", "salary"]},
                {"test_type": "chi_square", "columns": ["city", "status"]},
                {"test_type": "grubbs", "columns": ["salary"]},
            ],
        },
    )
    if tests.status_code >= 400:
        print("  LỖI:", tests.json())
        return 1
    test_data = tests.json()
    def fmt_p(value: float | None) -> str:
        return "n/a" if value is None else f"{value:.4g}"

    for result in test_data["results"]:
        print(
            f"    {result['test_type']:15} {str(result['target_columns']):24} "
            f"p={fmt_p(result.get('p_value')):>10} "
            f"p_adj={fmt_p(result.get('p_value_adjusted')):>10} "
            f"-> {result['conclusion']}"
        )
        if result.get("error"):
            print(f"      (lý do: {result['error']})")
    print(f"\n  {test_data['correction_note']}")
    check("Chạy đủ 6 kiểm định", len(test_data["results"]) == 6)
    check(
        "Có p điều chỉnh khi chạy nhiều kiểm định (L1)",
        any(r.get("p_value_adjusted") is not None for r in test_data["results"]),
    )
    check("Có ghi chú về hiệu chỉnh", bool(test_data["correction_note"]))

    unknown = client.post(
        f"/api/v1/profile/{run_id}/test",
        json={"requested_by": "a", "tests": [{"test_type": "khong_ton_tai", "columns": ["age"]}]},
    )
    check("Kiểm định không hỗ trợ thì trả 422", unknown.status_code == 422)

    # --- 5. Drift --------------------------------------------------------- #
    header("5. POST /profile/{id}/drift — so sánh hai lần profiling")
    shifted = ROOT / "data" / "sample_users_v2.csv"
    make_dataset(shifted, seed=99, shift=True)
    second = client.post(
        "/api/v1/profile",
        json={"dataset_ref": str(shifted), "dataset_name": "users_v2", "scan_mode": "full"},
    ).json()
    drift = client.post(
        f"/api/v1/profile/{second['profile_run_id']}/drift",
        json={"baseline_run_id": run_id},
    )
    if drift.status_code >= 400:
        print("  LỖI:", drift.json())
        return 1
    drift_data = drift.json()
    print(f"  {drift_data['summary']}")
    for finding in drift_data["findings"][:8]:
        print(f"    - [{finding['severity']:5}] {finding['column_name']}: {finding['detail'][:80]}")
    check("Phát hiện được drift", len(drift_data["findings"]) > 0)
    check(
        "Phát hiện salary dịch chuyển",
        any(f["column_name"] == "salary" for f in drift_data["findings"]),
    )

    same = client.post(
        f"/api/v1/profile/{run_id}/drift", json={"baseline_run_id": run_id}
    )
    check("So sánh run với chính nó thì trả 422", same.status_code == 422)

    # --- 6. Q&A ----------------------------------------------------------- #
    header("6. POST /qa — hỏi đáp (không có LLM: trả số thô, không bịa)")
    quantitative = client.post(
        "/api/v1/qa",
        json={"question": "Tỷ lệ null của cột email là bao nhiêu?", "profile_run_id": run_id},
    ).json()
    print(f"  loại câu hỏi: {quantitative['question_type']}")
    print(f"  trả lời     : {quantitative['answer'][:300]}")
    check("Câu hỏi số được route sang nhánh định lượng",
          quantitative["question_type"] == "quantitative")

    vague = client.post(
        "/api/v1/qa", json={"question": "Cột đó có vấn đề không?", "profile_run_id": run_id}
    ).json()
    print(f"\n  câu mơ hồ -> {vague['question_type']}")
    print(f"  trả lời     : {vague['answer'][:300]}")
    check("Câu hỏi mơ hồ thì hỏi lại, không đoán (eval B-01)",
          vague["question_type"] == "clarify")

    qualitative = client.post(
        "/api/v1/qa",
        json={"question": "Dataset này có rủi ro gì về chất lượng dữ liệu?",
              "profile_run_id": run_id},
    ).json()
    print(f"\n  câu định tính -> {qualitative['question_type']}, "
          f"{len(qualitative['sources'])} nguồn")
    print(f"  trả lời     : {qualitative['answer'][:300]}")
    # Assert cứng vào số nguồn: nhánh định tính chạy hybrid search hoàn toàn
    # offline nên KHÔNG được phép rỗng. Trước đây check này có thêm nhánh
    # `or "không có thông tin" in answer` và fallback đó đã che một bug thật
    # (retrieval trả 0 hit) — bỏ hẳn để regression phải fail thành tiếng.
    check("Câu định tính được route sang nhánh định tính",
          qualitative["question_type"] == "qualitative")
    check("Câu định tính tìm được ngữ cảnh từ index",
          len(qualitative["sources"]) > 0)

    # --- 7. SSE ----------------------------------------------------------- #
    header("7. POST /qa/stream — SSE")
    with client.stream(
        "POST", "/api/v1/qa/stream",
        json={"question": "Dataset này có rủi ro gì?", "profile_run_id": run_id},
    ) as stream:
        events = [line for line in stream.iter_lines() if line.startswith("event:")]
    print(f"  events: {[e.removeprefix('event: ') for e in events]}")
    check("SSE phát event done", any("done" in e for e in events))
    check("SSE không có event error", not any("error" in e for e in events))

    # --- 8. Status & audit ------------------------------------------------ #
    header("8. GET /status & /audit")
    status = client.get("/api/v1/status").json()
    print(f"  provider={status['llm_provider']} model={status['llm_model']} "
          f"configured={status['llm_configured']}")
    print(f"  mask_pii={status['mask_pii_in_answers']} raw_export={status['allow_raw_export']}")
    print(f"  documents đã index: {status['indexed_documents']}")
    print(f"  cấu hình còn thiếu: {status['missing_config']}")
    check("Mặc định bật mask PII", status["mask_pii_in_answers"] is True)
    check("Mặc định tắt export dữ liệu thô", status["allow_raw_export"] is False)

    audit = client.get("/api/v1/audit?limit=200").json()["entries"]
    events_logged = {entry.get("event") for entry in audit}
    print(f"  audit events: {sorted(events_logged)}")
    check("Audit log ghi lại quyết định HITL", "hitl_decision" in events_logged)
    check("Audit log ghi lại lần ingest", "ingest" in events_logged)

    # --- Kết luận --------------------------------------------------------- #
    header("KẾT QUẢ")
    if failures:
        print(f"  {len(failures)} kiểm tra thất bại:")
        for item in failures:
            print(f"    - {item}")
        return 1
    print("  Tất cả kiểm tra đều PASS.")
    print("\n  Lưu ý: chạy không có LLM key nên báo cáo ở dạng bảng và Q&A trả số thô.")
    print("  Điền OPENAI_API_KEY (hoặc key của provider khác) trong .env để có phần")
    print("  diễn giải bằng ngôn ngữ tự nhiên.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
