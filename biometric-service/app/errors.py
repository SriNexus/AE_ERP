"""
Structured error codes for the biometric inference service.

Per the Face Attendance + DeepFace Master Plan (Phase 1, "Implement proper
structured request/response contracts and explicit error codes" /
"Never expose Python stack traces or internal paths through the API
response"): every failure mode this service can produce maps to exactly one
of these codes. Callers (the future Neozy Node orchestration layer) branch on
`error_code`, never on message text.

This service is inference-only (Master Plan Section 8 "Service Boundaries")
so it has NO concept of authorization/identity/tenant errors beyond its own
service-to-service authentication — those Neozy-specific reason codes
(not_authorized, cross_tenant_denied, no_enrollment, etc., Master Plan
Section 15) belong to the Node orchestration layer, not here.
"""

from enum import Enum


class ErrorCode(str, Enum):
    NO_FACE_DETECTED = "no_face_detected"
    MULTIPLE_FACES_DETECTED = "multiple_faces_detected"
    POOR_QUALITY_IMAGE = "poor_quality_image"
    LIVENESS_FAILED = "liveness_failed"
    MALFORMED_IMAGE = "malformed_image"
    MODEL_FAILURE = "model_failure"
    TIMEOUT = "timeout"
    UNAUTHENTICATED = "unauthenticated"
    INVALID_REQUEST = "invalid_request"
    NOT_READY = "not_ready"


class BiometricServiceError(Exception):
    """Base class for every controlled (non-leaking) failure this service raises.

    Every raise site must supply a safe `detail` — never a raw exception
    message from an underlying library (DeepFace/TensorFlow/OpenCV messages
    can include local filesystem paths), never raw image bytes, never an
    embedding vector.
    """

    def __init__(self, code: ErrorCode, detail: str, http_status: int = 422):
        self.code = code
        self.detail = detail
        self.http_status = http_status
        super().__init__(detail)


def no_face_detected() -> BiometricServiceError:
    return BiometricServiceError(
        ErrorCode.NO_FACE_DETECTED, "No face could be detected in the submitted frame.", 422
    )


def multiple_faces_detected(count: int) -> BiometricServiceError:
    return BiometricServiceError(
        ErrorCode.MULTIPLE_FACES_DETECTED,
        f"{count} faces were detected; exactly one is required.",
        422,
    )


def malformed_image() -> BiometricServiceError:
    return BiometricServiceError(
        ErrorCode.MALFORMED_IMAGE, "The submitted image could not be decoded.", 400
    )


def liveness_failed() -> BiometricServiceError:
    return BiometricServiceError(
        ErrorCode.LIVENESS_FAILED, "The submitted frame failed the liveness check.", 422
    )


def model_failure() -> BiometricServiceError:
    return BiometricServiceError(
        ErrorCode.MODEL_FAILURE, "The inference model failed to process the request.", 500
    )


def timeout() -> BiometricServiceError:
    return BiometricServiceError(
        ErrorCode.TIMEOUT, "The inference operation exceeded its internal time budget.", 504
    )


def unauthenticated() -> BiometricServiceError:
    return BiometricServiceError(
        ErrorCode.UNAUTHENTICATED, "Missing or invalid service credentials.", 401
    )


def invalid_request(detail: str) -> BiometricServiceError:
    return BiometricServiceError(ErrorCode.INVALID_REQUEST, detail, 400)


def not_ready(detail: str) -> BiometricServiceError:
    return BiometricServiceError(ErrorCode.NOT_READY, detail, 503)
