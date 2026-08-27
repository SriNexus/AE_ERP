/**
 * Face Attendance + DeepFace Master Plan, Phase 7 — `FaceCapture`.
 *
 * The real front-camera capture UI (§16), reusable by both enrollment
 * (`FaceEnrollmentPanel.tsx`, this phase) and — per this phase's own
 * "carries into Phase 8+" line — the future verification/check-in UI.
 * Mirrors `CheckInPanel.tsx`'s own status-icon/state-machine UI convention
 * (§2.3's established precedent this phase's own spec names explicitly).
 *
 * Generic and decision-free by design: this component only ever hands its
 * caller a captured `Blob` via `onCapture` — it never itself decides
 * enrollment/verification/liveness/match success, never talks to the
 * biometric API directly, and never talks to DeepFace. That boundary is the
 * caller's job (`useFaceEnrollment.ts` for enrollment; Phase 8's own hook
 * for verification).
 *
 * MUST NOT be confused with / must not repurpose
 * `src/components/shared/DocumentManager.tsx`'s existing
 * `capture="environment"` rear-camera still-image input — a separate,
 * unrelated component (§2.12) — this component uses a genuinely live
 * `getUserMedia` front-camera stream instead.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { AlertTriangle, Camera, Check, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { useFaceCapture } from '../../features/attendance/hooks/useFaceCapture';

/** Live-scan sampling interval — one auto-captured frame roughly every 2s
 * while streaming and not already mid-submission. Deliberately NOT every
 * video frame (this session's own explicit "no request storm" requirement)
 * — each attempt drives a real DeepFace inference call server-side. */
const AUTO_CAPTURE_INTERVAL_MS = 2000;

export interface FaceCaptureProps {
  /** Called every time a frame is ready to submit. In `autoCapture` mode
   * this fires repeatedly, once per scan tick — the caller (not this
   * generic, decision-free component) is responsible for guarding against
   * overlapping submissions via `isSubmitting`. Receives the raw `Blob`
   * only — this component never encodes it to base64 or sends it anywhere
   * itself. */
  onCapture: (blob: Blob) => void;
  /** True while the caller is submitting the last-captured frame — shows a
   * processing overlay, disables retake/cancel/manual controls, and (in
   * `autoCapture` mode) pauses the scan loop so a submission is never
   * raced by a second concurrent one. */
  isSubmitting?: boolean;
  /** Called when the user cancels out of the flow (also the accessible,
   * always-reachable non-visual fallback affordance §16 requires — "a
   * clearly reachable... link/button rather than being a hard dead-end for
   * a user who cannot use a camera"). */
  onCancel?: () => void;
  /** Short heading for what this capture is for (e.g. "Enroll Your Face"). */
  title?: string;
  /** When true, requests camera permission and starts the stream
   * automatically the moment this component mounts, skipping the manual
   * "Start Camera" tap. Used by the real employee attendance flow
   * (`FaceAttendanceFlow.tsx`) — opening the camera modal is ALREADY the
   * user's own explicit, deliberate action, so §16's "permission-on-
   * start-only" principle is satisfied by THAT tap; requiring a second,
   * redundant "Start Camera" tap inside an already-explicitly-opened
   * camera screen adds friction without adding a meaningful privacy
   * safeguard. Defaults to `false`, preserving the original manual-start
   * behavior for any other caller. */
  autoStart?: boolean;
  /** Camera-first live verification: when true, there is NO "Capture"
   * button at all — once streaming, a frame is automatically sampled on a
   * fixed interval (paused while `isSubmitting`) and handed to `onCapture`
   * immediately, with no freeze-frame preview/confirm step. Defaults to
   * `false`, preserving the original manual capture-then-confirm flow for
   * any other caller. */
  autoCapture?: boolean;
  /** Overrides the default "Position your face..." guidance line while
   * streaming — driven by the caller's own classification of the last
   * scan attempt (see `faceCaptureSupport.ts`'s `describeLiveScanGuidance`/
   * `isRetriableBiometricErrorCode`). Ignored outside `autoCapture` mode. */
  scanMessage?: string;
  /** Tone for `scanMessage` — 'danger' for a retriable rejection (face not
   * matched, no face, etc.), 'muted' for a neutral "Scanning…" prompt. */
  scanTone?: 'muted' | 'danger';
}

function StatusLine({ children, tone }: { children: React.ReactNode; tone: 'muted' | 'danger' | 'success' }) {
  const color = tone === 'danger' ? 'var(--color-danger)' : tone === 'success' ? 'var(--color-success)' : 'var(--color-text-muted)';
  return (
    <div role="status" aria-live="polite" className="text-xs mt-1" style={{ color }}>
      {children}
    </div>
  );
}

