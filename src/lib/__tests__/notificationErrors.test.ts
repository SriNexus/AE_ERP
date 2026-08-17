import { describe, expect, it } from 'vitest';
import { notificationErrorMessage } from '../notificationErrors';

describe('notificationErrorMessage — user-safe error classification', () => {
  it('maps permission denials to a safe, actionable message', () => {
    expect(notificationErrorMessage('Missing or insufficient permissions.'))
      .toBe("You don't have permission to view these notifications.");
    expect(notificationErrorMessage('PERMISSION_DENIED'))
      .toBe("You don't have permission to view these notifications.");
  });

  it('maps index errors to the infrastructure message without exposing URLs', () => {
    const raw = 'The query requires an index. https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc';
    const mapped = notificationErrorMessage(raw);
    expect(mapped).toContain('required database index');
    expect(mapped).not.toContain('console.firebase.google.com');
  });

  it('maps network failures to the connectivity message', () => {
    expect(notificationErrorMessage('Failed to fetch')).toContain('Check your connection');
    expect(notificationErrorMessage('Network error: unavailable')).toContain('Check your connection');
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(notificationErrorMessage('Something exploded')).toBe("Couldn't load notifications. Please try again.");
  });

  it('handles null/undefined gracefully', () => {
    expect(notificationErrorMessage(null)).toBe("Couldn't load notifications. Please try again.");
    expect(notificationErrorMessage(undefined)).toBe("Couldn't load notifications. Please try again.");
    expect(notificationErrorMessage('')).toBe("Couldn't load notifications. Please try again.");
  });
});
