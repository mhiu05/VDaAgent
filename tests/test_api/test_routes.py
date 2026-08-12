from uuid import uuid4

import pytest


class _FakeAgent:
    async def ainvoke(self, payload):
        return {"response": f"Reviewed: {payload['query']}", "analysis": ""}


@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_chat_empty_message(client):
    response = await client.post("/api/v1/chat", json={"message": ""})
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_agent_status(client):
    response = await client.get("/api/v1/status")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_chat_history_is_persisted_and_masked(client, monkeypatch):
    monkeypatch.setattr("src.api.routes.agent", _FakeAgent())
    user_id = f"test-{uuid4()}"

    response = await client.post(
        "/api/v1/chat",
        json={"message": "Review john.doe@example.com", "user_id": user_id},
    )

    assert response.status_code == 200
    payload = response.json()
    assert "john.doe@example.com" not in payload["response"]
    history = await client.get(
        f"/api/v1/conversations/{payload['conversation_id']}/messages",
        params={"user_id": user_id},
    )
    assert history.status_code == 200
    messages = history.json()
    assert [message["role"] for message in messages] == ["user", "agent"]
    assert "john.doe@example.com" not in messages[0]["content"]
    assert "jo***@example.com" in messages[0]["content"]


@pytest.mark.asyncio
async def test_conversation_history_checks_user_ownership(client):
    owner_id = f"owner-{uuid4()}"
    response = await client.post(
        "/api/v1/conversations",
        json={"user_id": owner_id, "title": "Owned conversation"},
    )
    conversation_id = response.json()["id"]

    forbidden = await client.get(
        f"/api/v1/conversations/{conversation_id}/messages",
        params={"user_id": "different-user"},
    )
    assert forbidden.status_code == 403
