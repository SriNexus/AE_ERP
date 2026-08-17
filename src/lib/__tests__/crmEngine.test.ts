import { describe, it, expect } from 'vitest';
import {
  communicationLabel,
  communicationColor,
} from '../crmEngine';
import type { CommunicationType } from '../crmEngine';

// ═══════════════════════════════════════════════════════════
//  communicationLabel
// ═══════════════════════════════════════════════════════════
describe('communicationLabel', () => {
  const cases: [CommunicationType, string][] = [
    ['phone', 'Phone Call'],
    ['whatsapp', 'WhatsApp'],
    ['email', 'Email'],
    ['sms', 'SMS'],
    ['site_visit', 'Site Visit'],
    ['office_meeting', 'Office Meeting'],
    ['installation_visit', 'Installation Visit'],
  ];

  it.each(cases)('returns correct label for %s', (type, expected) => {
    expect(communicationLabel(type)).toBe(expected);
  });

  it('falls back to title-cased string for unknown type', () => {
    const result = communicationLabel('slack_message' as any);
    // Should convert underscores to spaces and title-case
    expect(result).toBe('Slack Message');
  });
});

// ═══════════════════════════════════════════════════════════
//  communicationColor
// ═══════════════════════════════════════════════════════════
describe('communicationColor', () => {
  const cases: CommunicationType[] = [
    'phone', 'whatsapp', 'email', 'sms', 'site_visit', 'office_meeting', 'installation_visit',
  ];

  it.each(cases)('returns a non-empty color class for %s', (type) => {
    const color = communicationColor(type);
    expect(color).toBeTruthy();
    expect(typeof color).toBe('string');
    expect(color.length).toBeGreaterThan(0);
  });

  it('returns a fallback color for unknown type', () => {
    const color = communicationColor('unknown_type' as any);
    expect(color).toContain('bg-gray');
  });
});
