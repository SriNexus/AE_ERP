"""
Safe, structured operational logging.

Per the Face Attendance + DeepFace Master Plan Phase 1 requirement 14:
"Logs may contain only safe operational metadata such as request id,
duration, endpoint, model/version and result/error code. Do not log
embeddings either." This module is the ONLY place in the service that writes
log lines, so that constraint is enforced in one place, not by convention
scattered across every endpoint.
"""

import logging
import sys
import time
import uuid
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger("biometric_service")
logger.setLevel(logging.INFO)
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(logging.Formatter("%(message)s"))
if not logger.handlers:
    logger.addHandler(_handler)


# Fields that are NEVER permitted in a log payload, checked defensively at
# the single log emission point (belt-and-braces on top of every call site
# being reviewed to never pass them).
_FORBIDDEN_LOG_KEYS = {"image", "image_bytes", "frame", "embedding", "raw", "img_path", "img"}


def new_request_id() -> str:
    return uuid.uuid4().hex


def log_event(event: str, **fields: Any) -> None:
    safe_fields = {k: v for k, v in fields.items() if k not in _FORBIDDEN_LOG_KEYS}
    dropped = set(fields.keys()) - set(safe_fields.keys())
    if dropped:
        # A forbidden key was passed by a caller — this is itself a bug worth
        # surfacing loudly (in the safe log stream, not by leaking the value).
        safe_fields["_dropped_unsafe_fields"] = sorted(dropped)
    parts = [f"event={event}"]
    for key in sorted(safe_fields.keys()):
        parts.append(f"{key}={safe_fields[key]!r}")
    logger.info(" ".join(parts))


@contextmanager
def timed_request(endpoint: str, request_id: str | None = None):
    rid = request_id or new_request_id()
    start = time.monotonic()
    outcome = {"result": "error", "error_code": None}
    try:
        yield rid, outcome
        if outcome["result"] == "error" and outcome["error_code"] is None:
            outcome["result"] = "success"
    except Exception as exc:
        # Catches ANY exception raised inside the block (including one
        # raised before an endpoint's own local try/except runs, e.g.
        # provider.decode_image()'s malformed_image()) so the completion
        # log line always carries the real error_code, not a generic
        # "error, code=None" — the exception is always re-raised unchanged
        # so FastAPI's global exception handlers still produce the HTTP
        # response; this block only affects logging.
        code = getattr(exc, "code", None)
        if code is not None and outcome["error_code"] is None:
            outcome["error_code"] = getattr(code, "value", str(code))
        raise
    finally:
        duration_ms = round((time.monotonic() - start) * 1000, 2)
        log_event(
            "request_completed",
            request_id=rid,
            endpoint=endpoint,
            duration_ms=duration_ms,
            result=outcome["result"],
            error_code=outcome["error_code"],
        )
