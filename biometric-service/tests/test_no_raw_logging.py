"""
Master Plan Phase 1 requirement 14: "Logs may contain only safe operational
metadata... Do not log embeddings either."
"""

import io
import logging

from app.logging_utils import logger
from tests.conftest import open_fixture


def _capture_logs(fn):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    logger.addHandler(handler)
    try:
        fn()
    finally:
        logger.removeHandler(handler)
    return stream.getvalue()


def test_represent_request_does_not_log_the_embedding_or_raw_bytes(client):
    with open_fixture("face_a_1.jpg") as f:
        raw_bytes = f.read()

    def do_request():
        client.post("/represent", files={"image": ("f.jpg", raw_bytes, "image/jpeg")})

    log_output = _capture_logs(do_request)

    # The raw JPEG bytes must never appear verbatim in the log stream.
    assert raw_bytes[:200] not in log_output.encode("utf-8", errors="ignore")
    # A representative slice of a real embedding float sequence must not
    # appear either — checked by requesting the embedding via the API
    # response (not the log) and confirming none of its values leak into
    # the log text as a raw list.
    resp = client.post(
        "/represent",
        files={"image": ("f.jpg", raw_bytes, "image/jpeg")},
    )
    embedding = resp.json()["embedding"]
    assert str(embedding) not in log_output


def test_log_event_drops_forbidden_keys_defensively():
    from app.logging_utils import log_event

    log_output = _capture_logs(
        lambda: log_event("test_event", embedding=[1.0, 2.0], image=b"raw", safe_field="ok")
    )
    assert "embedding=" not in log_output
    assert "image=" not in log_output
    assert "safe_field='ok'" in log_output
    assert "_dropped_unsafe_fields" in log_output
