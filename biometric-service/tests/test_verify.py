from tests.conftest import open_fixture


def _represent(client, fixture_name: str) -> list[float]:
    with open_fixture(fixture_name) as f:
        resp = client.post("/represent", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 200
    return resp.json()["embedding"]


def test_verify_same_person_below_threshold(client):
    # face_a_1.jpg / face_a_2.jpg are DeepFace's own official test dataset's
    # img1.jpg/img2.jpg — a documented SAME-person pair in DeepFace's own
    # test suite (tests/unit/test_verify.py).
    emb_a1 = _represent(client, "face_a_1.jpg")
    emb_a2 = _represent(client, "face_a_2.jpg")

    resp = client.post("/verify", json={"embedding_a": emb_a1, "embedding_b": emb_a2})
    assert resp.status_code == 200
    body = resp.json()
    assert body["deepface_verified"] is True
    assert body["distance"] < body["deepface_threshold"]


def test_verify_wrong_person_above_threshold(client):
    # face_a_1.jpg / face_b_1.jpg are DeepFace's own img1.jpg/img3.jpg — a
    # documented DIFFERENT-person pair in DeepFace's own test suite.
    emb_a1 = _represent(client, "face_a_1.jpg")
    emb_b1 = _represent(client, "face_b_1.jpg")

    resp = client.post("/verify", json={"embedding_a": emb_a1, "embedding_b": emb_b1})
    assert resp.status_code == 200
    body = resp.json()
    assert body["deepface_verified"] is False
    assert body["distance"] > body["deepface_threshold"]


def test_verify_rejects_empty_embedding(client):
    resp = client.post("/verify", json={"embedding_a": [], "embedding_b": [0.1, 0.2]})
    assert resp.status_code == 422  # pydantic validation error (min_length=1)
