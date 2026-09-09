/**
 * partnerEligibility.test.ts
 *
 * RBAC Master Implementation Plan §15 BD-3 — OWNER-APPROVED 2026-09-09.
 * Pure-helper coverage for the client defense-in-depth layer:
 *   - `partnerCanCreateNewRecords` / `partnerCreateBlockReason` /
 *     `assertPartnerCanCreate`
 *   - the rewritten `validatePartnerCanAct` (KYC now advisory)
 */
import { describe, it, expect } from 'vitest';
import {
  partnerCanCreateNewRecords,
  partnerCreateBlockReason,
  assertPartnerCanCreate,
} from '../partnerEligibility';

describe('BD-3 — partnerCanCreateNewRecords', () => {
  it('active partner → true', () => {
    expect(partnerCanCreateNewRecords({ status: 'active' })).toBe(true);
  });
  it('missing status (legacy doc) → true (grandfathered)', () => {
    expect(partnerCanCreateNewRecords({})).toBe(true);
    expect(partnerCanCreateNewRecords({ status: undefined })).toBe(true);
  });
  it('capitalised "Active" tolerated → true', () => {
    expect(partnerCanCreateNewRecords({ status: 'Active' as any })).toBe(true);
  });
  it('suspended → false', () => {
    expect(partnerCanCreateNewRecords({ status: 'suspended' })).toBe(false);
  });
  it('inactive → false', () => {
    expect(partnerCanCreateNewRecords({ status: 'inactive' })).toBe(false);
  });
  it('pending_approval → false', () => {
    expect(partnerCanCreateNewRecords({ status: 'pending_approval' })).toBe(false);
  });
  it('isDeleted → false regardless of status', () => {
    expect(partnerCanCreateNewRecords({ status: 'active', isDeleted: true })).toBe(false);
  });
  it('null / undefined partner → false (fail closed)', () => {
    expect(partnerCanCreateNewRecords(null)).toBe(false);
    expect(partnerCanCreateNewRecords(undefined)).toBe(false);
  });
  it('KYC status is irrelevant — a KYC-rejected active partner can still create', () => {
    // partnerEligibility never sees kycStatus; prove the shape a caller passes
    // (status only) is all that matters.
    expect(partnerCanCreateNewRecords({ status: 'active', isDeleted: false } as any)).toBe(true);
  });
});

describe('BD-3 — partnerCreateBlockReason', () => {
  it('active → null (no block)', () => {
    expect(partnerCreateBlockReason({ status: 'active' })).toBeNull();
  });
  it('suspended → message mentions suspended + that existing work is fine', () => {
    const r = partnerCreateBlockReason({ status: 'suspended' }, 'creating a lead')!;
    expect(r.toLowerCase()).toContain('suspended');
    expect(r.toLowerCase()).toContain('existing');
    expect(r).toContain('creating a lead');
  });
  it('inactive → deactivated message', () => {
    expect(partnerCreateBlockReason({ status: 'inactive' })).toMatch(/deactivat/i);
  });
  it('pending_approval → pending approval message', () => {
    expect(partnerCreateBlockReason({ status: 'pending_approval' })).toMatch(/pending approval/i);
  });
});

