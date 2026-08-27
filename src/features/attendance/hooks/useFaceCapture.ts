/**
 * Face Attendance + DeepFace Master Plan, Phase 7 — `useFaceCapture` hook.
 *
 * Owns ONLY camera lifecycle + local capture UX (Master Plan §16/§8: "Owns
 * camera permission/lifecycle, live frame capture, UX states... Never
 * computes a match, liveness verdict, or attendance outcome itself, and
 * never talks to the Python service directly"). Every biometric decision
 * stays server-side — this hook's entire job ends the moment it hands a
 * validated `Blob` to its caller.
 *
 * State machine (mirrors `useCheckIn.ts`'s own status-derived-from-mutation
 * shape, adapted for camera lifecycle rather than a single async call):
 *   idle → requesting-permission → streaming → captured
 *                                       ↑___________|  (retake)
 *   any state → error (permission denied / unsupported / camera failure)
 *   any state → idle (cancel)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildFaceCaptureConstraints,
  describeFaceCaptureErrorReason,
  isCapturedBlobUsable,
  isGetUserMediaSupported,
  isSecureContextAvailable,
  mapGetUserMediaError,
  type FaceCaptureErrorReason,
} from '../services/faceCaptureSupport';

export type FaceCaptureStatus = 'idle' | 'requesting-permission' | 'streaming' | 'captured' | 'error';

export interface UseFaceCaptureReturn {
  status: FaceCaptureStatus;
  errorReason: FaceCaptureErrorReason | null;
  errorMessage: string | null;
  /** Attach to a `<video autoPlay muted playsInline>` element. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Object URL for the captured frame preview — only set once `status ===
   * 'captured'`, revoked automatically on retake/cancel/unmount. Never a
   * base64 string (kept out of state entirely — see
   * `faceCaptureSupport.ts`'s own doc comment). */
  previewUrl: string | null;
  /** The captured frame, ready to hand to `useFaceEnrollment`. `null`
   * outside `status === 'captured'`. */
  capturedBlob: Blob | null;
  start: () => void;
  capture: () => void;
  /** Camera-first live verification primitive — grabs one frame from the
   * live video without any UI state transition (see its own doc comment).
   * `null` if not currently streaming or the frame was unusable. */
  captureFrame: () => Promise<Blob | null>;
  retake: () => void;
  /** Stops the camera stream entirely and returns to `idle` — call on
   * explicit user cancellation, not just on unmount (unmount is handled
   * automatically, see the hook's own cleanup effect). */
  cancel: () => void;
}

