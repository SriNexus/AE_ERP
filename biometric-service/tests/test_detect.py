from tests.conftest import open_fixture


def test_detect_single_face(client):
    with open_fixture("face_a_1.jpg") as f:
        resp = client.post("/detect", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 200
    body = resp.json()
    assert body["face_count"] == 1
    assert len(body["faces"]) == 1
    assert body["faces"][0]["confidence"] > 0


def test_detect_no_face_returns_zero_not_an_error(client):
    # /detect (unlike /quality, /liveness, /represent) returns whatever was
    # found, including zero — Master Plan Section 10: detect.ts "fails
    # closed on 0 or >1 faces" describes the PIPELINE stage used by
    # quality/liveness/represent, not the raw /detect endpoint itself, which
    # is meant to let a caller inspect what's in a frame directly.
    with open_fixture("no_face.jpg") as f:
        resp = client.post("/detect", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 200
    assert resp.json()["face_count"] == 0


def test_detect_multiple_faces(client):
    with open_fixture("multi_face.jpg") as f:
        resp = client.post("/detect", files={"image": ("f.jpg", f.read(), "image/jpeg")})
    assert resp.status_code == 200
    assert resp.json()["face_count"] >= 2
