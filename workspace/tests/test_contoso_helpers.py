"""The `contoso` helper library (doc 11 "Helper library `contoso`", doc 08)."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class FakeApi:
    """A tiny internal API: records requests and answers from a queue of responses."""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.responses: list[tuple[int, dict | None]] = []
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                api.requests.append(
                    {
                        "path": self.path,
                        "auth": self.headers.get("Authorization"),
                        "content_type": self.headers.get("Content-Type"),
                        "body": json.loads(body) if body else None,
                    }
                )
                status, payload = api.responses.pop(0) if api.responses else (200, {})
                data = b"" if payload is None else json.dumps(payload).encode()
                self.send_response(status)
                if data:
                    self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def reply(self, status: int, payload: dict | None) -> None:
        self.responses.append((status, payload))


@pytest.fixture
def api(monkeypatch):
    a = FakeApi()
    monkeypatch.setenv("CONTOSO_API_URL", a.url)
    monkeypatch.setenv("CONTOSO_EXEC_TOKEN", "v1.tok")
    monkeypatch.delenv("CONTOSO_DEFAULT_THREAD", raising=False)
    yield a
    a.server.shutdown()


def test_send_to_user_posts_with_the_exec_token(api, monkeypatch):
    import contoso

    monkeypatch.setenv("CONTOSO_DEFAULT_THREAD", "direct:data")
    api.reply(200, {"message_id": "m_1"})
    assert contoso.send_to_user("Kết quả", files=("files/chart.png",), final=True) == "m_1"
    req = api.requests[0]
    assert req["path"] == "/internal/v1/send_to_user"
    assert req["auth"] == "Bearer v1.tok"
    assert req["content_type"] == "application/json"
    assert req["body"] == {
        "text": "Kết quả",
        "files": ["files/chart.png"],
        "choices": None,
        "reports": [],
        "thread": "direct:data",
        "reply_to": None,
        "final": True,
    }


def test_send_to_user_explicit_thread_wins(api, monkeypatch):
    import contoso

    monkeypatch.setenv("CONTOSO_DEFAULT_THREAD", "direct:data")
    api.reply(200, {"message_id": "m_2"})
    contoso.send_to_user(
        "x", thread="t_9", choices=[{"id": "pdf", "label": "PDF"}], reports=["R7-v1"]
    )
    body = api.requests[0]["body"]
    assert body["thread"] == "t_9"
    assert body["choices"] == [{"id": "pdf", "label": "PDF"}]
    assert body["reports"] == ["R7-v1"]


def test_send_to_agent(api):
    import contoso

    api.reply(200, {"message_id": "m_3"})
    assert contoso.send_to_agent(["lead"], "Xong", files=["files/u.csv"]) == "m_3"
    assert api.requests[0]["path"] == "/internal/v1/send_to_agent"
    assert api.requests[0]["body"] == {
        "receivers": ["lead"],
        "content": "Xong",
        "files": ["files/u.csv"],
        "thread": None,
        "reply_to": None,
    }


def test_send_to_agent_has_no_default_thread(api, monkeypatch):
    import contoso

    monkeypatch.setenv("CONTOSO_DEFAULT_THREAD", "direct:data")
    api.reply(200, {"message_id": "m_4"})
    contoso.send_to_agent(("data",), "hi")
    assert api.requests[0]["body"]["thread"] is None


def test_task_and_summary_helpers(api):
    import contoso

    api.reply(200, {"task_id": 42})
    assert contoso.end_task("đã trả lời") == 42
    api.reply(200, {"task_id": 43})
    assert contoso.queue_task("Báo cáo tuần") == 43
    api.reply(204, None)
    assert contoso.write_summary("tóm tắt") is None
    assert [r["path"] for r in api.requests] == [
        "/internal/v1/end_task",
        "/internal/v1/queue_task",
        "/internal/v1/write_summary",
    ]
    assert api.requests[0]["body"] == {"outcome": "đã trả lời", "status": "done"}
    assert api.requests[1]["body"] == {"description": "Báo cáo tuần"}
    assert api.requests[2]["body"] == {"text": "tóm tắt"}


def test_report_and_dataset_helpers(api):
    import contoso

    api.reply(200, {"report_id": "R7", "attempt_id": "a_1"})
    assert contoso.start_report("Q3", "unit_analysis", projects=["MAS"]) == {
        "report_id": "R7",
        "attempt_id": "a_1",
    }
    api.reply(200, {"version_id": "R7-v1"})
    assert (
        contoso.publish_report("a_1", "outputs/report.json", artifacts=["files/r.pdf"]) == "R7-v1"
    )
    api.reply(204, None)
    assert contoso.fail_report("a_1", "no data") is None
    api.reply(200, {"dataset_id": "d_1"})
    assert contoso.publish_dataset("dashboard", "outputs/ds.json") == "d_1"
    paths = [r["path"] for r in api.requests]
    assert paths == [
        "/internal/v1/reports/start",
        "/internal/v1/reports/publish",
        "/internal/v1/reports/fail",
        "/internal/v1/datasets/publish",
    ]
    assert api.requests[0]["body"] == {
        "title": "Q3",
        "type": "unit_analysis",
        "projects": ["MAS"],
        "markets": [],
        "report_id": None,
    }
    assert api.requests[1]["body"] == {
        "attempt_id": "a_1",
        "schema_path": "outputs/report.json",
        "artifacts": ["files/r.pdf"],
        "evidence": [],
        "source": None,
    }
    assert api.requests[3]["body"] == {"kind": "dashboard", "path": "outputs/ds.json"}


def test_errors_raise_contoso_error_with_code_and_message(api):
    import contoso

    api.reply(400, {"error": "invalid_thread", "message": "agent threads can't reach the user"})
    with pytest.raises(contoso.ContosoError) as e:
        contoso.send_to_user("x", thread="t_1")
    assert e.value.code == "invalid_thread"
    assert e.value.message == "agent threads can't reach the user"
    assert isinstance(e.value, ValueError)  # doc 08: bad arguments raise ValueError
    assert "invalid_thread" in str(e.value)


def test_conflict_errors_are_runtime_errors(api):
    import contoso

    api.reply(409, {"error": "compacting", "message": "messaging is disabled during compaction"})
    with pytest.raises(RuntimeError) as e:
        contoso.send_to_agent(["lead"], "x")
    assert isinstance(e.value, contoso.ContosoError)
    assert str(e.value).endswith("messaging is disabled during compaction")


def test_non_json_error_body(api):
    import contoso

    api.responses.append((500, None))
    with pytest.raises(contoso.ContosoError) as e:
        contoso.queue_task("x")
    assert e.value.code == "http_500"


def test_missing_environment_raises(monkeypatch):
    import contoso

    monkeypatch.delenv("CONTOSO_API_URL", raising=False)
    monkeypatch.delenv("CONTOSO_EXEC_TOKEN", raising=False)
    with pytest.raises(contoso.ContosoError) as e:
        contoso.queue_task("x")
    assert e.value.code == "not_in_exec"


def test_contoso_uses_only_the_standard_library():
    import ast
    import sys
    from pathlib import Path

    import contoso

    pkg = Path(contoso.__file__).parent
    for f in pkg.glob("*.py"):
        for node in ast.walk(ast.parse(f.read_text())):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                names = [node.module]
            for n in names:
                top = n.split(".")[0]
                assert top == "contoso" or top in sys.stdlib_module_names, f"{f.name}: {n}"
