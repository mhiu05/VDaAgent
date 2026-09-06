"""Normalize one run's raw responses without overwriting source artifacts."""
from __future__ import annotations

import argparse

from common import RUNS, answer_text, publish_alias, read_json, read_jsonl, run_dir, scrub, stage_status, write_jsonl


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    return parser.parse_args()


def main() -> None:
    args = _arguments()
    directory = run_dir(args.run_id)
    metadata = read_json(directory / "execution_metadata.json", {})
    if metadata.get("status") != "COMPLETED":
        raise SystemExit("Normalization requires a COMPLETED execution stage.")
    stage_status(directory, "normalize", "RUNNING")
    normalized = []
    for result in read_jsonl(directory / "raw_results.jsonl"):
        body = result.get("response") if isinstance(result.get("response"), dict) else {}
        events = body.get("events") if isinstance(body.get("events"), list) else []
        meta = next((event.get("payload") for event in events if isinstance(event, dict) and event.get("event") == "meta" and isinstance(event.get("payload"), dict)), {})
        event_sources = [source for event in events if isinstance(event, dict) and event.get("event") == "source" for source in (event.get("payload", {}).get("sources") or []) if isinstance(source, dict)]
        done = next((event.get("payload") for event in reversed(events) if isinstance(event, dict) and event.get("event") == "done" and isinstance(event.get("payload"), dict)), {})
        response_error = next((event.get("payload") for event in reversed(events) if isinstance(event, dict) and event.get("event") == "error" and isinstance(event.get("payload"), dict)), {})
        normalized.append(scrub({
            "case_id": result.get("case_id"), "language": result.get("language", "vi-VN"),
            "environment": result.get("environment", "local"), "run_id": args.run_id,
            "attempt": result.get("attempt"), "status": result.get("status"),
            "status_code": result.get("status_code"), "dataset": result.get("dataset"),
            "question": result.get("question"), "answer": answer_text(body),
            "sources": body.get("sources") or event_sources,
            "citations": body.get("citations") or done.get("citations", []),
            "provenance": body.get("provenance") or done.get("answer_envelope", {}) or done.get("verification", {}) or {},
            "question_type": body.get("question_type") or done.get("question_type") or meta.get("question_type"),
            # Error events carry this ID even when the stream never reaches done.
            "agent_run_id": body.get("agent_run_id") or done.get("agent_run_id") or meta.get("agent_run_id") or response_error.get("agent_run_id"),
            "trace_id": body.get("trace_id") or done.get("trace_id") or response_error.get("trace_id"),
            "route": body.get("route") or done.get("execution_path") or meta.get("execution_path") or done.get("qa_path") or body.get("question_type") or done.get("question_type") or meta.get("question_type"),
            "tool_calls": body.get("tool_calls", []),
            "error": result.get("error") or response_error.get("code") or response_error.get("message"),
            "telemetry": result.get("telemetry", {}),
        }))
    destination = directory / "normalized_results.jsonl"
    write_jsonl(destination, normalized)
    stage_status(directory, "normalize", "COMPLETED", exit_code=0, records=len(normalized))
    publish_alias(destination, RUNS / "normalized_results.jsonl")


if __name__ == "__main__":
    main()
