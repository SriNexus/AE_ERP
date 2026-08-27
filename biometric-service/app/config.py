"""
Environment-driven configuration.

Per the Face Attendance + DeepFace Master Plan Section 19 ("Provider/Config
Model — environment-driven, not hardcoded") and Phase 1 requirement 5:
"Model/detector/liveness configuration MUST be environment-driven, never
hardcoded." Nothing in this module (or anywhere else in this service) is
allowed to hardcode a model/detector name outside of these defaults, which
exist only as the fallback when the environment variable is unset.

This service has NO knowledge of Neozy identity/tenant/company/group fields
(Master Plan Section 8) — this file intentionally contains no such config.
"""

import os
from dataclasses import dataclass


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _optional_float_env(name: str) -> float | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


@dataclass(frozen=True)
class Settings:
    # Recognition/detector/liveness selection — initial defaults per Master
    # Plan Section 6, explicitly NOT locked as final; Phase 1's benchmark
    # (scripts/benchmark.py) is what determines whether these remain the
    # production choice.
    recognition_model: str
    detector_backend: str
    anti_spoofing_enabled: bool

    # Optional override for the verification threshold. Per Master Plan
    # Section 6/Phase 1 task 12: Phase 1 must NOT invent or lock the final
    # Neozy security threshold — when unset, the service reports DeepFace's
    # own model-specific threshold and lets the caller decide. This override
    # exists only so a later phase (Phase 11's real benchmark) can tighten it
    # via config, never via a code change.
    verify_threshold_override: float | None

    # Service-to-service authentication (Master Plan Section 13). A shared
    # bearer token is the Phase 1 fallback mechanism when no private network
    # path exists yet — see Phase 1's "Security requirements" note that the
    # final mechanism is an infra decision made later. When unset, the
    # service refuses to start in a way that could be mistaken for
    # "no auth required" (see main.py's startup check) EXCEPT in explicit
    # local/test mode.
    service_auth_token: str | None
    auth_disabled_for_local_dev: bool

    # Internal soft timeout applied around each inference call, so a hung
    # model call cannot block a worker indefinitely. Initial default is a
    # deliberately generous placeholder — Phase 11's real benchmark tunes
    # this from measured evidence (Master Plan Section 13).
    inference_timeout_seconds: float

    # Quality-gate thresholds (Detect->Quality stage). These are heuristic
    # v1 values (image resolution / face-region size ratio), NOT modeled on
    # any published benchmark — Phase 1 records this honestly rather than
    # implying a false precision. Environment-overridable per requirement 5.
    min_face_size_px: int
    min_quality_confidence: float

    weights_dir: str


def load_settings() -> Settings:
    return Settings(
        recognition_model=os.environ.get("DEEPFACE_RECOGNITION_MODEL", "ArcFace"),
        # Phase 1 benchmark evidence (scripts/benchmark.py, real measured
        # results): retinaface detection cost 30-32s/call in this
        # environment vs. yunet's 0.2-0.3s/call — a >100x difference that
        # held end-to-end (liveness/represent/verify), while both correctly
        # handled the same no-face/multi-face fixtures. mediapipe currently
        # fails to load at all with the installed mediapipe==1.0.1
        # ("module 'mediapipe' has no attribute 'solutions'" — a real
        # dependency-version incompatibility, not a config error). See the
        # master plan's Phase 1 record for full numbers before assuming
        # this default is universally correct on different hardware.
        detector_backend=os.environ.get("DEEPFACE_DETECTOR_BACKEND", "yunet"),
        anti_spoofing_enabled=_bool_env("DEEPFACE_ANTI_SPOOFING_ENABLED", True),
        verify_threshold_override=_optional_float_env("DEEPFACE_VERIFY_THRESHOLD"),
        service_auth_token=os.environ.get("DEEPFACE_SERVICE_AUTH_TOKEN") or None,
        auth_disabled_for_local_dev=_bool_env("DEEPFACE_AUTH_DISABLED_FOR_LOCAL_DEV", False),
        inference_timeout_seconds=_float_env("DEEPFACE_INFERENCE_TIMEOUT_SECONDS", 30.0),
        min_face_size_px=_int_env("DEEPFACE_MIN_FACE_SIZE_PX", 60),
        min_quality_confidence=_float_env("DEEPFACE_MIN_QUALITY_CONFIDENCE", 0.85),
        weights_dir=os.environ.get("DEEPFACE_HOME", ""),
    )


settings = load_settings()
