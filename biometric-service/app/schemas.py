"""
Request/response contracts.

Per Master Plan Section 13 ("Responses are structured JSON with an explicit
status/error_code field for every documented failure mode... never a bare
exception/stack trace") and Phase 1 requirement 7.
"""

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    status: str = "error"
    error_code: str
    detail: str


class FaceBox(BaseModel):
    x: int
    y: int
    w: int
    h: int
    confidence: float


class DetectResponse(BaseModel):
    status: str = "ok"
    face_count: int
    faces: list[FaceBox]
    detector_backend: str


class QualityResponse(BaseModel):
    status: str = "ok"
    passed: bool
    reasons: list[str]
    face: FaceBox


class LivenessResponse(BaseModel):
    status: str = "ok"
    is_live: bool
    antispoof_score: float | None
    model_used: str


class RepresentResponse(BaseModel):
    status: str = "ok"
    embedding: list[float]
    embedding_dim: int
    model_name: str
    detector_backend: str
    deepface_version: str


class VerifyRequest(BaseModel):
    embedding_a: list[float] = Field(..., min_length=1)
    embedding_b: list[float] = Field(..., min_length=1)


class VerifyResponse(BaseModel):
    status: str = "ok"
    distance: float
    deepface_threshold: float
    deepface_verified: bool
    distance_metric: str
    model_name: str


class HealthResponse(BaseModel):
    status: str = "ok"


class ReadinessResponse(BaseModel):
    status: str
    ready: bool
    recognition_model: str | None = None
    detector_backend: str | None = None
    anti_spoofing_enabled: bool | None = None
    deepface_version: str | None = None
    trivial_inference_ms: float | None = None
    reason: str | None = None
    detail: str | None = None
