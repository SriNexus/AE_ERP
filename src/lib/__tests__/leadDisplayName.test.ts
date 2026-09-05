import { describe, expect, it } from 'vitest';
import { leadDisplayName, leadInitial } from '../leadDisplayName';

/**
 * PartnerDashboard.tsx crash regression — `(lead.name ?? '?')[0].toUpperCase()`
 * threw "Cannot read properties of undefined (reading 'toUpperCase')" for a
 * phone-only Channel Partner lead (`lead.name === ''`): `??` only guards
 * `null`/`undefined`, never an empty string, so `''[0]` -> `undefined` ->
 * `.toUpperCase()` crashed. `leadInitial`/`leadDisplayName` are the fix —
 * these tests prove the exact previously-crashing shape now renders safely.
 */
describe('leadDisplayName / leadInitial — PartnerDashboard crash regression', () => {
  it('a populated name renders unchanged (existing valid data)', () => {
    expect(leadDisplayName({ name: 'Ramesh Kumar', phone: '9999999999' })).toBe('Ramesh Kumar');
    expect(leadInitial({ name: 'Ramesh Kumar', phone: '9999999999' })).toBe('R');
  });

  it('a blank name (the actual crashing case — a phone-only Channel Partner lead) falls back to phone, never throws', () => {
    expect(leadDisplayName({ name: '', phone: '9876543210' })).toBe('9876543210');
    expect(() => leadInitial({ name: '', phone: '9876543210' })).not.toThrow();
    expect(leadInitial({ name: '', phone: '9876543210' })).toBe('9');
  });

  it('an undefined name (never even a "name" field on the record) falls back to phone, never throws', () => {
    expect(leadDisplayName({ phone: '9876543210' })).toBe('9876543210');
    expect(() => leadInitial({ phone: '9876543210' })).not.toThrow();
  });

  it('a whitespace-only name is treated as blank, not as a literal space avatar letter', () => {
    expect(leadDisplayName({ name: '   ', phone: '9876543210' })).toBe('9876543210');
  });

  it('neither name nor phone present falls back to a clear placeholder, never throws', () => {
    expect(leadDisplayName({})).toBe('Unnamed Lead');
    expect(() => leadInitial({})).not.toThrow();
    expect(leadInitial({})).toBe('U');
  });

  it('null/undefined lead itself never throws', () => {
    expect(leadDisplayName(null)).toBe('Unnamed Lead');
    expect(leadDisplayName(undefined)).toBe('Unnamed Lead');
    expect(() => leadInitial(null)).not.toThrow();
  });

  it('non-string name/phone values (defensive — malformed data) never throw', () => {
    expect(() => leadInitial({ name: 123 as any, phone: null as any })).not.toThrow();
    expect(leadDisplayName({ name: 123 as any, phone: null as any })).toBe('Unnamed Lead');
  });
});
