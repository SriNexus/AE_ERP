from tests.conftest import open_fixture


def test_malformed_bytes_rejected_before_model_call(client):
    with open_fixture("malformed.jpg") as f:
        resp = client.post("/detect", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "malformed_image"


def test_zero_byte_file_rejected(client):
    with open_fixture("zero_byte.jpg") as f:
        resp = client.post("/detect", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 400
    body = resp.json()
    assert body["error_code"] in ("malformed_image", "invalid_request")


def test_malformed_bytes_never_reach_deepface_for_every_endpoint(client):
    # All four image-accepting endpoints must reject at the same choke point
    # (provider.decode_image), before any DeepFace/TensorFlow call.
    for endpoint in ("/detect", "/quality", "/liveness", "/represent"):
        with open_fixture("malformed.jpg") as f:
            resp = client.post(endpoint, files={"image": ("f.jpg", f.read(), "image/jpeg")})
        assert resp.status_code == 400, endpoint
        assert resp.json()["error_code"] == "malformed_image", endpoint


def test_error_response_never_contains_a_python_traceback(client):
    with open_fixture("malformed.jpg") as f:
        resp = client.post("/detect", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    body = resp.text
    assert "Traceback" not in body
    assert "site-packages" not in body
    assert ".venv" not in body
    assert "File \"" not in body