describe('BD-3 — assertPartnerCanCreate', () => {
  it('active → no throw', () => {
    expect(() => assertPartnerCanCreate({ status: 'active' })).not.toThrow();
  });
  it('suspended → throws with code PARTNER_NOT_ELIGIBLE', () => {
    try {
      assertPartnerCanCreate({ status: 'suspended' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('PARTNER_NOT_ELIGIBLE');
    }
  });
  it('inactive → throws', () => {
    expect(() => assertPartnerCanCreate({ status: 'inactive' })).toThrow();
  });
});

// ── validatePartnerCanAct — the rewritten semantics (structural) ──────
// channelPartnerWorkflow.ts pulls a heavy Firebase module graph; the runtime
// logic under test now lives entirely in partnerEligibility.assertPartnerCanCreate
// (covered above). Here we pin the SOURCE-level contract: the helper delegates
// to assertPartnerCanCreate and no longer blocks on kycStatus.
import { readFileSync } from 'node:fs';

describe('BD-3 — validatePartnerCanAct source contract', () => {
  const src = readFileSync(new URL('../channelPartnerWorkflow.ts', import.meta.url), 'utf8');

  it('delegates the eligibility decision to assertPartnerCanCreate', () => {
    expect(src).toContain("import { assertPartnerCanCreate } from './partnerEligibility'");
    expect(src).toMatch(/validatePartnerCanAct[\s\S]{0,400}assertPartnerCanCreate\(/);
  });

  it('no longer blocks on kycStatus (KYC is advisory per the owner decision)', () => {
    const fn = src.slice(src.indexOf('export async function validatePartnerCanAct'), src.indexOf('export async function validatePartnerCanCreateLead'));
    expect(fn).not.toMatch(/kycStatus/);
    expect(fn).not.toMatch(/KYC verification is required/);
  });

  it('validatePartnerCanCreateLead is still a thin alias of validatePartnerCanAct', () => {
    expect(src).toMatch(/validatePartnerCanCreateLead[\s\S]{0,200}return validatePartnerCanAct\(partnerId\)/);
  });
});

// ── BD-3 enforcement points — structural coverage ─────────────────────
describe('BD-3 — enforcement is wired at every plane', () => {
  const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');

  it('firestore.rules: partnerCreateEligible() gates leads / customers / projects create', () => {
    expect(rules).toMatch(/function partnerCreateEligible\(\)[\s\S]{0,200}channelPartnerStatusActive\(currentUser\(\)\.get\('channelPartnerId', ''\)\)/);
    // exactly the three lean-create collections carry the term
    const gated = [...rules.matchAll(/allow create: if actorIsActive\(\) && partnerCreateEligible\(\)/g)];
    expect(gated.length).toBe(3);
  });

  it('firestore.rules: scheme_registrations BD-3 gate is inside schemeRegPartnerOwnsProject (channelPartnerStatusActive on the actor-verified data.partnerId)', () => {
    const fn = rules.slice(rules.indexOf('function schemeRegPartnerOwnsProject'), rules.indexOf('}', rules.indexOf('function schemeRegPartnerOwnsProject')));
    expect(fn).toMatch(/channelPartnerStatusActive\(data\.partnerId\)/);
  });

  it('firestore.rules: channelPartnerStatusActive grandfathers a missing status and fails closed otherwise', () => {
    const start = rules.indexOf('function channelPartnerStatusActive');
    const fn = rules.slice(start, rules.indexOf('\n    }', start));
    expect(fn).toMatch(/\.get\('status', 'active'\) in \['active', 'Active'\]/);
    expect(fn).toMatch(/exists\(\/databases\/\$\(database\)\/documents\/channel_partners\/\$\(cpId\)\)/);
    expect(fn).not.toMatch(/kyc/i); // KYC is NEVER read by the gate
  });

  it('firestore.rules: the CREATE gate never appears on any update/delete rule', () => {
    expect(rules).not.toMatch(/allow update:[^\n]*partnerCreateEligible/);
    expect(rules).not.toMatch(/allow delete:[^\n]*partnerCreateEligible/);
  });

  it('partnerLeadIntegration.ts: partnerCreateLead asserts eligibility for the authenticated partner, generateCommissionRecord skips an inactive partner', () => {
    const pli = readFileSync(new URL('../partnerLeadIntegration.ts', import.meta.url), 'utf8');
    expect(pli).toMatch(/assertPartnerCanCreate\(partnerRecord, 'creating a lead'\)/);
    expect(pli).toContain("commissionPartner.status === 'inactive'");
    // the inactive branch returns null (no new commission for a terminated partner)
    const gen = pli.slice(pli.indexOf('export async function generateCommissionRecord'));
    expect(gen).toMatch(/commissionPartner && \(commissionPartner\.status === 'inactive'[\s\S]{0,500}return null/);
  });

  it('ChannelPartnerDomainService.ts: transitioning a partner to "inactive" also deactivates the linked login', () => {
    const svc = readFileSync(new URL('../../services/ChannelPartnerDomainService.ts', import.meta.url), 'utf8');
    expect(svc).toMatch(/newStatus === 'inactive'[\s\S]{0,200}status: 'Inactive'/);
    expect(svc).toMatch(/partner\?\.status === 'inactive' && newStatus !== 'inactive'[\s\S]{0,200}status: 'Active'/);
  });
});
