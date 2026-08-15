"""Notebook LLM API contracts and workspace boundary tests."""

import json

from fastapi.testclient import TestClient


def test_notebook_lifecycle_persists_cells_shares_and_exports(
    client: TestClient, reviewed_profile_run: dict
) -> None:
    created = client.post(
        "/api/v1/notebooks",
        json={
            "profile_run_id": reviewed_profile_run["profile_run_id"],
            "title": "Phân tích notebook QA",
            "description": "Ghi lại các câu hỏi quan trọng.",
        },
    )
    assert created.status_code == 201, created.text
    notebook = created.json()
    assert notebook["visibility"] == "private"
    assert len(notebook["cells"]) == 1
    assert notebook["cells"][0]["source"] == notebook["description"]

    cell = client.post(
        f"/api/v1/notebooks/{notebook['id']}/cells",
        json={"kind": "prompt", "title": "Câu hỏi đầu tiên", "source": "Có rủi ro chất lượng nào?"},
    )
    assert cell.status_code == 201, cell.text
    cell_body = cell.json()

    updated = client.patch(
        f"/api/v1/notebooks/{notebook['id']}/cells/{cell_body['id']}",
        json={"status": "completed", "result": {"answer": "Có một số cảnh báo cần xem xét."}},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["result"]["answer"].startswith("Có")

    shared = client.patch(
        f"/api/v1/notebooks/{notebook['id']}",
        json={"visibility": "workspace"},
    )
    assert shared.status_code == 200, shared.text
    assert shared.json()["visibility"] == "workspace"

    loaded = client.get(f"/api/v1/notebooks/{notebook['id']}")
    assert loaded.status_code == 200, loaded.text
    assert len(loaded.json()["cells"]) == 2

    exported = client.get(f"/api/v1/notebooks/{notebook['id']}/export")
    assert exported.status_code == 200, exported.text
    payload = json.loads(exported.content)
    assert payload["notebook"]["id"] == notebook["id"]
    assert payload["export_policy"] == {
        "raw_dataset": False,
        "raw_rows": False,
        "pii_values": False,
    }
    assert any(
        (item.get("result") or {}).get("answer")
        for item in payload["cells"]
        if item.get("kind") == "prompt"
    )

    archived = client.delete(f"/api/v1/notebooks/{notebook['id']}")
    assert archived.status_code == 200, archived.text
    assert client.get(f"/api/v1/notebooks/{notebook['id']}").status_code == 404

    archived_items = client.get("/api/v1/notebooks?status=archived")
    assert archived_items.status_code == 200, archived_items.text
    assert any(item["id"] == notebook["id"] for item in archived_items.json())

    restored = client.patch(f"/api/v1/notebooks/{notebook['id']}", json={"status": "active"})
    assert restored.status_code == 200, restored.text
    assert restored.json()["id"] == notebook["id"]
    assert restored.json()["status"] == "active"
    assert client.get(f"/api/v1/notebooks/{notebook['id']}").status_code == 200
