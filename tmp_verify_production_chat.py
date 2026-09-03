from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

import requests

API = "https://vdaagent-api.azurewebsites.net/api/v1"
WORKSPACE = "d50e550f-b224-46e3-bd68-b60660cbc929"


def env(name: str) -> str:
    for line in Path(".env").read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise KeyError(name)


def parse_sse(raw: str) -> list[tuple[str, dict]]:
    events, event, data = [], "message", []
    for line in raw.splitlines() + [""]:
        if not line and data:
            events.append((event, json.loads("\n".join(data))))
            event, data = "message", []
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
    return events


auth = requests.post(
    f"{env('SUPABASE_URL')}/auth/v1/token?grant_type=password",
    headers={"apikey": env("SUPABASE_PUBLISHABLE_KEY")},
    json={"email": os.environ["VDA_DIAG_EMAIL"], "password": os.environ["VDA_DIAG_PASSWORD"]},
    timeout=60,
)
auth.raise_for_status()
headers = {"Authorization": f"Bearer {auth.json()['access_token']}", "X-Workspace-Id": WORKSPACE}

datasets = requests.get(f"{API}/datasets", headers=headers, timeout=60).json()
dataset = next(item for item in datasets if item["name"] == "doanh_thu_thang_1_1000")
run_id = None
for _ in range(40):
    runs = requests.get(f"{API}/datasets/{dataset['id']}/runs", headers=headers, timeout=60)
    runs.raise_for_status()
    current = runs.json()
    completed = [item for item in current if item.get("status") == "completed"]
    if completed:
        run_id = completed[0]["id"]
        break
    print(json.dumps({"profile_status": current[0].get("status") if current else None}, ensure_ascii=False))
    time.sleep(15)
assert run_id, current

suggestions = requests.get(f"{API}/profile/{run_id}/chat-suggestions", headers=headers, timeout=120)
suggestions.raise_for_status()
questions = [item["question"] for item in suggestions.json()]
assert any("phân phối" in question.casefold() and "Quantity" in question for question in questions), questions

started = time.perf_counter()
response = requests.post(
    f"{API}/qa/stream",
    headers=headers,
    json={
        "question": "Show the distribution of Quantity.",
        "profile_run_id": run_id,
        "request_id": f"verify-{uuid.uuid4().hex}",
        "persist_user_message": False,
    },
    timeout=120,
)
response.raise_for_status()
stream = parse_sse(response.text)
errors = [payload for event, payload in stream if event == "error"]
answer = "".join(str(payload.get("text") or "") for event, payload in stream if event == "token")
done = next((payload for event, payload in stream if event == "done"), None)
assert not errors, errors
assert done is not None, stream
assert "Phân phối đã lưu" in answer, answer

agent_id = done["agent_run_id"]
run = requests.get(f"{API}/agent-runs/{agent_id}", headers=headers, timeout=60)
trace = requests.get(f"{API}/agent-runs/{agent_id}/trace", headers=headers, timeout=60)
run.raise_for_status()
trace.raise_for_status()
print(json.dumps({
    "profile_run_id": run_id,
    "suggestions": questions,
    "elapsed_ms": round((time.perf_counter() - started) * 1000),
    "answer": answer,
    "question_type": done.get("question_type"),
    "status": run.json().get("status"),
    "trace_events": len(trace.json()),
}, ensure_ascii=False))
