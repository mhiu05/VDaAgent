"""Model calls (doc 03 "Model calls"): OpenRouter's OpenAI-format chat completions over httpx.

- Headers `HTTP-Referer: <APP_URL>` and `X-Title: VDaAgent`; `X-Contoso-Agent` / `X-Contoso-Purpose`
  name the caller (OpenRouter ignores them; FakeModel uses them to pick a script).
- 429, 5xx, timeouts and connection errors are retried up to 3 times with backoff 2, 4, 8 s
  plus up to 1 s of jitter, honouring `Retry-After` (decision 0019). Then `ModelUnavailable`.
- Usage (`prompt_tokens`, `completion_tokens`, cached tokens, `cost`) comes back with every
  response (`usage: {include: true}`).
- Context windows come from `GET /models` once at boot; `MODEL_CONTEXT_TOKENS` overrides them,
  and 128,000 is the fallback.
"""

from __future__ import annotations

import asyncio
import json
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

DEFAULT_WINDOW = 128_000
RETRIES = 3

PYTHON_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "python",
        "description": (
            "Run Python 3.12 in your agent folder (cwd). Use print() to see results. State "
            "persists only in files. Helpers: from contoso import send_to_user, send_to_agent, "
            "end_task."
        ),
        "parameters": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "Python source to run"}},
            "required": ["code"],
        },
    },
}


