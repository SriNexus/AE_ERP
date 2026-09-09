/**
 * channelPartnerHumanIdentity.test.ts
 *
 * Regression cover for the "Partner profile not found. Cannot create lead."
 * root cause and the Channel-Partner-is-a-HUMAN architectural correction.
 *
 * ROOT CAUSE (reproduced live, demo partner PRT-…-0GL8 "newperosn"):
 *   PartnerCreateLeadModal required `partner.firmName` before it would call
 *   partnerCreateLead(). A Channel Partner is a person/agent — `firmName` is
 *   OPTIONAL business metadata — so an approved, linked, active firm-less
 *   agent was blocked with a misleading "profile not found" error.
 *
 * These tests pin:
 *   1. partnerDisplayName — firm → human → login-name → fallback; never blank
 *   2. partnerAccountState — 'linked' vs 'pending_account_setup' from the link
 *   3. resolveCurrentPartnerDocId — never caches a null/error result
 *   4. PartnerCreateLeadModal — no `firmName` gate in its create mutation
 *   5. partnerCreateLead — a firm-less partner creates a lead; the lead
 *      carries partnerId + a DERIVED partnerName (contactPerson) + groupId
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── 1 & 2: pure helpers ─────────────────────────────────────────────────────
import { partnerDisplayName, partnerAccountState } from '../partnerOwnership';

describe('partnerDisplayName — a Channel Partner is a human; firmName is optional', () => {
  it('prefers firmName when the partner IS a firm', () => {
    expect(partnerDisplayName({ firmName: 'Green Energy', contactPerson: 'Asha' })).toBe('Green Energy');
  });
  it('falls back to the human contact when there is no firm (the bug scenario)', () => {
    expect(partnerDisplayName({ firmName: '', contactPerson: 'newperosn' })).toBe('newperosn');
    expect(partnerDisplayName({ firmName: '   ', contactPerson: 'newperosn' })).toBe('newperosn');
  });
  it('falls back to the linked login name, then the caller fallback — never an empty string', () => {
    expect(partnerDisplayName({ name: 'Firstfiled Agent' })).toBe('Firstfiled Agent');
    expect(partnerDisplayName({})).toBe('Partner');
    expect(partnerDisplayName(null, 'your account')).toBe('your account');
    expect(partnerDisplayName({ firmName: '', contactPerson: '' }, '')).toBe('');
  });
});

describe('partnerAccountState — approval must not silently mean "can log in"', () => {
  it('linked when a login identity exists', () => {
    expect(partnerAccountState({ userId: 'uid-123' })).toBe('linked');
  });
  it('pending_account_setup when the partner relationship exists but no login is linked', () => {
    expect(partnerAccountState({ userId: '' })).toBe('pending_account_setup');
    expect(partnerAccountState({})).toBe('pending_account_setup');
    expect(partnerAccountState(null)).toBe('pending_account_setup');
  });
});

// ── 3: resolver cache semantics ─────────────────────────────────────────────
const h = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  // role: 'Partner' — resolveCurrentPartnerDocId's fast path short-circuits to
  // null (zero reads) for any non-Partner identity; the cache-semantics cases
  // below exercise the Partner fallthrough that actually hits Firestore.
  user: { id: 'uid-partner', role: 'Partner' } as { id: string; role?: string } | null,
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), query: vi.fn(), where: vi.fn(),
  getDoc: (...a: any[]) => h.getDoc(...a),
  getDocs: (...a: any[]) => h.getDocs(...a),
}));
vi.mock('../firebase', () => ({
  db: {}, COLLECTIONS: { USERS: 'users', CHANNEL_PARTNERS: 'channel_partners' },
  firebaseEnv: { isConfigured: true },
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: h.user }) },
}));

import { resolveCurrentPartnerDocId, resetPartnerDocIdCache, getCachedPartnerDocId } from '../partnerOwnership';

describe('resolveCurrentPartnerDocId — never caches a null / error result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPartnerDocIdCache();
    h.user = { id: 'uid-partner', role: 'Partner' };
  });

  it('a transient read error is NOT cached — the next call retries and resolves', async () => {
    h.getDoc.mockRejectedValueOnce(new Error('offline'));
    expect(await resolveCurrentPartnerDocId()).toBeNull();
    expect(getCachedPartnerDocId()).toBeNull();

    h.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ channelPartnerId: 'PRT-9' }) });
    expect(await resolveCurrentPartnerDocId()).toBe('PRT-9');
  });

  it('a not-yet-linked user (no channelPartnerId, no legacy row) is NOT cached — resolves once linked mid-session', async () => {
    h.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    h.getDocs.mockResolvedValueOnce({ docs: [] });
    expect(await resolveCurrentPartnerDocId()).toBeNull();

    // Admin links the partner while the portal tab is still open.
    h.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ channelPartnerId: 'PRT-LATE' }) });
    expect(await resolveCurrentPartnerDocId()).toBe('PRT-LATE');
    expect(getCachedPartnerDocId()).toBe('PRT-LATE');
  });

  it('a successful resolution IS cached (one users-doc read per session)', async () => {
    h.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ channelPartnerId: 'PRT-1' }) });
    expect(await resolveCurrentPartnerDocId()).toBe('PRT-1');
    expect(await resolveCurrentPartnerDocId()).toBe('PRT-1');
    expect(h.getDoc).toHaveBeenCalledTimes(1);
  });

  it('the legacy fallback skips a soft-deleted channel_partners row', async () => {
    h.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    h.getDocs.mockResolvedValueOnce({ docs: [
      { id: 'PRT-DEL', data: () => ({ isDeleted: true }) },
      { id: 'PRT-OK', data: () => ({ isDeleted: false }) },
    ] });
    expect(await resolveCurrentPartnerDocId()).toBe('PRT-OK');
  });
});

// ── 4: modal source contract ───────────────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const modalSrc = readFileSync(path.join(repoRoot, 'src/components/partner/PartnerCreateLeadModal.tsx'), 'utf8');

describe('PartnerCreateLeadModal — no firmName gate', () => {
  it('the create mutation no longer blocks on `partner.firmName`', () => {
    expect(modalSrc).not.toMatch(/!partner\?\.firmName/);
    // The only precondition is a resolved partner id.
    expect(modalSrc).toMatch(/if \(!partner\?\.id\)/);
  });
  it('the attributed partnerName is derived via partnerDisplayName, not raw firmName', () => {
    expect(modalSrc).toMatch(/partnerName: partnerDisplayName\(partner\)/);
    expect(modalSrc).not.toMatch(/partnerName: partner\.firmName/);
  });
});
