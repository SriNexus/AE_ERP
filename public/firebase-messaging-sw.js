/**
 * firebase-messaging-sw.js — Firebase Cloud Messaging Service Worker
 *
 * Handles background push notifications for the Neozy ERP.
 * Registers Firebase Messaging and displays notifications
 * when the app is in the background or closed.
 *
 * Requirements:
 *   - Firebase project with Cloud Messaging enabled
 *   - VAPID key configured in Firebase Console > Cloud Messaging > Web Push certificates
 *   - Environment variable VITE_FIREBASE_VAPID_KEY set in .env
 *
 * This file should be placed in the public/ directory so it is served
 * at /firebase-messaging-sw.js and can be registered from the app.
 */

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Firebase configuration — injected at build time via __FIREBASE_CONFIG__
// In production, this is replaced at deploy time.
// In development, ensure VITE_FIREBASE_* env vars are set.
self.__FIREBASE_CONFIG__ = self.__FIREBASE_CONFIG__ || {
  apiKey: null,
  authDomain: null,
  projectId: null,
  storageBucket: null,
  messagingSenderId: null,
  appId: null,
};

firebase.initializeApp(self.__FIREBASE_CONFIG__);

const messaging = firebase.messaging();

/**
 * Background message handler.
 * Fired when a push notification arrives while the app is in the background
 * or closed. The service worker displays the notification.
 */
messaging.onBackgroundMessage((payload) => {
  console.log('[Neozy SW] Background message received:', payload);

  const { notification, data } = payload;

  if (!notification) return;

  const notificationTitle = notification.title || 'Neozy ERP';
  const notificationOptions = {
    body: notification.body || '',
    icon: notification.icon || '/favicon.ico',
    badge: notification.badge || '/favicon.ico',
    tag: data?.entityId || notification.title || 'neozy-notification',
    data: {
      url: data?.url || '/',
      entityType: data?.entityType || '',
      entityId: data?.entityId || '',
      notificationId: data?.notificationId || '',
      clickAction: data?.clickAction || 'open',
    },
    requireInteraction: true,
    vibrate: [200, 100, 200],
    // Timestamp for ordering
    timestamp: Date.now(),
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

/**
 * Notification click handler.
 * Opens the relevant entity page when the user clicks a notification.
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[Neozy SW] Notification clicked:', event.notification);

  const clickedNotification = event.notification;
  const data = clickedNotification.data || {};
  const urlToOpen = data.url || '/';

  clickedNotification.close();

  // Determine target URL from notification data
  const entityType = data.entityType || '';
  const entityId = data.entityId || '';

  let targetUrl = urlToOpen;
  if (entityType && entityId && !targetUrl.includes(entityId)) {
    // Build deep link URL based on entity type
    const routeMap = {
      lead: '/leads/',
      customer: '/customers/',
      project: '/projects/',
      quotation: '/quotations/',
      order: '/orders/',
      payment: '/payments/',
      dispatch: '/dispatch/',
      task: '/tasks/',
      case: '/cases/',
      partner: '/partners/',
      notification: '/notifications/',
      service_ticket: '/service-tickets/',
      invoice: '/invoices/',
      pi: '/invoices/',
      tax_invoice: '/tax-invoices/',
    };
    const basePath = routeMap[entityType] || '/';
    targetUrl = `${basePath}${encodeURIComponent(entityId)}`;
  }

  // Open or focus the app window
  const promiseChain = clients
    .matchAll({
      type: 'window',
      includeUncontrolled: true,
    })
    .then((windowClients) => {
      // If an existing window is open, focus it and navigate
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    });

  event.waitUntil(promiseChain);
});

/**
 * Push subscription change handler.
 * Fired when the push subscription changes (e.g., expired, renewed).
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[Neozy SW] Push subscription changed:', event);

  // The app will re-register the token on next page load
  // This event is handled by the FCM SDK internally
  event.waitUntil(
    Promise.resolve().then(() => {
      console.log('[Neozy SW] Push subscription updated — awaiting re-registration');
    })
  );
});

console.log('[Neozy SW] Firebase Messaging Service Worker initialized');