export default function FaceCapture({
  onCapture, isSubmitting = false, onCancel, title = 'Face Capture', autoStart = false,
  autoCapture = false, scanMessage, scanTone = 'muted',
}: FaceCaptureProps) {
  const { status, errorMessage, videoRef, previewUrl, capturedBlob, start, capture, captureFrame, retake, cancel } = useFaceCapture();

  // Mount-only: intentionally never re-runs on subsequent renders (start
  // is stable per useCallback, and re-triggering on every re-render would
  // re-request the camera every time e.g. isSubmitting flips). Uses
  // `useLayoutEffect`, not `useEffect` — it flushes before the browser's
  // first paint, so the transient 'idle' ("Start Camera" button) state is
  // never actually visible to the user; the very first thing painted is
  // the 'requesting-permission' state instead, matching "no blank
  // screen... show a polished camera shell while initializing."
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (autoStart) start();
  }, []);

  // Camera-first live verification loop. Kept intentionally simple and
  // decision-free (this component still never decides a match/liveness
  // outcome — it only samples frames): while streaming and `autoCapture`
  // is on, grab one frame every `AUTO_CAPTURE_INTERVAL_MS` and hand it to
  // the caller. `isSubmitting`/`onCapture` are read via refs (updated every
  // render, never causing the interval itself to be torn down and rebuilt)
  // so a submission finishing mid-flight doesn't reset the scan cadence —
  // only `autoCapture`/`status`/`captureFrame` (itself keyed on `status`
  // inside the hook) actually restart the loop.
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  useEffect(() => {
    if (!autoCapture || status !== 'streaming') return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (isSubmittingRef.current) return; // one verification request at a time
      captureFrame().then((blob) => {
        if (cancelled || !blob) return;
        onCaptureRef.current(blob);
      });
    }, AUTO_CAPTURE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [autoCapture, status, captureFrame]);

  function handleCancel() {
    cancel();
    onCancel?.();
  }

  function handleUsePhoto() {
    if (capturedBlob) onCapture(capturedBlob);
  }

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        background: status === 'error' ? 'var(--color-danger-bg, rgba(239,68,68,0.08))' : 'var(--color-surface)',
        borderColor: status === 'error' ? 'var(--color-danger-border, rgba(239,68,68,0.3))' : 'var(--color-border)',
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
          <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{title}</span>
        </div>
        {onCancel && (
          <IconButton
            icon={<X className="h-4 w-4" />}
            title="Cancel"
            onClick={handleCancel}
            size="sm"
          />
        )}
      </div>

      {/* Privacy disclosure — must be visible BEFORE the camera stream
          starts (§16: "clearly state what happens to the image... before
          the camera stream starts"). */}
      {status === 'idle' && (
        <div className="text-center py-6">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
          <p className="text-xs max-w-xs mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }}>
            Your camera will capture a live photo to verify your identity. The photo is never stored as
            an image — only a secure mathematical representation of your face is saved.
          </p>
          <Button size="sm" icon={<Camera className="h-3.5 w-3.5" />} onClick={start}>
            Start Camera
          </Button>
        </div>
      )}

      {status === 'requesting-permission' && (
        <div className="text-center py-8">
          <Loader2 className="h-6 w-6 mx-auto animate-spin" style={{ color: 'var(--color-primary)' }} />
          <StatusLine tone="muted">Requesting camera access…</StatusLine>
        </div>
      )}

      {status === 'streaming' && (
        <div>
          <div
            className="relative w-full overflow-hidden rounded-lg"
            style={{ aspectRatio: '4 / 3', background: '#000', maxWidth: 520, margin: '0 auto' }}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="Live camera preview"
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            {/* Decorative face-framing guide — purely visual UX, never a
                security/quality signal (§10: client-side hints only). Pulses
                gently while actively scanning so the live-scan experience
                reads as "working", not stalled. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div
                className={autoCapture ? 'rounded-full border-2 border-dashed animate-pulse' : 'rounded-full border-2 border-dashed'}
                style={{ width: '55%', height: '80%', borderColor: 'rgba(255,255,255,0.6)' }}
              />
            </div>
            {/* Camera-first live verification: a request is in flight —
                shown OVER the still-live, still-playing video, never a
                freeze-frame (there is no captured/preview state in this
                mode at all). */}
            {autoCapture && isSubmitting && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.35)' }}
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-white text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking…
                </div>
              </div>
            )}
          </div>

          {autoCapture ? (
            <StatusLine tone={scanTone}>
              {scanMessage || 'Position your face inside the frame.'}
            </StatusLine>
          ) : (
            <>
              <StatusLine tone="muted">Position your face inside the outline, then capture.</StatusLine>
              <div className="flex justify-center mt-3">
                <Button size="sm" icon={<Camera className="h-3.5 w-3.5" />} onClick={capture}>
                  Capture
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {status === 'captured' && previewUrl && (
        <div>
          <div
            className="relative w-full overflow-hidden rounded-lg"
            style={{ aspectRatio: '4 / 3', background: '#000', maxWidth: 520, margin: '0 auto' }}
          >
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
            <img
              src={previewUrl}
              alt="Captured face photo preview"
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            {isSubmitting && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.55)' }}
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-white text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing…
                </div>
              </div>
            )}
          </div>
          <StatusLine tone="muted">Photo captured. Use this photo, or retake it.</StatusLine>
          <div className="flex justify-center gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={retake}
              disabled={isSubmitting}
            >
              Retake
            </Button>
            <Button
              size="sm"
              icon={isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              onClick={handleUsePhoto}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting…' : 'Use This Photo'}
            </Button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center py-6">
          <AlertTriangle className="h-6 w-6 mx-auto mb-2" style={{ color: 'var(--color-danger)' }} />
          <StatusLine tone="danger">{errorMessage}</StatusLine>
          <div className="flex justify-center gap-2 mt-3">
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={start}>
              Try Again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