export function useFaceCapture(): UseFaceCaptureReturn {
  const [status, setStatus] = useState<FaceCaptureStatus>('idle');
  const [errorReason, setErrorReason] = useState<FaceCaptureErrorReason | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // Camera-cleanup-on-unmount (Master Plan §16's own explicit, tested
  // requirement): stops every track and revokes any outstanding object URL
  // no matter how the component left the flow (navigation away, unmount
  // mid-stream, mid-error) — never left running in the background.
  useEffect(() => {
    return () => {
      stopStream();
      revokePreview();
    };
  }, [stopStream, revokePreview]);

  const fail = useCallback((reason: FaceCaptureErrorReason) => {
    stopStream();
    setStatus('error');
    setErrorReason(reason);
  }, [stopStream]);

  const start = useCallback(() => {
    // Real-device testing found this ORDER was itself a genuine bug: on an
    // insecure origin (e.g. a plain `http://192.168.x.x:5173` LAN address —
    // not `https://`, `localhost`, or `127.0.0.1`), Chrome does not expose
    // `navigator.mediaDevices` AT ALL, regardless of the browser's actual
    // capability — so checking `isGetUserMediaSupported()` FIRST always
    // failed with 'unsupported' on an insecure origin, showing the employee
    // "Your browser does not support camera capture" even on a fully
    // capable, up-to-date Chrome. The real cause was never the browser —
    // it was the insecure context. Checking secure-context FIRST reports
    // the true, actionable cause ("Camera capture requires a secure (HTTPS)
    // connection") instead of a false "unsupported browser" diagnosis.
    if (!isSecureContextAvailable()) {
      fail('insecure_context');
      return;
    }
    if (!isGetUserMediaSupported()) {
      fail('unsupported');
      return;
    }
    setStatus('requesting-permission');
    setErrorReason(null);
    navigator.mediaDevices
      .getUserMedia(buildFaceCaptureConstraints())
      .then((stream) => {
        streamRef.current = stream;
        // Deliberately does NOT assign `videoRef.current.srcObject` here —
        // real-device testing found this was a genuine bug (not a mobile-
        // Chrome-specific quirk; it reproduces on every platform): at this
        // exact point in the promise callback, `<video ref={videoRef}>`
        // has not been mounted yet — `FaceCapture.tsx` only renders it once
        // `status === 'streaming'`, and that transition hasn't been
        // committed to the DOM yet (the very next line only just requests
        // it). `videoRef.current` is therefore still `null`, the
        // `if (videoRef.current)` guard silently no-ops, and the freshly
        // acquired stream — permission genuinely granted, camera genuinely
        // opened — is never attached to the video element that mounts a
        // moment later, leaving a black/blank preview indistinguishable
        // from "the camera never opened." Fixed deterministically below via
        // a `useEffect` keyed on `status`, which only runs AFTER React has
        // committed the DOM (guaranteeing the video element exists) —
        // never a fragile setTimeout/magic-delay workaround.
        setStatus('streaming');
      })
      .catch((error: unknown) => {
        fail(mapGetUserMediaError(error));
      });
  }, [fail]);

  // Attaches the live stream to the video element once it is guaranteed to
  // exist in the DOM (this effect runs after React's commit phase, i.e.
  // after the `status === 'streaming'` render — including on `retake()`,
  // which unmounts/remounts a fresh `<video>` element by transitioning
  // 'captured' -> 'streaming' again, needing the SAME re-attachment).
  // `video.play()` is called explicitly as defense-in-depth alongside the
  // `autoPlay` attribute — `autoPlay` alone reliably starts a MUTED stream
  // in every evergreen browser, but calling `.play()` too costs nothing and
  // covers the rare engine that doesn't fire autoplay when `srcObject` is
  // assigned after the element is already mounted. A rejected `.play()`
  // promise is swallowed — it only ever rejects because playback already
  // started or the element was removed a moment later, never a real error
  // the user needs to see (`fail()`'s own error states cover genuine
  // getUserMedia/permission failures already).
  useEffect(() => {
    if (status !== 'streaming') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [status]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || status !== 'streaming') return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      fail('capture_failed');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!isCapturedBlobUsable(blob)) {
          fail('capture_failed');
          return;
        }
        revokePreview();
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setCapturedBlob(blob);
        setStatus('captured');
      },
      'image/jpeg',
      0.92,
    );
  }, [status, fail, revokePreview]);

  // Camera-first live verification: grabs a single frame from the CURRENT
  // live video WITHOUT transitioning to the 'captured' review/confirm
  // state `capture()` above uses — the video keeps playing continuously,
  // there is no freeze-frame preview, no Retake/Use This Photo step. Used
  // by the automatic/continuous scanning flow (`FaceCapture`'s own
  // `autoCapture` mode), which calls this on a timer and hands each
  // resulting blob straight to the caller for immediate submission — the
  // employee never presses a "Capture" button for normal verification.
  // Returns `null` (never throws) when the video isn't actually streaming
  // or the frame is unusable, so the auto-scan loop can simply skip that
  // tick rather than needing its own try/catch.
  const captureFrame = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || status !== 'streaming') {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(isCapturedBlobUsable(blob) ? blob : null),
        'image/jpeg',
        0.92,
      );
    });
  }, [status]);

  const retake = useCallback(() => {
    revokePreview();
    setPreviewUrl(null);
    setCapturedBlob(null);
    // The stream is still live (never stopped between capture attempts) —
    // go straight back to 'streaming', no re-permission round-trip needed.
    setStatus(streamRef.current ? 'streaming' : 'idle');
  }, [revokePreview]);

  const cancel = useCallback(() => {
    stopStream();
    revokePreview();
    setPreviewUrl(null);
    setCapturedBlob(null);
    setErrorReason(null);
    setStatus('idle');
  }, [stopStream, revokePreview]);

  const errorMessage = errorReason ? describeFaceCaptureErrorReason(errorReason) : null;

  return { status, errorReason, errorMessage, videoRef, previewUrl, capturedBlob, start, capture, captureFrame, retake, cancel };
}
