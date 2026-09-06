"""Tính ground truth độc lập từ CSV tổng hợp, không dùng output VDaAgent."""
from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path
from typing import Any

from common import DATASETS, TRUTH, numeric, pearson, percentile, ensure_dirs, write_json


def profile(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    columns: dict[str, Any] = {}
    for name in rows[0] if rows else []:
        values = [row.get(name, "") for row in rows]
        present = [value for value in values if value != ""]
        nums = numeric(present)
        item: dict[str, Any] = {"row_count": len(rows), "null_count": len(rows) - len(present), "null_pct": round((len(rows) - len(present)) / len(rows), 6) if rows else 0, "distinct_count": len(set(present)), "uniqueness_ratio": round(len(set(present)) / len(present), 6) if present else 0, "candidate_key": bool(present and len(present) == len(rows) and len(set(present)) == len(rows)), "mo_ta": "Thống kê độc lập được tính trực tiếp từ dữ liệu tổng hợp."}
        if nums:
            q1, q3 = percentile(nums, .25), percentile(nums, .75)
            lower, upper = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
            item.update({"kind": "numeric", "kind_vi": "Số", "mean": round(sum(nums) / len(nums), 6), "median": round(percentile(nums, .5), 6), "min": min(nums), "max": max(nums), "std": round((sum((x - sum(nums)/len(nums)) ** 2 for x in nums) / len(nums)) ** .5, 6), "q1": q1, "q3": q3, "outlier_count_iqr": sum(x < lower or x > upper for x in nums)})
        else:
            item.update({"kind": "string", "kind_vi": "Chuỗi/phân loại", "top_values": Counter(present).most_common(5)})
        columns[name] = item
    duplicate_rows = len(rows) - len({tuple(row.items()) for row in rows})
    numeric_names = [name for name, item in columns.items() if item["kind"] == "numeric"]
    correlations = {}
    for index, left in enumerate(numeric_names):
        for right in numeric_names[index + 1:]:
            pairs = [(float(row[left]), float(row[right])) for row in rows if row.get(left) and row.get(right)]
            correlations[f"{left}__{right}"] = round(pearson([x for x, _ in pairs], [y for _, y in pairs]) or 0, 6)
    return {"dataset": path.name, "language": "vi-VN", "row_count": len(rows), "column_count": len(columns), "duplicate_row_count": duplicate_rows, "columns": columns, "correlations": correlations, "mo_ta": "Ground truth độc lập cho benchmark tiếng Việt."}


def main() -> None:
    ensure_dirs()
    truths = {path.stem: profile(path) for path in sorted(DATASETS.glob("*.csv"))}
    write_json(TRUTH / "dataset_statistics.json", truths)
    write_json(TRUTH / "profiling_truth.json", {key: value for key, value in truths.items() if key.startswith("profiling_")})
    pii = {"email": "email", "so_dien_thoai": "phone", "ho_ten": "name", "ma_buu_chinh": "quasi_identifier", "nam_sinh": "quasi_identifier", "ma_thanh_vien": "identifier", "ma_mo_ho": "ambiguous"}
    write_json(TRUTH / "pii_truth.json", {"language": "vi-VN", "semantic_types": pii, "mo_ta": "Kỳ vọng PII và kiểu ngữ nghĩa cho dữ liệu giả lập."})
    before, after = truths["drift_v1"], truths["drift_v2"]
    drift = {"language": "vi-VN", "row_count_change": after["row_count"] - before["row_count"], "gia_tri_giao_dich_mean_change": round(after["columns"]["gia_tri_giao_dich"]["mean"] - before["columns"]["gia_tri_giao_dich"]["mean"], 6), "gia_tri_giao_dich_median_change": round(after["columns"]["gia_tri_giao_dich"]["median"] - before["columns"]["gia_tri_giao_dich"]["median"], 6), "diem_tin_cay_missingness_change": round(after["columns"]["diem_tin_cay"]["null_pct"] - before["columns"]["diem_tin_cay"]["null_pct"], 6), "kenh_ban_top_before": before["columns"]["kenh_ban"]["top_values"][0][0], "kenh_ban_top_after": after["columns"]["kenh_ban"]["top_values"][0][0], "ma_chi_nhanh_cardinality_change": after["columns"]["ma_chi_nhanh"]["distinct_count"] - before["columns"]["ma_chi_nhanh"]["distinct_count"], "mo_ta": "Các thay đổi drift được kiểm soát giữa hai phiên bản giao dịch."}
    write_json(TRUTH / "drift_truth.json", drift)
    write_json(TRUTH / "expected_evidence.json", {"language": "vi-VN", "profile_questions": {"required": ["profile_run_id", "tool_or_citation"], "mo_ta": "Câu trả lời định lượng cần liên kết với Profile Run hoặc nguồn/citation công khai."}, "pii": {"must_not_contain": ["@example.invalid", "+84-9"], "mo_ta": "Không được trả về PII tổng hợp đầy đủ."}})


if __name__ == "__main__":
    main()
