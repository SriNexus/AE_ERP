import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveCustomerHeaderFields, hasActiveBatch } from '../CustomerWorkspaceHeader';

const headerSrc = readFileSync(resolve(__dirname, '../CustomerWorkspaceHeader.tsx'), 'utf-8');
const leadWorkspaceSrc = readFileSync(resolve(__dirname, '../../../../../pages/LeadWorkspace.tsx'), 'utf-8');

describe('resolveCustomerHeaderFields — B2B', () => {
  it('prefers name, then falls back to fullName/contactPerson', () => {
    expect(resolveCustomerHeaderFields({ type: 'B2B', name: 'Acme Corp', contactPerson: 'Ignored' }).displayName).toBe('Acme Corp');
    expect(resolveCustomerHeaderFields({ type: 'B2B', contactPerson: 'Priya Sharma' }).displayName).toBe('Priya Sharma');
    expect(resolveCustomerHeaderFields({ type: 'B2B' }).displayName).toBe('Unnamed');
  });

  it('shows a company name for B2B, from company or companyName', () => {
    expect(resolveCustomerHeaderFields({ type: 'B2B', company: 'Sharma Solar' }).companyName).toBe('Sharma Solar');
    expect(resolveCustomerHeaderFields({ type: 'B2B', companyName: 'Sharma Solar Pvt Ltd' }).companyName).toBe('Sharma Solar Pvt Ltd');
    expect(resolveCustomerHeaderFields({ type: 'B2B' }).companyName).toBeUndefined();
  });

  it('resolves phone from phone, then mobile, then businessPhone', () => {
    expect(resolveCustomerHeaderFields({ type: 'B2B', phone: '111', mobile: '222', businessPhone: '333' }).phone).toBe('111');
    expect(resolveCustomerHeaderFields({ type: 'B2B', businessPhone: '333' }).phone).toBe('333');
    expect(resolveCustomerHeaderFields({ type: 'B2B' }).phone).toBe('');
  });

  it('resolves email from email, then businessEmail', () => {
    expect(resolveCustomerHeaderFields({ type: 'B2B', email: 'a@x.com', businessEmail: 'b@x.com' }).email).toBe('a@x.com');
    expect(resolveCustomerHeaderFields({ type: 'B2B', businessEmail: 'b@x.com' }).email).toBe('b@x.com');
  });

  it('defaults status to Active and type to B2B when absent', () => {
    const fields = resolveCustomerHeaderFields({});
    expect(fields.status).toBe('Active');
    expect(fields.type).toBe('B2B');
    expect(fields.isB2B).toBe(true);
  });

  it('resolves missing optional values (city, assignedToName, sourceLeadId) to undefined, not empty strings', () => {
    const fields = resolveCustomerHeaderFields({ type: 'B2B', name: 'Acme' });
    expect(fields.city).toBeUndefined();
    expect(fields.assignedToName).toBeUndefined();
    expect(fields.sourceLeadId).toBeUndefined();
  });
});

describe('resolveCustomerHeaderFields — B2C', () => {
  it('never shows a company name for B2C, even if a company-shaped field exists', () => {
    const fields = resolveCustomerHeaderFields({ type: 'B2C', company: 'Should Not Show', name: 'Ravi Kumar' });
    expect(fields.isB2B).toBe(false);
    expect(fields.companyName).toBeUndefined();
  });

  it('resolves identity from name/fullName for a residential customer', () => {
    expect(resolveCustomerHeaderFields({ type: 'B2C', fullName: 'Ravi Kumar' }).displayName).toBe('Ravi Kumar');
  });

  it('resolves phone from mobile for a B2C-created record', () => {
    expect(resolveCustomerHeaderFields({ type: 'B2C', mobile: '9998887770' }).phone).toBe('9998887770');
  });

  it('surfaces sourceLeadId from either sourceLeadId or leadId', () => {
    expect(resolveCustomerHeaderFields({ type: 'B2C', sourceLeadId: 'LD-1' }).sourceLeadId).toBe('LD-1');
    expect(resolveCustomerHeaderFields({ type: 'B2C', leadId: 'LD-2' }).sourceLeadId).toBe('LD-2');
  });

  it('surfaces assignment and status when present', () => {
    const fields = resolveCustomerHeaderFields({ type: 'B2C', assignedToName: 'Anita', status: 'Inactive' });
    expect(fields.assignedToName).toBe('Anita');
    expect(fields.status).toBe('Inactive');
  });
});

