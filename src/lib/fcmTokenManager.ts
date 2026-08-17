/**
 * fcmTokenManager — Firebase Cloud Messaging Device Token Manager
 *
 * Phase 9B — Web Push Notifications
 *
 * Manages FCM device tokens for push notification delivery:
 *   - Token registration on login/session start
 *   - Token refresh handling (via service worker pushsubscriptionchange event)
 *   - Token deletion on logout
 *   - Multi-device support (multiple tokens per user)
 *   - Browser notification permission request
 *
 * Architecture:
 *   - Tokens stored in `device_tokens` collection
 *   - Each token document includes: token, platform, userAgent, createdAt, lastUsedAt
 *   - Server-side code uses these tokens to send push notifications
 *   - VAPID key required from Firebase Console > Cloud Messaging > Web Push certificates
 *
 * Usage:
 *   import { registerDeviceToken } from '../lib/fcmTokenManager';
 *   await registerDeviceToken();
 */

import { COLLECTIONS, db, firebaseEnv } from './firebase';
import { updateDocById } from './firestore';
import { useAppStore } from '../store/useAppStore';

// ── Types ──────────────────────────────────────────────────────

export interface DeviceToken {
  id: string;
  userId: string;
  companyId: string;
  token: string;
  platform: 'web' | 'android' | 'ios';
  userAgent: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string;
  updatedAt: string;
}

// ── VAPID Key Configuration ────────────────────────────────────

/**
 * Get the VAPID key for web push.
 * Configured via VITE_FIREBASE_VAPID_KEY in .env
 * Get your VAPID key from:
 *   Firebase Console > Project Settings > Cloud Messaging > Web Push certificates
 */
export function getVapidKey(): string | null {
  const vapidKey = (import.meta.env as Record<string, string | undefined>).VITE_FIREBASE_VAPID_KEY;
  return vapidKey?.trim() || null;
}

export function isFcmAvailable(): boolean {
  if (!firebaseEnv.isConfigured) return false;
  if (!getVapidKey()) return false;
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

// ── Permission Management ──────────────────────────────────────

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

/**
 * Get the current browser notification permission state.
 */
export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission as NotificationPermissionState;
}

/**
 * Request browser notification permission.
 * Returns the resulting permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  if (window.Notification.permission === 'granted') {
    return 'granted';
  }

  if (window.Notification.permission === 'denied') {
    return 'denied';
  }

  try {
    const permission = await window.Notification.requestPermission();
    return permission as NotificationPermissionState;
  } catch {
    return 'default';
  }
}

// ── FCM Initialization ─────────────────────────────────────────

let fcmInitialized = false;

/**
 * Lazy-load Firebase Messaging SDK and initialize.
 * Returns true if messaging is available.
 */
async function initFcm() {
  if (fcmInitialized) return true;
  if (!isFcmAvailable()) return false;

  try {
    const { getMessaging } = await import('firebase/messaging');
    const messaging = getMessaging();
    fcmInitialized = !!messaging;
    return fcmInitialized;
  } catch (err) {
    console.warn('[FCM] Failed to initialize Firebase Messaging:', err);
    return false;
  }
}

// ── Service Worker Registration ────────────────────────────────

let swRegistration: ServiceWorkerRegistration | null = null;

/**
 * Register the Firebase Messaging Service Worker.
 * Returns the service worker registration or null.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (swRegistration) return swRegistration;
  if (!('serviceWorker' in navigator)) return null;

  try {
    swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
    console.log('[FCM] Service Worker registered:', swRegistration.scope);
    return swRegistration;
  } catch (err) {
    console.warn('[FCM] Service Worker registration failed:', err);
    return null;
  }
}

// ── Token Management ──────────────────────────────────────────

/**
 * Retrieve the current FCM device token.
 * Requires Firebase Messaging to be initialized.
 */
export async function getFcmToken(): Promise<string | null> {
  try {
    const initialized = await initFcm();
    if (!initialized) return null;

    const swReg = await registerServiceWorker();
    if (!swReg) return null;

    const vapidKey = getVapidKey();
    if (!vapidKey) {
      console.warn('[FCM] VAPID key not configured. Set VITE_FIREBASE_VAPID_KEY in .env');
      return null;
    }

    const { getMessaging, getToken } = await import('firebase/messaging');
    const messaging = getMessaging();
    const currentToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swReg,
    });

    if (currentToken) {
      return currentToken;
    }

    console.warn('[FCM] No registration token available. Request permission first.');
    return null;
  } catch (err) {
    console.warn('[FCM] Failed to get device token:', err);
    return null;
  }
}

/**
 * Register (or update) a device token in Firestore.
 * Stores the token under the user's device_tokens collection.
 */
export async function persistDeviceToken(token: string): Promise<void> {
  const user = useAppStore.getState().user;
  if (!user?.id) return;

  const companyId =
    useAppStore.getState().activeCompanyId ||
    useAppStore.getState().company?.id ||
    user.companyId ||
    'default';

  const now = new Date().toISOString();
  const userAgent = navigator.userAgent || 'unknown';
  const platform: 'web' = 'web';

  // Check if this token already exists for this user
  const { collection, getDocs, query, where } = await import('firebase/firestore');

  try {
    const existingSnap = await getDocs(query(
      collection(db, COLLECTIONS.DEVICE_TOKENS),
      where('userId', '==', user.id),
      where('token', '==', token),
      where('isActive', '==', true),
    ));

    if (existingSnap.docs.length > 0) {
      // Token already registered — update lastUsedAt
      const existingDoc = existingSnap.docs[0];
      await updateDocById(COLLECTIONS.DEVICE_TOKENS, existingDoc.id, {
        lastUsedAt: now,
        updatedAt: now,
        userAgent,
      });
      return;
    }

    // Create new device token document
    const { createDocWithId, genId } = await import('./firestore');
    const id = genId.generic('DEV');

    await createDocWithId(COLLECTIONS.DEVICE_TOKENS, id, {
      id,
      userId: user.id,
      companyId,
      token,
      platform,
      userAgent,
      isActive: true,
      createdAt: now,
      lastUsedAt: now,
      updatedAt: now,
    });

    console.log('[FCM] Device token registered:', id);
  } catch (err) {
    console.warn('[FCM] Failed to persist device token:', err);
  }
}

