/**
 * Face Attendance + DeepFace Master Plan, Phase 4/5 — provider selection.
 *
 * Environment-driven (Master Plan §19), never hardcoded. Phase 4 left
 * `BIOMETRIC_PROVIDER=deepface` failing closed with an explicit
 * not-implemented error; Phase 5 wires it to the real `DeepFaceProvider`
 * (`api/_lib/biometrics/providers/DeepFaceProvider.ts`), a thin HTTP client
 * against the already-built Phase 1 Python service. `DEEPFACE_SERVICE_URL`
 * is required when `deepface` is selected — failing closed with a clear
 * config error is preferable to silently falling back to the mock in what
 * could be a real deployment. `DEEPFACE_SERVICE_AUTH_TOKEN` is optional at
 * this layer only because the Python service itself is the actual
 * enforcement point for it (Phase 1's `require_service_auth`) — an unset
 * token against a real deployment fails every call closed via a mapped 401,
 * never a silent bypass.
 *
 * Phase 12 hardening: `BIOMETRIC_PROVIDER` itself has NO default. An earlier
 * version of this function silently fell back to `MockProvider` when the
 * variable was unset — inconsistent with every other fail-closed decision
 * in this file/initiative, and exactly the "mock provider accidentally
 * reachable in production" risk a forgotten env var in a real deployment
 * must never produce for a security-relevant biometric endpoint. `mock` is
 * now only ever selected by an explicit `BIOMETRIC_PROVIDER=mock` (local
 * dev/test), never by omission.
 */

import { MockProvider } from '../../../src/lib/biometrics/providers/MockProvider.js';
import type { BiometricProvider } from '../../../src/lib/biometrics/providers/BiometricProvider.js';
import { DeepFaceProvider } from './providers/DeepFaceProvider.js';

export function resolveConfiguredProvider(): BiometricProvider {
  const raw = process.env.BIOMETRIC_PROVIDER;
  if (!raw || !raw.trim()) {
    throw new Error(
      "BIOMETRIC_PROVIDER is not set. Set it explicitly to 'mock' (local dev/test only) or 'deepface' (production) — there is no implicit default, by design, so a forgotten environment variable can never silently select the mock provider in a real deployment.",
    );
  }
  const configured = raw.trim().toLowerCase();
  if (configured === 'mock') {
    return new MockProvider();
  }
  if (configured === 'deepface') {
    const serviceUrl = process.env.DEEPFACE_SERVICE_URL;
    if (!serviceUrl) {
      throw new Error('BIOMETRIC_PROVIDER=deepface requires DEEPFACE_SERVICE_URL to be set.');
    }
    return new DeepFaceProvider({
      serviceUrl,
      authToken: process.env.DEEPFACE_SERVICE_AUTH_TOKEN || undefined,
      requestTimeoutMs: process.env.DEEPFACE_REQUEST_TIMEOUT_MS
        ? Number(process.env.DEEPFACE_REQUEST_TIMEOUT_MS)
        : undefined,
    });
  }
  throw new Error(`Unknown BIOMETRIC_PROVIDER '${configured}'.`);
}
