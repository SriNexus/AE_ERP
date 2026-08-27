def test_readiness_reports_models_loaded_and_trivial_inference(client):
    # Master Plan Section 13: "/readiness ... confirms models are actually
    # loaded and a trivial inference call succeeds, not just that the
    # process is up." This hits the REAL provider (models were warmed up by
    # the session-scoped TestClient's lifespan) — not mocked.
    resp = client.get("/readiness")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ready"] is True
    assert body["recognition_model"]
    assert body["detector_backend"]
    assert body["deepface_version"]
    assert isinstance(body["trivial_inference_ms"], (int, float))
    assert body["trivial_inference_ms"] >= 0


def test_readiness_does_not_require_auth(client):
    resp = client.get("/readiness", headers={})
    assert resp.status_code == 200