class ModelError(Exception):
    def __init__(
        self, message: str, status: int | None = None, *, code: str = "model_error"
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class ModelUnavailable(ModelError):
    """Retries exhausted (doc 03: the runner appends `model_unavailable`)."""

    def __init__(
        self, message: str, status: int | None = None, *, code: str = "model_unavailable"
    ) -> None:
        super().__init__(message, status=status, code=code)


@dataclass(frozen=True)
class ModelCapabilities:
    """Capabilities declared by the provider; ``None`` means unknown."""

    supports_tools: bool | None = None
    supports_tool_choice: bool | None = None
    supports_json_schema: bool | None = None
    supports_parallel_tools: bool | None = None
    supports_streaming: bool | None = None


@dataclass
class NormalizedModelResponse:
    """Provider-neutral response consumed by the runner."""

    text: str | None
    tool_calls: list[dict[str, Any]]
    usage: dict[str, Any]
    model: str
    latency_ms: int
    finish_reason: str | None = None
    refusal: str | None = None
    error: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


# Compatibility for callers that imported the old name.
ModelResponse = NormalizedModelResponse


@dataclass
class DecisionResponse:
    """A Decisions API reply (`ModelClient.decide`): typed answers, no generated text."""

    answers: dict[str, Any]
    usage: dict[str, Any]
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


def backoff_delays(rand: Callable[[], float] = random.random) -> list[float]:
    return [base + rand() for base in (2, 4, 8)]


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _text_of(content: Any) -> str | None:
    if content is None or isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") in ("text", "output_text"):
                parts.append(str(item.get("text") or ""))
        return "".join(parts) or None
    return str(content)


def _normalize_tool_call(call: Any, index: int) -> dict[str, Any]:
    call_id = call.get("id") if isinstance(call, dict) else None
    normalized: dict[str, Any] = {"id": call_id or f"call_{index}"}
    if not isinstance(call, dict) or not isinstance(call.get("function"), dict):
        return {**normalized, "name": None, "arguments": None, "error": "malformed_tool_call"}
    function = call["function"]
    name, arguments = function.get("name"), function.get("arguments")
    normalized.update(name=name, arguments=arguments)
    if name != "python":
        normalized["error"] = "unsupported_tool_call"
        return normalized
    if isinstance(arguments, dict):
        parsed = arguments
    else:
        try:
            parsed = json.loads(arguments)
        except (TypeError, ValueError):
            normalized["error"] = "invalid_tool_arguments"
            return normalized
    if not isinstance(parsed, dict) or not isinstance(parsed.get("code"), str):
        normalized["error"] = "invalid_tool_arguments"
        return normalized
    normalized["code"] = parsed["code"]
    return normalized


def _refusal_of(message: dict[str, Any]) -> str | None:
    refusal = message.get("refusal")
    if isinstance(refusal, str) and refusal.strip():
        return refusal
    if isinstance(refusal, dict):
        return str(refusal.get("reason") or refusal.get("message") or refusal)
    return None


def _response_error(
    *, text: str | None, calls: list[dict[str, Any]], refusal: str | None, finish_reason: str | None
) -> dict[str, Any] | None:
    if refusal:
        return {"code": "model_refusal", "text": refusal}
    if finish_reason in ("content_filter", "safety"):
        return {"code": "model_content_filtered", "text": "provider filtered the response"}
    if finish_reason in ("length", "max_tokens") and not calls:
        return {"code": "model_output_truncated", "text": "model output reached its limit"}
    if finish_reason in ("tool_calls", "function_call") and not calls:
        return {
            "code": "malformed_tool_call",
            "text": "finish reason announced a missing tool call",
        }
    if not (text or "").strip() and not calls:
        return {"code": "empty_model_response", "text": "model returned no text or tool call"}
    return None


def _integer(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def parse_response(body: dict[str, Any], model: str, latency_ms: int) -> NormalizedModelResponse:
    choices = body.get("choices") or []
    if not choices:
        raise ModelError(
            f"no choices in response: {str(body)[:300]}", code="invalid_provider_response"
        )
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message") or {}
    if not isinstance(message, dict):
        raise ModelError("invalid message in provider response", code="invalid_provider_response")
    raw_calls = message.get("tool_calls") or []
    if not isinstance(raw_calls, list):
        raw_calls = [raw_calls]
    if not raw_calls and message.get("function_call"):
        raw_calls = [{"id": "call_0", "function": message["function_call"]}]
    calls = [_normalize_tool_call(call, i) for i, call in enumerate(raw_calls)]
    text = _text_of(message.get("content"))
    finish_reason = choice.get("finish_reason")
    refusal = _refusal_of(message)
    usage = body.get("usage") or {}
    details = usage.get("prompt_tokens_details") or {}
    return NormalizedModelResponse(
        text=text,
        tool_calls=calls,
        usage={
            "prompt_tokens": _integer(usage.get("prompt_tokens")),
            "completion_tokens": _integer(usage.get("completion_tokens")),
            "cached_tokens": _integer(details.get("cached_tokens") or usage.get("cached_tokens")),
            "cost": usage.get("cost") or 0,
        },
        model=body.get("model") or model,
        latency_ms=latency_ms,
        finish_reason=finish_reason,
        refusal=refusal,
        error=_response_error(text=text, calls=calls, refusal=refusal, finish_reason=finish_reason),
        raw=body,
    )


class ModelClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        app_url: str,
        timeout_s: float,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        context_tokens: int | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": app_url,
                "X-Title": "VDaAgent",
            },
            timeout=httpx.Timeout(timeout_s, connect=10),
            transport=transport,
        )
        self._sleep = sleep
        self._override = context_tokens
        self._windows: dict[str, int] = {}
        self._capabilities: dict[str, ModelCapabilities] = {}
        split = urlsplit(base_url)
        self._decisions_url = f"{split.scheme}://{split.netloc}/api/alpha/decisions"

    async def aclose(self) -> None:
        await self._http.aclose()

    async def complete(
        self,
        model: str,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        response_format: dict[str, Any] | None = None,
        agent: str = "",
        purpose: str = "agent",
        extra: dict[str, Any] | None = None,
    ) -> NormalizedModelResponse:
        body: dict[str, Any] = {"model": model, "messages": messages, "usage": {"include": True}}
        body.update(extra or {})
        capabilities = self.capabilities(model)
        if tools and capabilities.supports_tools is not False:
            body["tools"] = tools
            if capabilities.supports_parallel_tools is True:
                body["parallel_tool_calls"] = False
        if response_format:
            body["response_format"] = response_format
        headers = {"X-Contoso-Agent": agent, "X-Contoso-Purpose": purpose}
        return await self._post_with_retries(
            "/chat/completions",
            body,
            headers,
            lambda raw, latency: parse_response(raw, model, latency),
        )

    async def decide(
        self,
        model: str,
        state: str,
        questions: dict[str, Any],
        *,
        agent: str = "",
        purpose: str = "jev",
    ) -> DecisionResponse:
        """OpenRouter's Decisions API: typed answers, no sampling parameters (doc 07 "jev")."""
        body = {"model": model, "state": state, "questions": questions}
        headers = {"X-Contoso-Agent": agent, "X-Contoso-Purpose": purpose}

        def parse(raw: dict[str, Any], _latency_ms: int) -> DecisionResponse:
            return DecisionResponse(
                answers=raw.get("answers") or {}, usage=raw.get("usage") or {}, raw=raw
            )

        return await self._post_with_retries(self._decisions_url, body, headers, parse)

    async def _post_with_retries(
        self,
        url: str,
        body: dict[str, Any],
        headers: dict[str, str],
        parse: Callable[[dict[str, Any], int], Any],
    ) -> Any:
        """Shared retry/backoff loop (3 attempts, 2/4/8s + jitter, `Retry-After` honoured;
        decision 0019) for both `complete()` and `decide()`."""
        delays = backoff_delays()
        last: str = ""
        last_code = "model_unavailable"
        last_status: int | None = None
        for attempt in range(RETRIES + 1):
            started = time.monotonic()
            wait: float | None = None
            try:
                r = await self._http.post(url, json=body, headers=headers)
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last = f"{type(e).__name__}: {e}"
                last_code = (
                    "model_timeout"
                    if isinstance(e, httpx.TimeoutException)
                    else "model_transport_error"
                )
            else:
                if r.status_code == 200:
                    latency = int((time.monotonic() - started) * 1000)
                    try:
                        return parse(r.json(), latency)
                    except ModelError:
                        raise
                    except (TypeError, ValueError, KeyError) as e:
                        raise ModelError(
                            f"invalid provider response: {e}", code="invalid_provider_response"
                        ) from e
                last = f"HTTP {r.status_code}: {_error_text(r)}"
                last_status = r.status_code
                last_code = _http_error_code(r.status_code)
                if r.status_code != 429 and r.status_code < 500:
                    raise ModelError(last, status=r.status_code, code=last_code)
                wait = _retry_after(r)
            if attempt == RETRIES:
                break
            await self._sleep(wait if wait is not None else delays[attempt])
        raise ModelUnavailable(last, status=last_status, code=last_code)

    async def load_windows(self) -> None:
        """Read `context_length` per model from `GET /models`; failures are not fatal."""
        try:
            r = await self._http.get("/models", timeout=15)
            r.raise_for_status()
            for m in r.json().get("data", []):
                if m.get("id") and m.get("context_length"):
                    self._windows[m["id"]] = int(m["context_length"])
                if m.get("id") and isinstance(m.get("supported_parameters"), list):
                    parameters = set(m["supported_parameters"])
                    self._capabilities[m["id"]] = ModelCapabilities(
                        supports_tools=bool(parameters & {"tools", "tool_choice"}),
                        supports_tool_choice="tool_choice" in parameters,
                        supports_json_schema=bool(
                            parameters & {"response_format", "structured_outputs"}
                        ),
                        supports_parallel_tools="parallel_tool_calls" in parameters,
                        supports_streaming="stream" in parameters,
                    )
        except (httpx.HTTPError, ValueError, TypeError):
            pass

    def window(self, model: str) -> int:
        if self._override:
            return self._override
        return self._windows.get(model, DEFAULT_WINDOW)

    def capabilities(self, model: str) -> ModelCapabilities:
        return self._capabilities.get(model, ModelCapabilities())

    def listed(self, model: str) -> bool | None:
        """Whether `GET /models` listed `model`; None when no catalog was loaded."""
        if not self._windows and not self._capabilities:
            return None
        return model in self._windows or model in self._capabilities

    def set_capabilities(self, model: str, capabilities: ModelCapabilities) -> None:
        """Adapter/config hook for providers that do not publish model metadata."""
        self._capabilities[model] = capabilities


