/**
 * demoSession — Hybrid session management for Demo accounts
 *
 * Implements:
 *   - Auto logout after 6 hours of total session duration
 *   - Auto logout after 30 minutes of inactivity
 *   - localStorage-based session tracking (survives refresh)
 *   - Cross-tab synchronization via storage events
 *   - Complete state cleanup on logout
 *
 * Architecture:
 *   - Session start is recorded on login (localStorage timestamp)
 *   - Activity timestamp is updated on user interaction
 *   - A periodic check (every 30s) validates both timers
 *   - If either timer expires, auto-logout is triggered
 *
 * The hooks are designed to be used once at the app root (inside
 * ProtectedLayout) so they run for the entire authenticated session.
 */

import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../store/useAppStore';
import { isCanonicalDemoIdentity } from './demoCapabilityPolicy';

// ── Constants ────────────────────────────────────────────────

const SESSION_START_KEY = 'neozy-demo-session-start';
const ACTIVITY_KEY = 'neozy-demo-last-activity';
const SESSION_DURATION_MS = 6 * 60 * 60 * 1000;  // 6 hours
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;     // 30 minutes
const CHECK_INTERVAL_MS = 30 * 1000;               // check every 30s

// ── Storage helpers ──────────────────────────────────────────

function getStoredTimestamp(key: string): number {
  try {
    const val = localStorage.getItem(key);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

function setStoredTimestamp(key: string, timestamp: number): void {
  try {
    localStorage.setItem(key, String(timestamp));
  } catch {
    // localStorage unavailable — non-fatal
  }
}

function clearStoredTimestamps(): void {
  try {
    localStorage.removeItem(SESSION_START_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    // ignore
  }
}

// ── Activity tracking ────────────────────────────────────────

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

/**
 * Record user activity for idle timeout tracking.
 * Called on every relevant user interaction event.
 */
function recordActivity(): void {
  setStoredTimestamp(ACTIVITY_KEY, Date.now());
}

function attachActivityListeners(): () => void {
  recordActivity();
  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, recordActivity, { passive: true });
  }
  return () => {
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, recordActivity);
    }
  };
}

// ── Session state helpers ────────────────────────────────────

/**
 * Start a new demo session (called on login).
 */
export function startDemoSession(): void {
  const now = Date.now();
  setStoredTimestamp(SESSION_START_KEY, now);
  setStoredTimestamp(ACTIVITY_KEY, now);
}

/**
 * Clear all demo session state (called on logout).
 */
export function clearDemoSession(): void {
  clearStoredTimestamps();
}

/**
 * Check if the demo session has expired.
 * Returns the reason for expiration or null if still valid.
 */
export function checkDemoSessionExpiry(): {
  expired: boolean;
  reason: 'duration' | 'inactivity' | null;
} {
  const now = Date.now();
  const sessionStart = getStoredTimestamp(SESSION_START_KEY);
  const lastActivity = getStoredTimestamp(ACTIVITY_KEY);

  // No session recorded — treat as not expired (no session to expire)
  if (!sessionStart) return { expired: false, reason: null };

  // Check absolute session duration (6 hours since first login)
  if (now - sessionStart > SESSION_DURATION_MS) {
    return { expired: true, reason: 'duration' };
  }

  // Check inactivity timeout (30 minutes since last activity)
  if (lastActivity && now - lastActivity > INACTIVITY_TIMEOUT_MS) {
    return { expired: true, reason: 'inactivity' };
  }

  return { expired: false, reason: null };
}

/**
 * Get remaining session time in milliseconds.
 */
export function getDemoSessionRemaining(): {
  durationMs: number;
  inactivityMs: number;
} {
  const now = Date.now();
  const sessionStart = getStoredTimestamp(SESSION_START_KEY);
  const lastActivity = getStoredTimestamp(ACTIVITY_KEY);
  return {
    durationMs: sessionStart ? Math.max(0, SESSION_DURATION_MS - (now - sessionStart)) : SESSION_DURATION_MS,
    inactivityMs: lastActivity ? Math.max(0, INACTIVITY_TIMEOUT_MS - (now - lastActivity)) : INACTIVITY_TIMEOUT_MS,
  };
}

// ── React hook ───────────────────────────────────────────────

/**
 * useDemoSession — Run demo session management in a React component.
 *
 * This hook:
 *   1. Detects if the current user is a Demo identity
 *   2. Starts the session timer on mount (if not already started)
 *   3. Attaches activity listeners for idle detection
 *   4. Periodically checks for session expiry
 *   5. Auto-logs out with a toast notification when expired
 *
 * Place this hook inside ProtectedLayout so it runs for all authenticated pages.
 *
 * @returns Session info for UI (e.g. session timer badge)
 */
export function useDemoSession(): {
  isDemo: boolean;
  remainingDuration: number;
  remainingInactivity: number;
} {
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const isDemo = isCanonicalDemoIdentity(user ?? undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start session + attach listeners on mount when demo user is detected
  useEffect(() => {
    if (!isDemo) return;

    // Ensure session is started (might already be from login flow)
    if (!getStoredTimestamp(SESSION_START_KEY)) {
      startDemoSession();
    }

    // Attach activity listeners
    const detachListeners = attachActivityListeners();

    // Periodic check for expiry
    intervalRef.current = setInterval(() => {
      const { expired, reason } = checkDemoSessionExpiry();
      if (expired) {
        // Session expired — auto-logout
        clearDemoSession();
        logout();
        // Show a reason-specific toast
        const reasonText =
          reason === 'duration'
            ? 'Demo session expired after 6 hours. Please sign in again.'
            : 'Demo session timed out due to inactivity. Please sign in again.';
        toast.error(reasonText, { duration: 5000 });
      }
    }, CHECK_INTERVAL_MS);

    // Listen for cross-tab activity updates
    const handleStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_KEY || e.key === SESSION_START_KEY) {
        // Another tab updated activity — re-check on next interval
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      detachListeners();
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('storage', handleStorage);
    };
  }, [isDemo, logout]);

  // Track remaining time for UI (updated on each render via store subscription)
  const remaining = isDemo ? getDemoSessionRemaining() : { durationMs: 0, inactivityMs: 0 };

  return {
    isDemo,
    remainingDuration: remaining.durationMs,
    remainingInactivity: remaining.inactivityMs,
  };
}

/**
 * Format milliseconds into a human-readable duration string.
 */
export function formatDemoSessionTime(ms: number): string {
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '< 1m';
}

export default useDemoSession;
