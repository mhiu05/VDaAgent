from execd.app import app
from fastapi.testclient import TestClient


def test_health_needs_no_token():
    with TestClient(app) as client:
        r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["fs_isolation"] in ("landlock", "unavailable", "off")
