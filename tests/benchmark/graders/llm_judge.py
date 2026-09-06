"""Independent calibrated judge with Gemini-to-OpenAI fail-closed fallback."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from statistics import fmean, median, stdev
from typing import Any

from common import EVALUATIONS, read_json, scrub, write_json
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

EVALUATION_CODE = Path(__file__).resolve().parents[2] / "evaluations"
sys.path.insert(0, str(EVALUATION_CODE))
from judge_rubric import JudgeResult, RUBRIC_VERSION, judge_prompt  # noqa: E402

FIELDS = ("helpfulness", "groundedness", "tone", "uncertainty_calibration", "safety")
CALIBRATION = EVALUATION_CODE / "fixtures" / "judge_calibration_v1.json"
CACHE = EVALUATIONS / ".cache" / "judge"


def judge_config() -> dict[str, Any]:
    return {
        "provider": "gemini",
        "model": None,
        "requested_model": os.getenv("BENCHMARK_JUDGE_MODEL") or None,
        "model_selection_policy": "Discover generateContent models; prefer stable Pro, then stable Flash, then highest version.",
        "temperature": 0,
        "response_format": "application/json",
        "response_schema": "JudgeResult",
        "rubric_version": RUBRIC_VERSION,
        "api_key_configured": bool(os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY")),
        "same_provider_model_family_as_agent": (os.getenv("LLM_PROVIDER") or "").casefold() == "gemini",
    }


def openai_judge_config() -> dict[str, Any]:
    requested = os.getenv("BENCHMARK_OPENAI_JUDGE_MODEL") or None
    return {
        "provider": "openai",
        "model": requested or "gpt-5.4-mini",
        "requested_model": requested,
        "model_selection_policy": (
            "Honor BENCHMARK_OPENAI_JUDGE_MODEL when available; otherwise use "
            "gpt-5.4-mini, then gpt-5-mini."
        ),
        "reasoning_effort": "low",
        "temperature": None,
        "response_format": "JudgeResult via Responses API Structured Outputs",
        "response_schema": "JudgeResult",
        "rubric_version": RUBRIC_VERSION,
        "api_key_configured": bool(os.getenv("OPENAI_API_KEY")),
        "store": False,
        "same_provider_model_family_as_agent": (
            (os.getenv("LLM_PROVIDER") or "").casefold() == "openai"
        ),
    }


def _model_name(value: str) -> str:
    return value.removeprefix("models/")


def _model_actions(model: Any) -> list[str]:
    raw = getattr(model, "supported_actions", None) or getattr(model, "supported_generation_methods", None) or []
    return sorted({str(action) for action in raw})


def list_available_models(client: Any) -> list[dict[str, Any]]:
    return sorted(
        ({"name": _model_name(str(getattr(model, "name", ""))), "display_name": str(getattr(model, "display_name", "")), "supported_actions": _model_actions(model)} for model in client.models.list() if getattr(model, "name", None)),
        key=lambda item: item["name"],
    )


def _is_generate_candidate(model: dict[str, Any]) -> bool:
    name = str(model.get("name") or "").casefold()
    actions = {str(action).replace("_", "").casefold() for action in model.get("supported_actions", [])}
    excluded = ("embedding", "imagen", "image", "tts", "live", "audio", "robotics", "computer-use", "aqa")
    return "generatecontent" in actions and "gemini" in name and not any(token in name for token in excluded)


def _selection_rank(model: dict[str, Any]) -> tuple[int, int, tuple[int, int, int], str]:
    name = str(model["name"]).casefold()
    version = re.search(r"gemini-(\d+)(?:\.(\d+))?(?:\.(\d+))?", name)
    parsed = tuple(int(part or 0) for part in version.groups()) if version else (0, 0, 0)
    stable = 0 if any(marker in name for marker in ("preview", "experimental", "exp")) else 1
    capability = 2 if "pro" in name else 1 if "flash" in name else 0
    return stable, capability, parsed, name


def select_judge_model(catalog: list[dict[str, Any]], requested_model: str | None = None) -> tuple[str | None, dict[str, Any]]:
    candidates = [model for model in catalog if _is_generate_candidate(model)]
    requested = _model_name(str(requested_model or ""))
    if requested and (explicit := next((model for model in candidates if model["name"] == requested), None)):
        return explicit["name"], {"source": "BENCHMARK_JUDGE_MODEL", "candidate_count": len(candidates), "requested_model": requested}
    if not candidates:
        return None, {"source": "NONE", "candidate_count": 0, "requested_model": requested or None}
    chosen = max(candidates, key=_selection_rank)
    return chosen["name"], {"source": "DISCOVERED_POLICY" if not requested else "DISCOVERED_FALLBACK_REQUEST_UNAVAILABLE", "candidate_count": len(candidates), "requested_model": requested or None}


def _safe_error(exc: Exception, *, provider: str = "gemini") -> str:
    prefix = provider.upper()
    text = str(exc).casefold()
    if "401" in text or "unauthenticated" in text or "authentication" in text:
        return f"{prefix}_AUTH_FAILED"
    if "403" in text or "permission" in text:
        return f"{prefix}_PERMISSION_FAILED"
    if "429" in text or "quota" in text or "rate" in text:
        return f"{prefix}_RATE_LIMITED"
    if "model" in text and ("not found" in text or "unsupported" in text):
        return f"{prefix}_MODEL_UNAVAILABLE"
    return f"{prefix}_JUDGE_CALL_FAILED"


def _retryable(exc: Exception) -> bool:
    text = str(exc).casefold()
    return any(marker in text for marker in ("429", "500", "502", "503", "504", "timeout", "connection", "temporarily unavailable"))


def _cache_key(provider: str, model: str, payload: dict[str, Any]) -> str:
    body = json.dumps(
        {"rubric": RUBRIC_VERSION, "provider": provider, "model": model, **payload},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _invoke(client: Any, types: Any, model: str, payload: dict[str, Any]) -> tuple[JudgeResult, bool, int]:
    cache_path = CACHE / f"{_cache_key('gemini', model, payload)}.json"
    if cache_path.exists():
        return JudgeResult.model_validate(read_json(cache_path)), True, 0
    prompt = judge_prompt(question=str(payload.get("question") or ""), reference=str(payload.get("reference") or ""), evidence=str(payload.get("evidence") or ""), answer=str(payload.get("answer") or ""))
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0, max_output_tokens=512, response_mime_type="application/json", response_schema=JudgeResult),
            )
            parsed = getattr(response, "parsed", None)
            result = parsed if isinstance(parsed, JudgeResult) else JudgeResult.model_validate(parsed or json.loads(str(response.text or "{}")))
            write_json(cache_path, result.model_dump(mode="json"))
            return result, False, attempt
        except Exception as exc:
            last_error = exc
            if attempt == 3 or not _retryable(exc):
                raise
            time.sleep(min(4.0, 0.5 * 2 ** (attempt - 1)))
    raise last_error or RuntimeError("judge_call_failed")


def _invoke_openai(
    client: Any, model: str, payload: dict[str, Any]
) -> tuple[JudgeResult, bool, int]:
    """Call Responses Structured Outputs without persisting provider state."""

    cache_path = CACHE / f"{_cache_key('openai', model, payload)}.json"
    if cache_path.exists():
        return JudgeResult.model_validate(read_json(cache_path)), True, 0
    prompt = judge_prompt(
        question=str(payload.get("question") or ""),
        reference=str(payload.get("reference") or ""),
        evidence=str(payload.get("evidence") or ""),
        answer=str(payload.get("answer") or ""),
    )
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            response = client.responses.parse(
                model=model,
                input=prompt,
                text_format=JudgeResult,
                max_output_tokens=1024,
                reasoning={"effort": "low"},
                store=False,
            )
            parsed = getattr(response, "output_parsed", None)
            result = (
                parsed
                if isinstance(parsed, JudgeResult)
                else JudgeResult.model_validate(
                    parsed or json.loads(str(getattr(response, "output_text", "") or "{}"))
                )
            )
            write_json(cache_path, result.model_dump(mode="json"))
            return result, False, attempt
        except Exception as exc:
            last_error = exc
            if attempt == 3 or not _retryable(exc):
                raise
            time.sleep(min(4.0, 0.5 * 2 ** (attempt - 1)))
    raise last_error or RuntimeError("openai_judge_call_failed")


def _calibrate(client: Any, types: Any, model: str) -> tuple[dict[str, Any], int]:
    records, calls = [], 0
    for item in read_json(CALIBRATION, {}).get("cases", []):
        result, cached, attempts = _invoke(client, types, model, item)
        calls += attempts
        minimums = item.get("minimum_scores") or {}
        passed = result.decision == item["expected_decision"] and all(getattr(result, key) >= value for key, value in minimums.items())
        records.append({"id": item["id"], "expected_decision": item["expected_decision"], "actual_decision": result.decision, "calibration_pass": passed, "cache_hit": cached})
    agreement = sum(bool(item["calibration_pass"]) for item in records) / len(records) if records else 0.0
    return {"status": "EVALUATED", "rubric_version": RUBRIC_VERSION, "fixture": str(CALIBRATION.relative_to(EVALUATIONS.parent)), "case_count": len(records), "agreement": round(agreement, 6), "gate_pass": agreement >= 0.85, "records": records}, calls


def _calibrate_openai(client: Any, model: str) -> tuple[dict[str, Any], int]:
    records, calls = [], 0
    for item in read_json(CALIBRATION, {}).get("cases", []):
        result, cached, attempts = _invoke_openai(client, model, item)
        calls += attempts
        minimums = item.get("minimum_scores") or {}
        passed = result.decision == item["expected_decision"] and all(
            getattr(result, key) >= value for key, value in minimums.items()
        )
        records.append(
            {
                "id": item["id"],
                "expected_decision": item["expected_decision"],
                "actual_decision": result.decision,
                "calibration_pass": passed,
                "cache_hit": cached,
            }
        )
    agreement = (
        sum(bool(item["calibration_pass"]) for item in records) / len(records)
        if records
        else 0.0
    )
    return {
        "status": "EVALUATED",
        "rubric_version": RUBRIC_VERSION,
        "fixture": str(CALIBRATION.relative_to(EVALUATIONS.parent)),
        "case_count": len(records),
        "agreement": round(agreement, 6),
        "gate_pass": agreement >= 0.85,
        "records": records,
    }, calls


def _aggregate(records: list[dict[str, Any]], cases: dict[str, dict[str, Any]]) -> dict[str, Any]:
    def summary(items: list[dict[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {"n": len(items)}
        for field in FIELDS:
            values = [item[field] for item in items]
            average, deviation = fmean(values), stdev(values) if len(values) > 1 else 0.0
            result[field] = {"mean": round(average, 6), "median": median(values), "std": round(deviation, 6)}
        return result
    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_category[str(cases[record["case_id"]].get("category_vi"))].append(record)
    return {"overall": summary(records), "by_category": {key: summary(value) for key, value in sorted(by_category.items())}}


def _judge_payload(case: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    """Build evidence from independent truth plus the public response envelope.

    The Judge must see the claim bindings that the user saw. Internal tool
    results and deterministic grader verdicts remain hidden, so this does not
    let one grader leak its pass/fail decision into another.
    """

    envelope = row.get("provenance") if isinstance(row.get("provenance"), dict) else {}
    public_sources = []
    for source in row.get("sources") or []:
        if not isinstance(source, dict):
            continue
        public_sources.append(
            {
                key: source.get(key)
                for key in (
                    "citation_id",
                    "type",
                    "tool",
                    "args",
                    "status",
                    "source_artifact",
                    "sample_scope",
                    "is_approximate",
                )
                if source.get(key) is not None
            }
        )
    claim_bindings = []
    for finding in envelope.get("findings") or []:
        if not isinstance(finding, dict):
            continue
        for citation in finding.get("citations") or []:
            if not isinstance(citation, dict):
                continue
            claim_bindings.append(
                {
                    key: citation.get(key)
                    for key in (
                        "citation_id",
                        "metric",
                        "value",
                        "unit",
                        "field",
                        "source_artifact",
                        "sample_scope",
                        "is_approximate",
                    )
                    if citation.get(key) is not None
                }
            )
    evidence = {
        "independent_benchmark_evidence": (
            case.get("judge_evidence")
            if case.get("judge_evidence") is not None
            else case.get("structured_ground_truth")
        ),
        "evidence_policy": case.get("expected_evidence") or {},
        "public_evidence_status": envelope.get("evidence_status"),
        "public_sources": public_sources,
        "public_claim_bindings": claim_bindings,
        "public_limitations": envelope.get("limitations") or [],
    }
    return {
        "question": case["question"],
        "reference": case.get("judge_reference") or case["expected_answer"],
        "evidence": json.dumps(scrub(evidence), ensure_ascii=False, sort_keys=True),
        "answer": row["answer"],
    }


def _score_gemini(cases: dict[str, dict[str, Any]], results: list[dict[str, Any]]) -> dict[str, Any]:
    config = judge_config()
    eligible = [item for item in results if item.get("status") == "OK" and str(item.get("answer") or "").strip() and item.get("case_id") in cases and cases[item["case_id"]].get("judge_required")]
    base = {"language": "vi-VN", "judge_configuration": config, "rubric_version": RUBRIC_VERSION, "judge_cases": 0, "judge_calls_attempted": 0, "model_list_calls_attempted": 0}
    if not config["api_key_configured"]:
        return {**base, "status": "FAILED", "reason": "GEMINI_NOT_CONFIGURED", "scores": [], "calibration": {"status": "NOT_EVALUATED"}}
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY"))
    try:
        catalog = list_available_models(client)
    except Exception as exc:
        reason = _safe_error(exc)
        return {**base, "status": "FAILED", "reason": reason, "model_list_calls_attempted": 1, "model_catalog": {"status": "FAILED", "models": [], "reason": reason, "method": "Gemini Models API list"}, "scores": [], "calibration": {"status": "NOT_EVALUATED"}}
    selected_model, selection = select_judge_model(catalog, config.get("requested_model"))
    config = {**config, "model": selected_model, "model_selection": selection}
    base.update({"judge_configuration": config, "model_list_calls_attempted": 1, "model_catalog": {"status": "EVALUATED", "models": catalog, "reason": None, "method": "Gemini Models API list"}})
    if not selected_model:
        return {**base, "status": "FAILED", "reason": "GEMINI_NO_GENERATION_MODEL", "scores": [], "calibration": {"status": "NOT_EVALUATED"}}
    try:
        calibration, calibration_calls = _calibrate(client, types, selected_model)
    except Exception as exc:
        return {**base, "status": "FAILED", "reason": _safe_error(exc), "scores": [], "judge_calls_attempted": 1, "calibration": {"status": "FAILED", "reason": _safe_error(exc)}}
    if not calibration["gate_pass"]:
        return {**base, "status": "FAILED_CALIBRATION", "reason": "CALIBRATION_BELOW_85_PERCENT", "scores": [], "judge_calls_attempted": calibration_calls, "calibration": calibration}
    records, failures, calls = [], [], calibration_calls
    for row in eligible:
        case = cases[row["case_id"]]
        payload = _judge_payload(case, row)
        try:
            judged, cached, attempts = _invoke(client, types, selected_model, payload)
            calls += attempts
            records.append(scrub({"case_id": row["case_id"], "attempt": row.get("attempt"), **judged.model_dump(mode="json"), "cache_hit": cached}))
        except Exception as exc:
            failures.append({"case_id": row["case_id"], "attempt": row.get("attempt"), "reason": _safe_error(exc)})
    status = "EVALUATED" if records and not failures else "PARTIALLY_EVALUATED" if records else "FAILED"
    return {**base, "status": status, "reason": None if status == "EVALUATED" else failures[0]["reason"] if failures else "NO_ELIGIBLE_JUDGE_CASES", "judge_cases": len(records), "judge_calls_attempted": calls, "scores": records, "failed_cases": failures, "aggregation": _aggregate(records, cases) if records else {}, "calibration": calibration}


def _openai_model_catalog(client: Any) -> list[str]:
    return sorted(
        {
            str(getattr(model, "id", ""))
            for model in client.models.list()
            if getattr(model, "id", None)
        }
    )


def _select_openai_model(
    catalog: list[str], requested_model: str | None
) -> tuple[str, dict[str, Any]]:
    requested = str(requested_model or "").strip()
    available = set(catalog)
    if requested and (not available or requested in available):
        return requested, {
            "source": "BENCHMARK_OPENAI_JUDGE_MODEL",
            "requested_model": requested,
        }
    for candidate in ("gpt-5.4-mini", "gpt-5-mini"):
        if not available or candidate in available:
            return candidate, {
                "source": (
                    "DOCUMENTED_DEFAULT"
                    if not requested
                    else "DOCUMENTED_FALLBACK_REQUEST_UNAVAILABLE"
                ),
                "requested_model": requested or None,
            }
    return requested or "gpt-5.4-mini", {
        "source": "DOCUMENTED_DEFAULT_NOT_IN_CATALOG",
        "requested_model": requested or None,
    }


def _score_openai(cases: dict[str, dict[str, Any]], results: list[dict[str, Any]]) -> dict[str, Any]:
    config = openai_judge_config()
    eligible = [
        item
        for item in results
        if item.get("status") == "OK"
        and str(item.get("answer") or "").strip()
        and item.get("case_id") in cases
        and cases[item["case_id"]].get("judge_required")
    ]
    base = {
        "language": "vi-VN",
        "judge_configuration": config,
        "rubric_version": RUBRIC_VERSION,
        "judge_cases": 0,
        "judge_calls_attempted": 0,
        "model_list_calls_attempted": 0,
    }
    if not config["api_key_configured"]:
        return {
            **base,
            "status": "FAILED",
            "reason": "OPENAI_NOT_CONFIGURED",
            "scores": [],
            "calibration": {"status": "NOT_EVALUATED"},
        }

    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=60.0, max_retries=0)
    catalog: list[str] = []
    catalog_status = "EVALUATED"
    catalog_reason = None
    try:
        catalog = _openai_model_catalog(client)
    except Exception as exc:
        # Model listing is provenance only. A key with restricted list-models
        # permission may still be authorized for the configured Responses model.
        catalog_status = "FAILED"
        catalog_reason = _safe_error(exc, provider="openai")
    selected_model, selection = _select_openai_model(
        catalog, config.get("requested_model")
    )
    config = {**config, "model": selected_model, "model_selection": selection}
    base.update(
        {
            "judge_configuration": config,
            "model_list_calls_attempted": 1,
            "model_catalog": {
                "status": catalog_status,
                "models": catalog,
                "reason": catalog_reason,
                "method": "OpenAI Models API list",
            },
        }
    )
    try:
        calibration, calibration_calls = _calibrate_openai(client, selected_model)
    except Exception as exc:
        reason = _safe_error(exc, provider="openai")
        return {
            **base,
            "status": "FAILED",
            "reason": reason,
            "scores": [],
            "judge_calls_attempted": 1,
            "calibration": {"status": "FAILED", "reason": reason},
        }
    if not calibration["gate_pass"]:
        return {
            **base,
            "status": "FAILED_CALIBRATION",
            "reason": "CALIBRATION_BELOW_85_PERCENT",
            "scores": [],
            "judge_calls_attempted": calibration_calls,
            "calibration": calibration,
        }

    records, failures, calls = [], [], calibration_calls
    for row in eligible:
        case = cases[row["case_id"]]
        payload = _judge_payload(case, row)
        try:
            judged, cached, attempts = _invoke_openai(client, selected_model, payload)
            calls += attempts
            records.append(
                scrub(
                    {
                        "case_id": row["case_id"],
                        "attempt": row.get("attempt"),
                        **judged.model_dump(mode="json"),
                        "cache_hit": cached,
                    }
                )
            )
        except Exception as exc:
            failures.append(
                {
                    "case_id": row["case_id"],
                    "attempt": row.get("attempt"),
                    "reason": _safe_error(exc, provider="openai"),
                }
            )
    status = (
        "EVALUATED"
        if records and not failures
        else "PARTIALLY_EVALUATED"
        if records
        else "FAILED"
    )
    return {
        **base,
        "status": status,
        "reason": (
            None
            if status == "EVALUATED"
            else failures[0]["reason"]
            if failures
            else "NO_ELIGIBLE_JUDGE_CASES"
        ),
        "judge_cases": len(records),
        "judge_calls_attempted": calls,
        "scores": records,
        "failed_cases": failures,
        "aggregation": _aggregate(records, cases) if records else {},
        "calibration": calibration,
    }


def score(
    cases: dict[str, dict[str, Any]],
    results: list[dict[str, Any]],
    deterministic_scores: list[dict[str, Any]],
) -> dict[str, Any]:
    del deterministic_scores  # Judge is deliberately blind to deterministic verdicts.
    gemini = _score_gemini(cases, results)
    attempts = [
        {
            "provider": "gemini",
            "status": gemini.get("status"),
            "reason": gemini.get("reason"),
        }
    ]
    if gemini.get("status") == "EVALUATED":
        return {**gemini, "fallback_used": False, "provider_attempts": attempts}

    openai_result = _score_openai(cases, results)
    attempts.append(
        {
            "provider": "openai",
            "status": openai_result.get("status"),
            "reason": openai_result.get("reason"),
        }
    )
    return {
        **openai_result,
        "fallback_used": True,
        "fallback_from": {
            "provider": "gemini",
            "status": gemini.get("status"),
            "reason": gemini.get("reason"),
        },
        "provider_attempts": attempts,
        "gemini_model_catalog": gemini.get("model_catalog", {}),
    }


__all__ = [
    "judge_config",
    "list_available_models",
    "openai_judge_config",
    "score",
    "select_judge_model",
]
