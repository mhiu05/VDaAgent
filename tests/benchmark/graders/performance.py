"""Tổng hợp latency QA của run local, không gồm upload hay profiling setup."""
from __future__ import annotations

import statistics


def summary(results: list[dict]) -> dict:
    latencies = sorted(float(x.get("telemetry", {}).get("total_latency_ms")) for x in results if isinstance(x.get("telemetry", {}).get("total_latency_ms"), (int, float)))
    ttfts = [float(x.get("telemetry", {}).get("ttft_ms")) for x in results if isinstance(x.get("telemetry", {}).get("ttft_ms"), (int, float))]
    if not latencies:
        return {"status": "NOT_EVALUATED", "reason": "Không có telemetry latency từ phản hồi QA đã hoàn tất."}
    return {"status": "EVALUATED", "request_count": len(latencies), "p50_latency_ms": round(statistics.median(latencies), 3), "p95_latency_ms": round(latencies[min(len(latencies) - 1, max(0, int(.95 * len(latencies)) - 1))], 3), "mean_latency_ms": round(statistics.fmean(latencies), 3), "mean_ttft_ms": round(statistics.fmean(ttfts), 3) if ttfts else None, "error_rate": round(sum(x.get("status") != "OK" for x in results) / len(results), 6) if results else None}