/**
 * Deactivate all device tokens for the current user.
 * Called on logout.
 */
export async function deactivateDeviceTokens(): Promise<void> {
  const user = useAppStore.getState().user;
  if (!user?.id) return;

  const { collection, getDocs, query, where, writeBatch, doc } = await import('firebase/firestore');

  try {
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.DEVICE_TOKENS),
      where('userId', '==', user.id),
      where('isActive', '==', true),
    ));

    if (snap.docs.length === 0) return;

    const batch = writeBatch(db);
    const now = new Date().toISOString();

    snap.docs.forEach((tokenDoc) => {
      batch.update(doc(db, COLLECTIONS.DEVICE_TOKENS, tokenDoc.id), {
        isActive: false,
        updatedAt: now,
      });
    });

    await batch.commit();
    console.log(`[FCM] Deactivated ${snap.docs.length} device token(s)`);
  } catch (err) {
    console.warn('[FCM] Failed to deactivate device tokens:', err);
  }
}

/**
 * Delete (hard delete) a specific device token.
 */
export async function deleteDeviceToken(tokenId: string): Promise<void> {
  const { deleteDoc, doc } = await import('firebase/firestore');
  try {
    await deleteDoc(doc(db, COLLECTIONS.DEVICE_TOKENS, tokenId));
    console.log('[FCM] Device token deleted:', tokenId);
  } catch (err) {
    console.warn('[FCM] Failed to delete device token:', err);
  }
}

// ── Token Refresh Handling ─────────────────────────────────────

/**
 * Handle FCM token refresh.
 *
 * In Firebase v12, `onNewToken`/`onTokenRefresh` are not available
 * from the modular SDK. Token refresh is handled via:
 *   1. The service worker's `pushsubscriptionchange` event
 *      (handled in firebase-messaging-sw.js)
 *   2. Periodic `getToken()` calls on app startup
 *
 * This function re-registers the token on the next page load
 * by calling getToken() and persisting the (possibly refreshed) token.
 */
export async function refreshDeviceToken(): Promise<string | null> {
  const token = await getFcmToken();
  if (token) {
    await persistDeviceToken(token);
  }
  return token;
}

// ── Foreground Message Handling ────────────────────────────────

let onMessageHandler: (() => void) | null = null;

/**
 * Listen for foreground push messages (app is in focus).
 * These are handled by the in-app notification system rather than
 * displayed as browser notifications.
 */
export async function setupForegroundMessageListener(): Promise<void> {
  try {
    const initialized = await initFcm();
    if (!initialized) return;

    const { getMessaging, onMessage } = await import('firebase/messaging');
    const messaging = getMessaging();

    onMessageHandler = onMessage(messaging, (payload) => {
      // Foreground messages are handled by the in-app notification system.
      // The service worker handles background messages.
      // This listener prevents duplicate browser notifications when the app is open.
      console.log('[FCM] Foreground message received:', payload);
    });

    console.log('[FCM] Foreground message listener registered');
  } catch (err) {
    console.warn('[FCM] Failed to setup foreground message listener:', err);
  }
}

/**
 * Cleanup foreground message listener.
 */
export function removeForegroundMessageListener(): void {
  if (onMessageHandler) {
    onMessageHandler();
    onMessageHandler = null;
  }
}

// ── Full Registration Flow ─────────────────────────────────────

/**
 * Complete FCM setup: request permission, get token, register it.
 * Safe to call multiple times — skips if already registered.
 *
 * Returns the device token, or null if setup failed.
 */
export async function registerDeviceToken(): Promise<string | null> {
  const user = useAppStore.getState().user;
  if (!user?.id) {
    console.log('[FCM] No user logged in — skipping device token registration');
    return null;
  }

  if (!isFcmAvailable()) {
    console.log('[FCM] Not available in this browser/context');
    return null;
  }

  // Request permission if needed
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    console.log('[FCM] Notification permission not granted:', permission);
    return null;
  }

  // Get FCM token
  const token = await getFcmToken();
  if (!token) {
    console.log('[FCM] No token obtained');
    return null;
  }

  // Persist in Firestore
  await persistDeviceToken(token);

  // Setup foreground message listener to suppress duplicate notifications
  await setupForegroundMessageListener();

  console.log('[FCM] Device token registration complete');
  return token;
}

/**
 * Unregister all device tokens and cleanup listeners.
 * Called on logout.
 */
export async function unregisterDeviceTokens(): Promise<void> {
  removeForegroundMessageListener();
  await deactivateDeviceTokens();
  swRegistration = null;
  fcmInitialized = false;
  console.log('[FCM] Device tokens unregistered');
}

export default {
  registerDeviceToken,
  unregisterDeviceTokens,
  requestNotificationPermission,
  getNotificationPermission,
  getFcmToken,
  registerServiceWorker,
  refreshDeviceToken,
  removeForegroundMessageListener,
  deactivateDeviceTokens,
  getVapidKey,
  isFcmAvailable,
};
