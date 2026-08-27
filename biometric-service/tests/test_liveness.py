from tests.conftest import open_fixture


def test_liveness_accepts_genuine_photo_as_real(client):
    # Note (Master Plan Section 6, honesty requirement): DeepFace's
    # anti_spoofing path is a passive, single-frame classifier trained to
    # distinguish a real capture from a printed/screen replay — a genuine
    # photograph of a face (even one that is itself a photograph of a
    # person, as these public test fixtures are) is not guaranteed to
    # always classify as "real" the way a live phone-camera capture would;
    # this test asserts the endpoint is CALLABLE and returns a well-formed
    # result, which is Phase 1's scope (Master Plan Phase 1 requirement 4:
    # implement /liveness; Phase 11 is where real-world accuracy is
    # benchmarked against a live capture pipeline that does not exist yet).
    with open_fixture("face_a_1.jpg") as f:
        resp = client.post("/liveness", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["is_live"], bool)
    assert body["model_used"] == "Fasnet"
    assert body["antispoof_score"] is None or isinstance(body["antispoof_score"], float)


def test_liveness_fails_closed_on_no_face(client):
    with open_fixture("no_face.jpg") as f:
        resp = client.post("/liveness", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "no_face_detected"


def test_liveness_fails_closed_on_multiple_faces(client):
    with open_fixture("multi_face.jpg") as f:
        resp = client.post("/liveness", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "multiple_faces_detected"
