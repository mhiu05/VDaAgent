"""The narrative override must not alter other agents or reuse Gemini credentials."""
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from src.agents.nodes import profiling_nodes
from src.agents.runtime import trace
from src.agents.runtime.context import ExecutionContext
from src.config import Settings
from src.services import llm


@pytest.fixture(autouse=True)
def clear_summary_client():
    llm.get_profile_summary_llm.cache_clear()
    yield
    llm.get_profile_summary_llm.cache_clear()


def settings(**overrides):
    return Settings(_env_file=None, **{
        "llm_provider": "gemini", "llm_model": "gemini-3.6-flash",
        "llm_api_key": "gemini-test-key", "openai_api_key": "openai-test-key",
        "profile_summary_provider": "openai", **overrides,
    })


def test_summary_uses_its_own_openai_key_model_and_endpoint(monkeypatch):
    cfg = settings(llm_base_url="https://main-provider.invalid/v1")
    monkeypatch.setattr(llm, "get_settings", lambda: cfg)
    constructor = Mock()
    monkeypatch.setattr(llm, "ChatOpenAI", constructor)
    main = Mock(side_effect=AssertionError("summary must not call Gemini"))
    monkeypatch.setattr(llm, "get_llm", main)

    assert llm.get_profile_summary_llm() is constructor.return_value
    assert llm.get_profile_summary_llm() is constructor.return_value
    constructor.assert_called_once()
    options = constructor.call_args.kwargs
    assert options["api_key"] == "openai-test-key"
    assert options["model"] == "gpt-4o-mini"
    assert options["base_url"] == "https://api.openai.com/v1"
    assert cfg.llm_provider == "gemini"
    assert cfg.llm_api_key == "gemini-test-key"
    main.assert_not_called()


def test_default_summary_keeps_main_provider(monkeypatch):
    monkeypatch.setattr(llm, "get_settings", lambda: settings(profile_summary_provider="default"))
    main = Mock()
    monkeypatch.setattr(llm, "get_llm", main)
    assert llm.get_profile_summary_llm() is main.return_value
    main.assert_called_once_with()


def test_summary_does_not_send_gemini_key_to_openai(monkeypatch):
    monkeypatch.setattr(llm, "get_settings", lambda: settings(openai_api_key=""))
    constructor = Mock()
    monkeypatch.setattr(llm, "ChatOpenAI", constructor)
    with pytest.raises(llm.LLMNotConfiguredError) as error:
        llm.get_profile_summary_llm()
    assert error.value.key_env == "OPENAI_API_KEY"
    constructor.assert_not_called()


@pytest.mark.parametrize("failure", [False, True])
def test_summary_node_uses_override_and_preserves_metrics_on_failure(monkeypatch, failure):
    monkeypatch.setattr(profiling_nodes, "get_settings", lambda: settings())
    monkeypatch.setattr(profiling_nodes, "get_repository", Mock())
    client = Mock()
    monkeypatch.setattr(profiling_nodes, "get_profile_summary_llm", lambda: client)
    invoke = Mock(return_value=SimpleNamespace(content="# Report\n\nEvidence summary"))
    if failure:
        invoke.side_effect = RuntimeError("401 provider payload must not leak")
    monkeypatch.setattr(profiling_nodes, "invoke_model", invoke)
    state = {"dataset_name": "synthetic", "row_count": 3, "column_names": ["amount"],
             "scan_mode": "full", "stats_json": {"amount": {"dtype": "int", "null_pct": 0}},
             "risk_warnings": [llm.LLM_RUNTIME_NOTICE]}
    result = profiling_nodes.summarize_node(state)
    assert invoke.call_args.args[0] is client
    assert invoke.call_args.kwargs == {"prompt_id": "profile_summary", "provider": "openai", "model_id": "gpt-4o-mini"}
    assert state["row_count"] == 3
    if failure:
        assert "| amount | int | 0 |" in result["narrative_report"]
        assert "provider payload" not in str(result)
    else:
        assert result["narrative_report"] == "# Report\n\nEvidence summary"
        assert llm.LLM_RUNTIME_NOTICE not in result["risk_warnings"]


@pytest.mark.parametrize("failure", [False, True])
@pytest.mark.parametrize("override", [False, True])
def test_trace_records_actual_summary_provider_on_success_and_failure(monkeypatch, failure, override):
    monkeypatch.setattr(trace, "get_settings", lambda: settings())
    monkeypatch.setattr(trace, "trace_enabled", lambda: True)
    monkeypatch.setattr(trace, "get_execution_context", lambda: ExecutionContext("run", "workspace", "actor"))
    repo = Mock()
    monkeypatch.setattr(trace, "get_repository", lambda: repo)
    span = Mock(side_effect=lambda *a, **kw: nullcontext(None))
    monkeypatch.setattr(trace, "get_langsmith_observability", lambda: SimpleNamespace(span=span))
    model = Mock()
    model.invoke.return_value = SimpleNamespace(content="ok", usage_metadata={})
    if failure:
        model.invoke.side_effect = RuntimeError("synthetic failure")
    kwargs = {"provider": "openai", "model_id": "gpt-4o-mini"} if override else {}
    if failure:
        with pytest.raises(RuntimeError, match="synthetic failure"):
            trace.invoke_model(model, [], prompt_id="profile_summary", **kwargs)
    else:
        trace.invoke_model(model, [], prompt_id="profile_summary", **kwargs)
    actual_provider, actual_model = ("openai", "gpt-4o-mini") if override else ("gemini", "gemini-3.6-flash")
    record = repo.record_model_invocation.call_args.args[0]
    assert (record["provider"], record["model_id"]) == (actual_provider, actual_model)
    assert record["status"] == ("failed" if failure else "completed")
    metadata = span.call_args.kwargs["metadata"]
    assert (metadata["provider"], metadata["model_id"]) == (actual_provider, actual_model)
