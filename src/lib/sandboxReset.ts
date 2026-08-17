/**
 * sandboxReset — Neozy Sandbox Engine auto-reset
 *
 * On every browser/device login with demo@neozy.in:
 * - Checks localStorage for a 'neozy-demo-seeded' marker
 * - If absent → calls /api/demo-reset to wipe and reseed demo data
 * - On success, sets the marker to prevent re-reset
 *
 * The marker is localStorage-scoped: each browser/device starts fresh.
 * The marker captures the seed version so the reset is re-triggered when
 * a new seed version is deployed (e.g., after schema changes).
 */

import { DEMO_SEED_ID } from '../config/demo';

const SEEDED_MARKER_KEY = 'neozy-demo-seeded';

/**
 * Returns true if the current browser already has seeded demo data.
 */
export function isDemoSeeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_MARKER_KEY) === DEMO_SEED_ID;
  } catch {
    return false;
  }
}

/**
 * Mark the current browser as seeded.
 */
export function markDemoSeeded(): void {
  try {
    localStorage.setItem(SEEDED_MARKER_KEY, DEMO_SEED_ID);
  } catch {
    // localStorage unavailable (private browsing? quota exceeded?) — non-fatal
  }
}

/**
 * Clear the seeded marker (forces re-seed on next login).
 * Useful for debugging or manual reset.
 */
export function clearDemoSeeded(): void {
  try {
    localStorage.removeItem(SEEDED_MARKER_KEY);
  } catch {
    // ignore
  }
}

/**
 * Trigger a demo sandbox reset via the server API.
 * Returns true on success, false on failure.
 */
export async function triggerDemoReset(): Promise<boolean> {
  try {
    const token = await getFirebaseIdToken();
    const response = await fetch('/api/demo-reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get the Firebase ID token for the current user.
 * Falls back to null if firebase auth is unavailable.
 */
async function getFirebaseIdToken(): Promise<string | null> {
  try {
    const { auth } = await import('./firebase');
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}


