from __future__ import annotations

from typing import Any
from uuid import uuid4

from src.agents.runtime.context import ExecutionContext
from src.agents.runtime.langsmith_observability import LangSmithObservability
from src.config import Settings


class FakeLangSmithClient:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self.updated: list[dict[str, Any]] = []

    def create_run(
        self, name: str, inputs: dict[str, Any], run_type: str, **kwargs: Any
    ) -> None:
        self.created.append(
            {"name": name, "inputs": inputs, "run_type": run_type, **kwargs}
        )

    def update_run(self, run_id: Any, **kwargs: Any) -> None:
        self.updated.append({"run_id": run_id, **kwargs})

    def flush(self, timeout: float | None = None) -> None:
        return None


def _settings() -> Settings:
    return Settings(
        database_url="postgresql+psycopg://user:password@localhost/test",
        app_env="development",
        langsmith_tracing=True,
        langsmith_api_key="test-key",
        langsmith_project="p170-test",
    )


def test_langsmith_payload_is_allow_listed_and_correlated() -> None:
    client = FakeLangSmithClient()
    observability = LangSmithObservability(_settings(), client)
    agent_run_id = uuid4().hex
    canary = "PII-CANARY-person@example.com-C:/tenant/raw.csv"
    observability.start_agent_run(
        agent_run_id=agent_run_id,
        workspace_id="workspace-secret",
        run_type="qa",
        version_snapshot={"model": {"provider": "openai", "model_id": "gpt-test"}},
    )
    context = ExecutionContext(
        agent_run_id=agent_run_id,
        workspace_id="workspace-secret",
        actor_user_id="user-secret",
    )
    with observability.span(
        context,
        name="model.qa",
        run_type="llm",
        metadata={"prompt": canary, "content": canary, "model_id": "gpt-test"},
    ):
        pass
    observability.finish_agent_run(
        agent_run_id=agent_run_id, workspace_id="workspace-secret", status="completed"
    )

    serialized = repr([*client.created, *client.updated])
    assert canary not in serialized
    assert "workspace-secret" not in serialized
    assert "user-secret" not in serialized
    assert client.created[0]["id"].hex == agent_run_id
    assert client.created[1]["parent_run_id"] == client.created[0]["id"]
    assert client.created[1]["inputs"] == {}
    assert client.updated[-1]["outputs"] == {}


def test_langsmith_failure_is_fail_open() -> None:
    class FailingClient(FakeLangSmithClient):
        def create_run(self, *args: Any, **kwargs: Any) -> None:
            raise RuntimeError("unavailable")

    observability = LangSmithObservability(_settings(), FailingClient())
    observability.start_agent_run(
        agent_run_id=uuid4().hex,
        workspace_id="workspace",
        run_type="qa",
        version_snapshot={},
    )
