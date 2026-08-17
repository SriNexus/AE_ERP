type NotificationMetric = 'created' | 'delivered' | 'read' | 'failed' | 'deduplicated' | 'suppressed_by_prefs';

export function trackNotificationMetric(metric: NotificationMetric, details: Record<string, unknown> = {}) {
  console.info('[notifications]', metric, details);
}