describe('hasActiveBatch — order recorded within the last 30 days', () => {
  const now = new Date('2026-07-31T12:00:00Z').getTime();
  const daysAgo = (n: number) => new Date(now - n * 86400000).toISOString();

  it('true when at least one order date is within the last 30 days', () => {
    expect(hasActiveBatch([{ date: daysAgo(1) }], now)).toBe(true);
    expect(hasActiveBatch([{ date: daysAgo(29) }], now)).toBe(true);
    expect(hasActiveBatch([{ date: daysAgo(30) }], now)).toBe(true);
  });

  it('false when the only order is older than 30 days', () => {
    expect(hasActiveBatch([{ date: daysAgo(31) }], now)).toBe(false);
    expect(hasActiveBatch([{ date: daysAgo(400) }], now)).toBe(false);
  });

  it('false for no orders, empty array, or null/undefined input', () => {
    expect(hasActiveBatch([], now)).toBe(false);
    expect(hasActiveBatch(null as any, now)).toBe(false);
    expect(hasActiveBatch(undefined as any, now)).toBe(false);
  });

  it('true if ANY order (not just the most recent) falls within the window', () => {
    expect(hasActiveBatch([{ date: daysAgo(200) }, { date: daysAgo(5) }, { date: daysAgo(90) }], now)).toBe(true);
  });

  it('falls back to createdAt when date is absent, and ignores unparseable/future dates', () => {
    expect(hasActiveBatch([{ createdAt: daysAgo(2) }], now)).toBe(true);
    expect(hasActiveBatch([{ date: 'not-a-date' }], now)).toBe(false);
    expect(hasActiveBatch([{ date: new Date(now + 5 * 86400000).toISOString() }], now)).toBe(false);
  });
});

describe('Compact Workspace & Header mission — header matches LeadWorkspace.tsx exactly, phone/email text removed', () => {
  it('avatar/name/padding sizing matches LeadWorkspace.tsx\'s own header exactly (h-12 w-12/text-lg avatar, text-xl name, px-6 py-4)', () => {
    for (const cls of ['h-12 w-12', 'text-lg font-bold text-white', 'text-xl font-bold text-[var(--color-text)]', 'px-6 py-4']) {
      expect(leadWorkspaceSrc).toContain(cls);
      expect(headerSrc).toContain(cls);
    }
    // Old, larger one-off sizing must be gone from the actual code — scoped
    // past the top doc comment, which mentions these old values by name
    // when explaining what changed.
    const codeOnly = headerSrc.slice(headerSrc.indexOf('*/') + 2);
    expect(codeOnly).not.toContain('h-16 w-16');
    expect(codeOnly).not.toContain('text-[26px]');
    expect(codeOnly).not.toContain('py-6');
  });

  it('does not render the raw phone number or email text anywhere in the identity strip (the ${phone}/${email} inside the tel:/mailto:/wa.me URLs below are fine — those build hrefs, not visible text)', () => {
    expect(headerSrc).not.toMatch(/>\{phone\}</);
    expect(headerSrc).not.toMatch(/>\{email\}</);
    expect(headerSrc).not.toContain('<Phone className="h-3 w-3" />{phone}');
    expect(headerSrc).not.toContain('<Mail className="h-3 w-3" />{email}');
  });

  it('keeps the Call/WhatsApp/Email quick-action buttons — only the raw text display was removed, not the essential actions', () => {
    expect(headerSrc).toContain('href={`tel:${phone}`}');
    expect(headerSrc).toContain('href={`https://wa.me/');
    expect(headerSrc).toContain('href={`mailto:${email}`}');
  });

  it('Premium UX Redesign mission: header shows exactly one status signal — no separate "Active Batch" badge competing with Type/Status (that signal moved to the B2B pipeline\'s Order stage, which reuses this file\'s hasActiveBatch())', () => {
    expect(headerSrc).not.toContain('ActiveBatchBadge');
    expect(headerSrc).not.toContain('showActiveBatch');
    // hasActiveBatch itself stays — it's a reusable pure function, just no
    // longer called from inside this component.
    expect(headerSrc).toContain('export function hasActiveBatch');
  });

  it('renders city on the identity\'s second line alongside the assigned owner (previously resolved but never rendered)', () => {
    expect(headerSrc).toContain('{city &&');
    expect(headerSrc).toContain('<MapPin');
  });
});
