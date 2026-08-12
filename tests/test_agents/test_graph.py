import pytest
from langchain_core.messages import AIMessage

from src.agents.graph import agent


class _FakeLlm:
    async def ainvoke(self, messages):
        return AIMessage(content="Mock profiling answer")


@pytest.mark.asyncio
async def test_agent_basic_flow(monkeypatch):
    monkeypatch.setattr("src.agents.nodes.example_node.get_llm", lambda: _FakeLlm())
    result = await agent.ainvoke({"query": "Hello"})
    assert result["response"] == "Mock profiling answer"


@pytest.mark.asyncio
async def test_agent_state_structure(monkeypatch):
    monkeypatch.setattr("src.agents.nodes.example_node.get_llm", lambda: _FakeLlm())
    result = await agent.ainvoke({"query": "Test query"})
    assert isinstance(result, dict)
    assert "query" in result
