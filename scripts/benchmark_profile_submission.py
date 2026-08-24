"""Measure durable profiling submission fan-in against a running local API.

This script creates and deletes its own dataset. It deliberately does not run
the queued jobs: the measured surface is the HTTP acceptance path, independent
of profiling compute.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from uuid import uuid4

import httpx


def _percentile(samples: list[float], percentile: float) -> float:
    ordered = sorted(samples)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


async def _run(base_url: str, fan_in: list[int]) -> None:
    limits = httpx.Limits(max_connections=max(fan_in), max_keepalive_connections=20)
    async with httpx.AsyncClient(base_url=base_url, timeout=120, limits=limits) as client:
        csv_bytes = b"region,revenue,units\n" + b"north,100,2\n" * 1_000
        upload = await client.post(
            "/datasets/upload",
            files={"file": ("async-submission-benchmark.csv", csv_bytes, "text/csv")},
        )
        upload.raise_for_status()
        dataset_id = upload.json()["dataset_id"]

        async def submit() -> tuple[float, int]:
            started = time.perf_counter()
            response = await client.post(
                "/profile",
                headers={"Idempotency-Key": f"bench-{uuid4().hex}"},
                json={"dataset_id": dataset_id, "scan_mode": "full"},
            )
            return (time.perf_counter() - started) * 1_000, response.status_code

        try:
            for concurrency in fan_in:
                results = await asyncio.gather(*(submit() for _ in range(concurrency)))
                latencies = [latency for latency, _ in results]
                statuses = [status for _, status in results]
                print(
                    json.dumps(
                        {
                            "concurrency": concurrency,
                            "p50_ms": round(statistics.median(latencies), 1),
                            "p95_ms": round(_percentile(latencies, 0.95), 1),
                            "p99_ms": round(_percentile(latencies, 0.99), 1),
                            "max_ms": round(max(latencies), 1),
                            "failed_requests": sum(status != 202 for status in statuses),
                        },
                        separators=(",", ":"),
                    )
                )
        finally:
            cleanup = await client.delete(f"/datasets/{dataset_id}")
            cleanup.raise_for_status()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-url", default="http://127.0.0.1:8011/api/v1"
    )
    parser.add_argument("--fan-in", nargs="+", type=int, default=[1, 5, 10, 20])
    args = parser.parse_args()
    if not args.fan_in or min(args.fan_in) < 1:
        parser.error("--fan-in values must be positive")
    asyncio.run(_run(args.base_url.rstrip("/"), args.fan_in))


if __name__ == "__main__":
    main()
