"""Generate the deterministic, PII-free source used by the v2 staging benchmark."""

from __future__ import annotations

import argparse
import csv
from datetime import date
from pathlib import Path


REGIONS = ("North", "South", "East", "West")
CHANNELS = ("online", "retail")


def rows() -> list[dict[str, object]]:
    values: list[dict[str, object]] = []
    sequence = 1
    for month_index in range(24):
        year = 2024 + month_index // 12
        month = month_index % 12 + 1
        for region_index, region in enumerate(REGIONS):
            for repetition in range(5):
                sales: float | None = float(1000 + month_index * 25 + region_index * 50 + repetition * 10)
                if (sequence - 1) % 8 == 0:
                    sales = None
                values.append(
                    {
                        "order_id": f"ORD-{sequence:04d}",
                        "order_date": date(year, month, repetition + 1).isoformat(),
                        "region": region,
                        "channel": CHANNELS[(region_index + repetition) % len(CHANNELS)],
                        "sales": sales,
                        "cost": float(500 + month_index * 12 + region_index * 30 + repetition * 5),
                    }
                )
                sequence += 1
    return values


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    generated = rows()
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(generated[0]))
        writer.writeheader()
        writer.writerows(generated)
    print({"output": str(args.output), "row_count": len(generated), "sales_null_count": sum(item["sales"] is None for item in generated)})


if __name__ == "__main__":
    main()
