def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_health_does_not_require_auth(client):
    # /health is process-liveness only (Master Plan Section 13) — an
    # infra-level health check must not depend on the service credential.
    resp = client.get("/health", headers={})
    assert resp.status_code == 200
