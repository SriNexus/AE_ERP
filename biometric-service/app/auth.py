"""
Service-to-service authentication.

Per the Face Attendance + DeepFace Master Plan Section 13 ("The Python
service must reject any request without valid service credentials — it is
never to be deployed with an open, unauthenticated public endpoint") and
Phase 1 requirement 13: this is the Phase 1 shared-secret bearer-token
mechanism. The final production mechanism (private network path vs. rotated
bearer token) is an infrastructure decision deferred to Phase 1/12 per the
master plan — this module implements the bearer-token fallback so the
service is never deployable unauthenticated, without prematurely locking the
final mechanism.

This module has NO knowledge of Neozy users/companies/groups — it only knows
whether the CALLER (the Node orchestration layer, in later phases) presented
the configured shared secret.
"""

from fastapi import Header

from app.config import settings
from app.errors import unauthenticated


async def require_service_auth(authorization: str | None = Header(default=None)) -> None:
    if settings.auth_disabled_for_local_dev:
        # Explicit, opt-in, non-default escape hatch for local development
        # and the Phase 1 test suite only — never set in any shared/deployed
        # environment (Master Plan Phase 1 "Security requirements": "must
        # not ship to any shared environment unauthenticated").
        return

    if not settings.service_auth_token:
        # Refuse to silently operate as "open" when no token is configured
        # and local-dev mode was not explicitly opted into — fail closed.
        raise unauthenticated()

    if not authorization or not authorization.startswith("Bearer "):
        raise unauthenticated()

    token = authorization.removeprefix("Bearer ").strip()
    if token != settings.service_auth_token:
        raise unauthenticated()
