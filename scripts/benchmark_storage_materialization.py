"""Measure source materialization latency without making performance claims.

Pass one or both internal references. A legacy ``gdrive://`` reference is
useful only during rollout; the canonical reference should identify the copied
Supabase artifact. Results are local/staging measurements, not production SLOs.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from src.services.storage import materialize_source  # noqa: E402


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def _measure(label: str, source_ref: str, runs: int) -> None:
    samples: list[float] = []
    sizes: set[int] = set()
    for _ in range(runs):
        started = time.perf_counter()
        with materialize_source(source_ref) as path:
            sizes.add(path.stat().st_size)
        samples.append((time.perf_counter() - started) * 1000)
    print(
        json.dumps(
            {
                "label": label,
                "runs": runs,
                "size_bytes": next(iter(sizes)) if len(sizes) == 1 else sorted(sizes),
                "p50_ms": round(statistics.median(samples), 2),
                "p95_ms": round(_percentile(samples, 0.95), 2),
                "p99_ms": round(_percentile(samples, 0.99), 2),
                "scope": "local_or_staging_measurement",
            },
            separators=(",", ":"),
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-ref", help="Optional legacy gdrive:// source reference.")
    parser.add_argument("--canonical-ref", help="Canonical supabase:// or local-object:/// reference.")
    parser.add_argument("--runs", type=int, default=10)
    args = parser.parse_args()
    if not args.legacy_ref and not args.canonical_ref:
        parser.error("Provide --legacy-ref, --canonical-ref, or both.")
    if not 1 <= args.runs <= 100:
        parser.error("--runs must be between 1 and 100")
    if args.legacy_ref:
        _measure("legacy_google_drive_materialization", args.legacy_ref, args.runs)
    if args.canonical_ref:
        _measure("canonical_materialization", args.canonical_ref, args.runs)


if __name__ == "__main__":
    main()
