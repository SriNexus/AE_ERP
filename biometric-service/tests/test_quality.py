from tests.conftest import open_fixture


def test_quality_passes_on_good_single_face(client):
    with open_fixture("face_a_1.jpg") as f:
        resp = client.post("/quality", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 200
    body = resp.json()
    assert body["passed"] is True
    assert body["reasons"] == []


def test_quality_fails_closed_on_no_face(client):
    with open_fixture("no_face.jpg") as f:
        resp = client.post("/quality", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "no_face_detected"


def test_quality_fails_closed_on_multiple_faces(client):
    with open_fixture("multi_face.jpg") as f:
        resp = client.post("/quality", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "multiple_faces_detected"