def _http_error_code(status: int) -> str:
    return {
        401: "model_authentication_failed",
        403: "model_forbidden",
        429: "model_rate_limited",
    }.get(status, "model_provider_error" if status >= 500 else "model_request_rejected")


def _error_text(r: httpx.Response) -> str:
    try:
        data = r.json()
        err = data.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err)[:500]
        return str(err or data)[:500]
    except ValueError:
        return r.text[:500]


def build_model_client(settings) -> ModelClient:
    """The OpenRouter client, or FakeModel when `MODEL_BACKEND=fake` (doc 17)."""
    transport = None
    if settings.MODEL_BACKEND == "fake":
        from pathlib import Path

        from backend.harness.fake_model import FakeModelTransport, load_scenario

        path = Path(settings.MODEL_SCENARIO)
        if not path.is_absolute():  # relative to the repo root, wherever the process runs
            path = Path(__file__).resolve().parents[2] / path
        transport = FakeModelTransport(load_scenario(path))
    return ModelClient(
        base_url=settings.OPENROUTER_BASE_URL,
        api_key=settings.OPENROUTER_API_KEY.get_secret_value(),
        app_url=settings.APP_URL,
        timeout_s=settings.MODEL_TIMEOUT_S,
        transport=transport,
        context_tokens=settings.MODEL_CONTEXT_TOKENS,
    )
