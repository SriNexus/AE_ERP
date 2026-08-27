from tests.conftest import open_fixture


def test_represent_returns_embedding(client):
    with open_fixture("face_a_1.jpg") as f:
        resp = client.post("/represent", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 200
    body = resp.json()
    assert body["embedding_dim"] > 0
    assert len(body["embedding"]) == body["embedding_dim"]
    assert all(isinstance(v, float) for v in body["embedding"])
    assert body["model_name"]
    assert body["deepface_version"]


def test_represent_fails_closed_on_no_face(client):
    with open_fixture("no_face.jpg") as f:
        resp = client.post("/represent", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "no_face_detected"


def test_represent_fails_closed_on_multiple_faces(client):
    with open_fixture("multi_face.jpg") as f:
        resp = client.post("/represent", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "multiple_faces_detected"
