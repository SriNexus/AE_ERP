"""
Thin wrapper around the installed DeepFace package.

Per the Face Attendance + DeepFace Master Plan Section 8 ("Service
Boundaries"): this module owns face detection, quality signal extraction,
liveness classification, embedding generation, and embedding-distance
computation. It owns NOTHING about Neozy identity/tenant/authorization — it
never imports Firestore, never sees a companyId/employeeId, and is callable
in complete isolation (Phase 1 scope).

Every public function here:
  - never writes a raw image to disk, cache, or log (Phase 1 requirement 14)
  - never logs an embedding (Phase 1 requirement 14)
  - raises one of app.errors's typed BiometricServiceError subtypes on
    every documented failure mode, never a bare DeepFace/TensorFlow
    exception (Phase 1 requirement 7: "Never expose Python stack traces or
    internal paths through the API response")
  - reads model/detector selection from app.config.settings only — never a
    hardcoded model/detector name (Phase 1 requirement 5)
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.config import settings
from app.errors import (
    BiometricServiceError,
    ErrorCode,
    malformed_image,
    model_failure,
    multiple_faces_detected,
    no_face_detected,
)
from app.logging_utils import log_event

# DeepFace's own package version string and the exact model/detector class
# names it exposes — read directly from the installed package, never
# hardcoded, so /readiness always reports what is ACTUALLY loaded (Phase 1
# requirement 6: "Verify the actual installed DeepFace implementation...
# before coding around them").
import deepface as _deepface_pkg  # noqa: E402
from deepface import DeepFace  # noqa: E402
from deepface.modules.modeling import AVAILABLE_MODELS  # noqa: E402


DEEPFACE_VERSION = _deepface_pkg.__version__


def decode_image(raw_bytes: bytes) -> np.ndarray:
    """Decode raw uploaded bytes into a BGR numpy array DeepFace can consume.

    This is the single choke point for "malformed image" / "zero-byte
    image" / "unsupported image" detection (Phase 1 requirement 7) — done
    BEFORE any DeepFace/TensorFlow call, so a bad upload never reaches the
    model layer at all.
    """
    if not raw_bytes:
        raise malformed_image()
    array = np.frombuffer(raw_bytes, dtype=np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if img is None:
        raise malformed_image()
    return img


@dataclass(frozen=True)
class DetectedFace:
    x: int
    y: int
    w: int
    h: int
    confidence: float
    is_real: bool | None  # populated only when anti_spoofing was requested
    antispoof_score: float | None


def _map_deepface_exception(exc: Exception) -> Exception:
    """Translate a DeepFace/TensorFlow exception into a safe, typed error.

    Never re-raises the original exception (which can carry local filesystem
    paths from TensorFlow/Keras) — Phase 1 requirement 7.
    """
    name = type(exc).__name__
    message = str(exc)
    if name in ("FaceNotDetected",) or "could not be detected" in message.lower():
        return no_face_detected()
    log_event("unmapped_deepface_exception", exception_type=name)
    return model_failure()


def detect_faces(img: np.ndarray, *, require_single: bool) -> list[DetectedFace]:
    """Detect faces via the configured detector backend.

    `require_single=True` (used by the /represent, /verify, /liveness
    pipeline) fails closed on 0 or >1 faces per the master plan's explicit
    fail-closed requirement (Section 15) — it never silently picks one.
    `require_single=False` (used by /detect) returns whatever was found,
    including zero or many, for the caller to inspect directly.

    Phase 1 finding (verified against the actually-installed DeepFace
    0.0.100): `enforce_detection=False` does NOT mean "return the real
    detections, however many, including zero" — when no face is found, it
    fabricates a single whole-image pseudo-detection
    (x=0,y=0,w=<img_w>,h=<img_h>, confidence=0.0) instead of an empty list.
    Always calling with `enforce_detection=True` and catching the resulting
    "no face" exception ourselves is the only way to get an honest zero
    count — required so /detect's "0 or many, no silent fabrication"
    contract (Master Plan Section 15: never silently invent a detection)
    actually holds.
    """
    try:
        raw_faces = DeepFace.extract_faces(
            img_path=img,
            detector_backend=settings.detector_backend,
            enforce_detection=True,
            align=True,
            anti_spoofing=False,
        )
    except Exception as exc:  # noqa: BLE001 - intentionally broad, see _map_deepface_exception
        mapped = _map_deepface_exception(exc)
        if not require_single and isinstance(mapped, BiometricServiceError) and mapped.code == ErrorCode.NO_FACE_DETECTED:
            return []
        raise mapped from None

    faces: list[DetectedFace] = []
    for f in raw_faces:
        area = f.get("facial_area", {})
        faces.append(
            DetectedFace(
                x=int(area.get("x", 0)),
                y=int(area.get("y", 0)),
                w=int(area.get("w", 0)),
                h=int(area.get("h", 0)),
                confidence=float(f.get("confidence", 0.0)),
                is_real=None,
                antispoof_score=None,
            )
        )

    if require_single:
        if len(faces) == 0:
            raise no_face_detected()
        if len(faces) > 1:
            raise multiple_faces_detected(len(faces))

    return faces


@dataclass(frozen=True)
class QualityResult:
    passed: bool
    reasons: list[str]
    face: DetectedFace


def assess_quality(img: np.ndarray) -> QualityResult:
    """Heuristic v1 quality gate (Phase 1 scope).

    Deliberately simple and explicitly NOT modeled on a published
    benchmark — resolution/face-size/detector-confidence heuristics only.
    This is recorded honestly (not overclaimed) per the master plan's own
    "do not blindly assume" discipline; a later phase may replace this with
    a stronger signal without changing this function's contract.
    """
    faces = detect_faces(img, require_single=True)
    face = faces[0]
    reasons: list[str] = []

    if face.w < settings.min_face_size_px or face.h < settings.min_face_size_px:
        reasons.append("face_too_small")
    if face.confidence < settings.min_quality_confidence:
        reasons.append("low_detector_confidence")

    # Coarse brightness check on the cropped face region.
    x2, y2 = face.x + face.w, face.y + face.h
    crop = img[max(face.y, 0):max(y2, 0), max(face.x, 0):max(x2, 0)]
    if crop.size == 0:
        reasons.append("invalid_crop")
    else:
        mean_brightness = float(crop.mean())
        if mean_brightness < 40:
            reasons.append("too_dark")
        elif mean_brightness > 220:
            reasons.append("too_bright")

    return QualityResult(passed=len(reasons) == 0, reasons=reasons, face=face)


@dataclass(frozen=True)
class LivenessResult:
    is_live: bool
    antispoof_score: float | None
    model_used: str


def check_liveness(img: np.ndarray) -> LivenessResult:
    """DeepFace's built-in anti_spoofing=True path (FasNet), per Master Plan
    Section 6 — passive, single-frame liveness only, honestly labeled as
    such at the call site (see the master plan's explicit limitation note).
    """
    if not settings.anti_spoofing_enabled:
        # Explicitly disabled via config — never silently skipped without
        # the caller knowing (Phase 1 requirement 5: config-driven).
        return LivenessResult(is_live=True, antispoof_score=None, model_used="disabled")

    try:
        raw_faces = DeepFace.extract_faces(
            img_path=img,
            detector_backend=settings.detector_backend,
            enforce_detection=True,
            align=True,
            anti_spoofing=True,
        )
    except Exception as exc:  # noqa: BLE001
        raise _map_deepface_exception(exc) from None

    if len(raw_faces) == 0:
        raise no_face_detected()
    if len(raw_faces) > 1:
        raise multiple_faces_detected(len(raw_faces))

    f = raw_faces[0]
    is_real = bool(f.get("is_real", False))
    score = f.get("antispoof_score")
    return LivenessResult(
        is_live=is_real,
        antispoof_score=float(score) if score is not None else None,
        model_used="Fasnet",
    )


@dataclass(frozen=True)
class EmbeddingResult:
    embedding: list[float]
    model_name: str
    detector_backend: str


def generate_embedding(img: np.ndarray) -> EmbeddingResult:
    try:
        reps = DeepFace.represent(
            img_path=img,
            model_name=settings.recognition_model,
            detector_backend=settings.detector_backend,
            enforce_detection=True,
            align=True,
        )
    except Exception as exc:  # noqa: BLE001
        raise _map_deepface_exception(exc) from None

    if len(reps) == 0:
        raise no_face_detected()
    if len(reps) > 1:
        raise multiple_faces_detected(len(reps))

    return EmbeddingResult(
        embedding=[float(v) for v in reps[0]["embedding"]],
        model_name=settings.recognition_model,
        detector_backend=settings.detector_backend,
    )


@dataclass(frozen=True)
class VerifyResult:
    distance: float
    deepface_threshold: float
    deepface_verified: bool
    distance_metric: str
    model_name: str


def verify_embeddings(embedding_a: list[float], embedding_b: list[float]) -> VerifyResult:
    """Distance + DeepFace's own reported threshold between two ALREADY-
    GENERATED embeddings.

    Per Master Plan Section 6/10: this function reports DeepFace's own
    threshold and verdict — it does NOT decide Neozy's final pass/fail. The
    caller (in later phases, Neozy's Node orchestration layer) independently
    re-applies its own threshold policy. This service never makes an
    authorization decision (Master Plan Section 8).
    """
    try:
        result = DeepFace.verify(
            img1_path=embedding_a,
            img2_path=embedding_b,
            model_name=settings.recognition_model,
            detector_backend=settings.detector_backend,
            silent=True,
        )
    except Exception as exc:  # noqa: BLE001
        raise _map_deepface_exception(exc) from None

    return VerifyResult(
        distance=float(result["distance"]),
        deepface_threshold=float(result["threshold"]),
        deepface_verified=bool(result["verified"]),
        distance_metric=str(result.get("similarity_metric", "cosine")),
        model_name=settings.recognition_model,
    )


# ── Model warm-up / readiness ──────────────────────────────────────────

_warmup_state: dict[str, Any] = {
    "recognition_model_loaded": False,
    "detector_model_loaded": False,
    "spoof_model_loaded": False,
    "last_error": None,
}


def _known_model_names() -> tuple[list[str], list[str], list[str]]:
    return (
        list(AVAILABLE_MODELS["facial_recognition"].keys()),
        list(AVAILABLE_MODELS["face_detector"].keys()),
        list(AVAILABLE_MODELS["spoofing"].keys()),
    )


def warm_up_models() -> None:
    """Load models into memory once, at process startup.

    Per Master Plan Phase 1 requirement 9 ("Models must be loaded once and
    reused. Do NOT download model weights on every request. Do NOT rely on
    first-user-request downloads as the production strategy") this is
    called from main.py's FastAPI lifespan startup hook, not lazily on the
    first real request.
    """
    recognition_names, detector_names, spoof_names = _known_model_names()
    if settings.recognition_model not in recognition_names:
        _warmup_state["last_error"] = f"unknown recognition model '{settings.recognition_model}'"
        return
    if settings.detector_backend not in detector_names:
        _warmup_state["last_error"] = f"unknown detector backend '{settings.detector_backend}'"
        return

    try:
        from deepface.modules import modeling

        modeling.build_model(task="facial_recognition", model_name=settings.recognition_model)
        _warmup_state["recognition_model_loaded"] = True

        modeling.build_model(task="face_detector", model_name=settings.detector_backend)
        _warmup_state["detector_model_loaded"] = True

        if settings.anti_spoofing_enabled:
            modeling.build_model(task="spoofing", model_name="Fasnet")
            _warmup_state["spoof_model_loaded"] = True
        else:
            _warmup_state["spoof_model_loaded"] = True  # not required when disabled

        _warmup_state["last_error"] = None
    except Exception as exc:  # noqa: BLE001
        _warmup_state["last_error"] = f"{type(exc).__name__}"
        log_event("model_warmup_failed", exception_type=type(exc).__name__)


def readiness_probe() -> dict[str, Any]:
    """A trivial real inference call, on a fixed in-memory synthetic image,
    to prove the loaded models actually work end-to-end — distinct from
    `warm_up_models()`'s "did the weights load" check. Per Master Plan
    Section 13: "/readiness ... confirms models are actually loaded and a
    trivial inference call succeeds, not just that the process is up."
    """
    if not (
        _warmup_state["recognition_model_loaded"]
        and _warmup_state["detector_model_loaded"]
        and _warmup_state["spoof_model_loaded"]
    ):
        return {
            "ready": False,
            "reason": "models_not_loaded",
            "detail": _warmup_state["last_error"],
        }

    try:
        from deepface.modules import modeling

        recognition_client = modeling.build_model(
            task="facial_recognition", model_name=settings.recognition_model
        )
        # Phase 1 finding: a hardcoded synthetic frame size is WRONG in
        # general — ArcFace expects (112, 112), not every recognition
        # model's expected shape (e.g. Facenet's 160x160). Reading
        # `input_shape` from the actually-built model client (rather than
        # assuming a fixed size) is required for /readiness to work
        # correctly regardless of which model DEEPFACE_RECOGNITION_MODEL
        # selects. It is NOT expected to detect a face (there isn't one) —
        # this probes model callability, not detection accuracy.
        input_shape = getattr(recognition_client, "input_shape", (112, 112))
        synthetic = np.zeros((*input_shape, 3), dtype=np.uint8)
        start = time.monotonic()
        recognition_client.forward(synthetic)
        elapsed_ms = round((time.monotonic() - start) * 1000, 2)
    except Exception as exc:  # noqa: BLE001
        return {"ready": False, "reason": "trivial_inference_failed", "detail": type(exc).__name__}

    return {
        "ready": True,
        "recognition_model": settings.recognition_model,
        "detector_backend": settings.detector_backend,
        "anti_spoofing_enabled": settings.anti_spoofing_enabled,
        "deepface_version": DEEPFACE_VERSION,
        "trivial_inference_ms": elapsed_ms,
    }
