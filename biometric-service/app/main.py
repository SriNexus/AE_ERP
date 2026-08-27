"""
FastAPI application — Face Attendance + DeepFace Master Plan Phase 1.

Endpoints implemented per Master Plan Section 13:
  POST /detect     POST /quality   POST /liveness
  POST /represent  POST /verify
  GET  /health     GET  /readiness

This service is inference-only (Master Plan Section 8): it has no Firestore
access, no Neozy identity/company/group knowledge, and makes no
authorization or attendance decision. It is reachable only by a caller
holding the configured service-to-service credential (app.auth).
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Request, UploadFile
from fastapi.responses import JSONResponse

from app import provider
from app.auth import require_service_auth
from app.config import settings
from app.errors import BiometricServiceError, invalid_request
from app.logging_utils import log_event, timed_request
from app.schemas import (
    DetectResponse,
    ErrorResponse,
    FaceBox,
    HealthResponse,
    LivenessResponse,
    QualityResponse,
    ReadinessResponse,
    RepresentResponse,
    VerifyRequest,
    VerifyResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Master Plan Phase 1 requirement 9: models are loaded once, at process
    # startup — never lazily on the first real request.
    log_event("startup_begin", recognition_model=settings.recognition_model,
              detector_backend=settings.detector_backend,
              anti_spoofing_enabled=settings.anti_spoofing_enabled)
    t0 = time.monotonic()
    provider.warm_up_models()
    log_event("startup_complete", warmup_seconds=round(time.monotonic() - t0, 2))
    yield


app = FastAPI(title="Neozy Biometric Inference Service", lifespan=lifespan)


@app.exception_handler(BiometricServiceError)
async def handle_biometric_error(request: Request, exc: BiometricServiceError) -> JSONResponse:
    # Single choke point translating a typed error into a response — never a
    # raw exception/stack trace reaches the client (Phase 1 requirement 7).
    return JSONResponse(
        status_code=exc.http_status,
        content=ErrorResponse(error_code=exc.code.value, detail=exc.detail).model_dump(),
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    # Belt-and-braces: ANY unmapped exception still returns a safe, generic
    # error — never the underlying message/traceback (Phase 1 requirement 7).
    log_event("unhandled_exception", exception_type=type(exc).__name__, path=request.url.path)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(error_code="model_failure", detail="An internal error occurred.").model_dump(),
    )


async def _read_image_bytes(file: UploadFile) -> bytes:
    raw = await file.read()
    if not raw:
        raise invalid_request("No image data was submitted.")
    return raw


@app.post("/detect", response_model=DetectResponse, dependencies=[Depends(require_service_auth)])
async def detect(image: UploadFile = File(...)) -> DetectResponse:
    with timed_request("/detect") as (rid, outcome):
        raw = await _read_image_bytes(image)
        img = provider.decode_image(raw)
        try:
            faces = provider.detect_faces(img, require_single=False)
        except BiometricServiceError as exc:
            outcome["error_code"] = exc.code.value
            raise
        log_event("detect_completed", request_id=rid, face_count=len(faces))
        return DetectResponse(
            face_count=len(faces),
            faces=[FaceBox(x=f.x, y=f.y, w=f.w, h=f.h, confidence=f.confidence) for f in faces],
            detector_backend=settings.detector_backend,
        )


@app.post("/quality", response_model=QualityResponse, dependencies=[Depends(require_service_auth)])
async def quality(image: UploadFile = File(...)) -> QualityResponse:
    with timed_request("/quality") as (rid, outcome):
        raw = await _read_image_bytes(image)
        img = provider.decode_image(raw)
        try:
            result = provider.assess_quality(img)
        except BiometricServiceError as exc:
            outcome["error_code"] = exc.code.value
            raise
        log_event("quality_completed", request_id=rid, passed=result.passed)
        return QualityResponse(
            passed=result.passed,
            reasons=result.reasons,
            face=FaceBox(
                x=result.face.x, y=result.face.y, w=result.face.w, h=result.face.h,
                confidence=result.face.confidence,
            ),
        )


@app.post("/liveness", response_model=LivenessResponse, dependencies=[Depends(require_service_auth)])
async def liveness(image: UploadFile = File(...)) -> LivenessResponse:
    with timed_request("/liveness") as (rid, outcome):
        raw = await _read_image_bytes(image)
        img = provider.decode_image(raw)
        try:
            result = provider.check_liveness(img)
        except BiometricServiceError as exc:
            outcome["error_code"] = exc.code.value
            raise
        log_event("liveness_completed", request_id=rid, is_live=result.is_live)
        return LivenessResponse(
            is_live=result.is_live,
            antispoof_score=result.antispoof_score,
            model_used=result.model_used,
        )


@app.post("/represent", response_model=RepresentResponse, dependencies=[Depends(require_service_auth)])
async def represent(image: UploadFile = File(...)) -> RepresentResponse:
    with timed_request("/represent") as (rid, outcome):
        raw = await _read_image_bytes(image)
        img = provider.decode_image(raw)
        try:
            result = provider.generate_embedding(img)
        except BiometricServiceError as exc:
            outcome["error_code"] = exc.code.value
            raise
        log_event("represent_completed", request_id=rid, embedding_dim=len(result.embedding))
        return RepresentResponse(
            embedding=result.embedding,
            embedding_dim=len(result.embedding),
            model_name=result.model_name,
            detector_backend=result.detector_backend,
            deepface_version=provider.DEEPFACE_VERSION,
        )


@app.post("/verify", response_model=VerifyResponse, dependencies=[Depends(require_service_auth)])
async def verify(payload: VerifyRequest) -> VerifyResponse:
    with timed_request("/verify") as (rid, outcome):
        try:
            result = provider.verify_embeddings(payload.embedding_a, payload.embedding_b)
        except BiometricServiceError as exc:
            outcome["error_code"] = exc.code.value
            raise
        log_event("verify_completed", request_id=rid, deepface_verified=result.deepface_verified)
        return VerifyResponse(
            distance=result.distance,
            deepface_threshold=result.deepface_threshold,
            deepface_verified=result.deepface_verified,
            distance_metric=result.distance_metric,
            model_name=result.model_name,
        )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    # Process-liveness only — deliberately does NOT touch the model layer
    # (Master Plan Section 13: "/health: Liveness of the process itself").
    return HealthResponse()


@app.get("/readiness", response_model=ReadinessResponse)
async def readiness() -> ReadinessResponse:
    probe = provider.readiness_probe()
    if not probe.get("ready"):
        return ReadinessResponse(
            status="not_ready",
            ready=False,
            reason=probe.get("reason"),
            detail=probe.get("detail"),
        )
    return ReadinessResponse(
        status="ok",
        ready=True,
        recognition_model=probe["recognition_model"],
        detector_backend=probe["detector_backend"],
        anti_spoofing_enabled=probe["anti_spoofing_enabled"],
        deepface_version=probe["deepface_version"],
        trivial_inference_ms=probe["trivial_inference_ms"],
    )
