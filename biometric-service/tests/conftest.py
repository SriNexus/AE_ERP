"""
Shared pytest fixtures.

Test images under tests/fixtures/ are either:
  - copied directly from DeepFace's own public GitHub test dataset
    (tests/unit/dataset/img1.jpg, img2.jpg, img3.jpg, couple.jpg — used by
    DeepFace's own official test suite for these exact same-person/
    different-person/multiple-face scenarios), or
  - generated synthetically in-repo (no_face.jpg: deterministic random
    noise; malformed.jpg: non-image bytes; zero_byte.jpg: empty file).
No real Neozy employee/customer biometric data is used anywhere in this
test suite (Master Plan Phase 1 requirement 10/15).
"""

import os

import pytest
from fastapi.testclient import TestClient

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

# Auth is disabled for the whole test session by default (deterministic,
# no dependency on a secret being set) EXCEPT test_auth.py, which explicitly
# re-configures it to prove the auth gate actually works.
os.environ.setdefault("DEEPFACE_AUTH_DISABLED_FOR_LOCAL_DEV", "true")
os.environ.setdefault("PYTHONUTF8", "1")


def fixture_path(name: str) -> str:
    return os.path.join(FIXTURES_DIR, name)


@pytest.fixture(scope="session")
def client():
    # Session-scoped: the FastAPI lifespan's warm_up_models() call is
    # expensive (loads TensorFlow/PyTorch models) — running it once for the
    # whole test session, not per-test, is required for a reasonable test
    # suite runtime (consistent with Master Plan Phase 1 requirement 9:
    # models load once, are reused).
    from app.main import app

    with TestClient(app) as c:
        yield c


def open_fixture(name: str):
    return open(fixture_path(name), "rb")
