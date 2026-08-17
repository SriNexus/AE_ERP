/**
 * notificationErrors — user-safe classification of notification load failures.
 *
 * The useNotifications hook surfaces raw Firestore error messages; those are
 * never shown verbatim to end users (they can contain project ids, index URLs
 * and security-rule internals). This mapper classifies a raw message into safe,
 * actionable copy. The raw message is still logged to the console by the hook
 * for diagnosis.
 */

export function notificationErrorMessage(rawError: string | null | undefined): string {
  if (!rawError) return "Couldn't load notifications. Please try again.";
  const message = String(rawError).toLowerCase();
  if (message.includes('permission') || message.includes('denied')) {
    return "You don't have permission to view these notifications.";
  }
  if (message.includes('index')) {
    return 'Notifications could not be loaded because a required database index is missing. Please contact your administrator.';
  }
  if (
    message.includes('network')
    || message.includes('offline')
    || message.includes('unavailable')
    || message.includes('failed to fetch')
  ) {
    return "Notifications could not be loaded. Check your connection and try again.";
  }
  return "Couldn't load notifications. Please try again.";
}
