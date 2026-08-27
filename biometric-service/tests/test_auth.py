"""
Service-to-service authentication (Master Plan Phase 1 requirement 13).

Uses a SEPARATE, non-session-scoped app instance with auth explicitly
enabled, because the shared `client` fixture disables auth for test
convenience (see conftest.py). Reuses the same warmed-up provider module
state (models are process-global singletons in DeepFace, so no re-warm-up
cost is paid here).
"""

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def authed_client():
    old_token = os.environ.get("DEEPFACE_SERVICE_AUTH_TOKEN")
    old_disabled = os.environ.get("DEEPFACE_AUTH_DISABLED_FOR_LOCAL_DEV")
    os.environ["DEEPFACE_SERVICE_AUTH_TOKEN"] = "test-shared-secret"
    os.environ["DEEPFACE_AUTH_DISABLED_FOR_LOCAL_DEV"] = "false"

    # Re-import config/app with the new environment so app.config.settings
    # picks up the auth token (module-level settings singleton).
    import importlib

    import app.config as config_module
    importlib.reload(config_module)
    import app.auth as auth_module
    importlib.reload(auth_module)
    import app.main as main_module
    importlib.reload(main_module)

    with TestClient(main_module.app) as c:
        yield c

    if old_token is not None:
        os.environ["DEEPFACE_SERVICE_AUTH_TOKEN"] = old_token
    else:
        os.environ.pop("DEEPFACE_SERVICE_AUTH_TOKEN", None)
    if old_disabled is not None:
        os.environ["DEEPFACE_AUTH_DISABLED_FOR_LOCAL_DEV"] = old_disabled
    else:
        os.environ.pop("DEEPFACE_AUTH_DISABLED_FOR_LOCAL_DEV", None)
    importlib.reload(config_module)
    importlib.reload(auth_module)
    importlib.reload(main_module)


def test_detect_rejects_missing_credentials(authed_client, tmp_path):
    resp = authed_client.post("/detect", files={"image": ("f.jpg", b"not-a-real-image", "image/jpeg")})
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "unauthenticated"


def test_detect_rejects_wrong_credentials(authed_client):
    resp = authed_client.post(
        "/detect",
        files={"image": ("f.jpg", b"not-a-real-image", "image/jpeg")},
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "unauthenticated"


def test_detect_accepts_correct_credentials(authed_client):
    with open(os.path.join(os.path.dirname(__file__), "fixtures", "no_face.jpg"), "rb") as f:
        resp = authed_client.post(
            "/detect",
            files={"image": ("f.jpg", f.read(), "image/jpeg")},
            headers={"Authorization": "Bearer test-shared-secret"},
        )
    # Correct credentials pass the auth gate; a real (empty) detection
    # result follows, not an auth error.
    assert resp.status_code == 200
    assert resp.json()["face_count"] == 0
