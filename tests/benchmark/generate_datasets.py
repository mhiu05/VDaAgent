"""Sinh dữ liệu benchmark tổng hợp, tái lập được, theo ngữ cảnh Việt Nam."""
from __future__ import annotations

import csv
import random

from common import DATASETS, SEED, ensure_dirs, write_json


def save(name: str, columns: list[str], rows: list[dict[str, object]]) -> None:
    with (DATASETS / name).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def base_rows() -> list[dict[str, object]]:
    """120 hồ sơ khách hàng giả, có phân phối, PII tổng hợp và khóa định danh."""
    rng = random.Random(SEED)
    ho_dem = ["Nguyễn Văn", "Trần Thị", "Lê Minh", "Phạm Ngọc", "Hoàng Gia", "Võ Thu", "Đặng Quốc", "Bùi Thanh"]
    ten = ["An", "Bình", "Chi", "Dũng", "Hà", "Lan", "Minh", "Phương", "Quân", "Trang"]
    tinh_thanh = ["Hà Nội", "Đà Nẵng", "TP. Hồ Chí Minh", "Cần Thơ", "Hải Phòng", "Nghệ An"]
    rows: list[dict[str, object]] = []
    for index in range(120):
        tuoi = 22 + (index * 7) % 42
        so_don_hang = 1 + index % 11
        doanh_thu = round(1_250_000 + 385_000 * so_don_hang + rng.gauss(0, 90_000), 2)
        if index in (5, 41, 89):
            doanh_thu = 19_990_000.0
        chi_tieu_truc_tuyen = round(350_000 + 115_000 * so_don_hang + rng.gauss(0, 60_000), 2)
        rows.append({
            "ma_khach_hang": f"KH-{index:03d}",
            "ho_ten": f"{ho_dem[index % len(ho_dem)]} {ten[index % len(ten)]}",
            "tuoi": "" if index in (2, 17, 91) else tuoi,
            "gioi_tinh": ("Nữ", "Nam", "Khác")[index % 3],
            "email": f"khach.hang{index:03d}@example.invalid",
            "so_dien_thoai": f"+84-900-{index:03d}-{index % 100:02d}",
            "tinh_thanh": tinh_thanh[index % len(tinh_thanh)],
            "ngay_dang_ky": f"2025-{(index % 12) + 1:02d}-{(index % 28) + 1:02d}",
            "thoi_diem_cap_nhat": f"2026-01-{(index % 28) + 1:02d}T{8 + index % 10:02d}:30:00",
            "so_don_hang": so_don_hang,
            "doanh_thu": doanh_thu,
            "giam_gia": round(170_000 - so_don_hang * 9_500, 2),
            "chi_tieu_truc_tuyen": chi_tieu_truc_tuyen,
            "diem_hai_long": round(3.1 + rng.gauss(0, 0.42), 2),
            "nhom_khach_hang": "Thân thiết" if index < 76 else "Mới",
            "ma_chi_nhanh": ("CN-HN", "CN-DN", "CN-HCM")[index % 3],
            "ma_khong_hop_le": f"NHOM-{index % 6}",
            "trang_thai_on_dinh": "Đang hoạt động",
            "ma_su_kien": f"SK-{index:03d}",
            "ghi_chu": "" if index % 10 == 0 else "Giao dịch tổng hợp phục vụ benchmark",
        })
    return rows


def edge_rows() -> list[dict[str, object]]:
    """Các cạnh dữ liệu: null hoàn toàn, hỗn hợp kiểu và một bản ghi trùng hoàn toàn."""
    rows = [
        {"ma_ban_ghi": "EDGE-001", "gia_tri_rong": "", "cot_hang_so": "không đổi", "gia_tri_hon_hop": "1", "ngay_co_the": "2026-01-01", "ma_khong_hop_le": "A01"},
        {"ma_ban_ghi": "EDGE-002", "gia_tri_rong": "", "cot_hang_so": "không đổi", "gia_tri_hon_hop": "một", "ngay_co_the": "không-phải-ngày", "ma_khong_hop_le": "A01"},
        {"ma_ban_ghi": "EDGE-003", "gia_tri_rong": "", "cot_hang_so": "không đổi", "gia_tri_hon_hop": "", "ngay_co_the": "2026-01-03", "ma_khong_hop_le": "A02"},
        {"ma_ban_ghi": "EDGE-004", "gia_tri_rong": "", "cot_hang_so": "không đổi", "gia_tri_hon_hop": "3.14", "ngay_co_the": "2026-01-04", "ma_khong_hop_le": "A02"},
    ]
    rows.append(dict(rows[3]))
    return rows


def pii_rows() -> list[dict[str, object]]:
    ho_dem = ["Nguyễn Văn", "Trần Thị", "Lê Minh", "Phạm Ngọc", "Võ Thu"]
    ten = ["An", "Bình", "Chi", "Dũng", "Hà", "Lan"]
    return [{
        "ma_thanh_vien": f"TV-{index:03d}",
        "ho_ten": f"{ho_dem[index % len(ho_dem)]} {ten[index % len(ten)]}",
        "email": f"thanh.vien{index:03d}@example.invalid",
        "so_dien_thoai": f"+84-901-{index:03d}-{index % 100:02d}",
        "ma_buu_chinh": f"10{index % 10:03d}",
        "nam_sinh": 1970 + index % 35,
        "ma_mo_ho": f"A{index:04d}",
        "tong_chi_tieu": round(1_000_000 + index * 125_000, 2),
    } for index in range(60)]


def drift_rows(version: int) -> list[dict[str, object]]:
    count = 80 if version == 1 else 100
    rows: list[dict[str, object]] = []
    for index in range(count):
        value = 1_200_000 + (index % 16) * 75_000 if version == 1 else 2_350_000 + (index % 16) * 115_000
        rows.append({
            "ma_giao_dich": f"GD-{version}-{index:03d}",
            "gia_tri_giao_dich": value,
            "so_san_pham": 1 + index % 7,
            "kenh_ban": ("Website" if index % 5 else "Cửa hàng") if version == 1 else ("Ứng dụng" if index % 2 else "Website"),
            "diem_tin_cay": "" if version == 2 and index % 8 == 0 else 500 + index % 70,
            "ma_chi_nhanh": f"CN-{index % (4 if version == 1 else 8):02d}",
        })
    return rows


def main() -> None:
    ensure_dirs()
    base = base_rows()
    save("profiling_base.csv", list(base[0]), base)
    edge = edge_rows()
    save("profiling_edge_cases.csv", list(edge[0]), edge)
    pii = pii_rows()
    save("profiling_pii.csv", list(pii[0]), pii)
    v1, v2 = drift_rows(1), drift_rows(2)
    save("drift_v1.csv", list(v1[0]), v1)
    save("drift_v2.csv", list(v2[0]), v2)
    write_json(DATASETS / "inventory.json", {
        "seed": SEED,
        "synthetic_only": True,
        "language": "vi-VN",
        "mo_ta": "Dữ liệu giả lập theo ngữ cảnh khách hàng và giao dịch tại Việt Nam; không dùng dữ liệu cá nhân thật.",
        "datasets": ["profiling_base.csv", "profiling_edge_cases.csv", "profiling_pii.csv", "drift_v1.csv", "drift_v2.csv"],
    })


if __name__ == "__main__":
    main()
