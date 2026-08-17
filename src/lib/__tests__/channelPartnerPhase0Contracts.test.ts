/**
 * channelPartnerPhase0Contracts.test.ts — PHASE 0 (Channel Partner) DATA MODEL
 * CONTRACT tests.
 *
 * Locks the canonical contracts required by later phases, per
 * docs/COMPLETE_CHANNEL_PARTNER/CHANNEL_PARTNER_COMPLETE_IMPLEMENTATION_SPECIFICATION.md §37 Phase 0:
 *   - the `SchemeRegistration` stage value + position (index 1, between `New`
 *     and `Survey`, 17 → 18 stages),
 *   - the `scheme_registrations` collection constant — distinct from the
 *     retained loan `registrations` collection,
 *   - the reserved `payouts` / `scheme_registration` module names,
 *   - the compile-time field contracts (ChannelPartner.managerId,
 *     ProjectRecord.partnerId/partnerName).
 *
 * This is a TYPE-LEVEL test: the const assignments below fail `tsc` if the
 * fields/stage values do not exist on their interfaces — that IS the test.
 */
import { describe, expect, it } from 'vitest';
import { PROJECT_STAGE_ORDER } from '../projectLifecycle';
import { COLLECTIONS } from '../firebase';
import { ALL_MODULES, type Module } from '../permissions';
import type { ProjectStage } from '../../types';
import type { ChannelPartner } from '../../features/channel-partner/types';
import type { ProjectRecord } from '../../features/projects/types';

// ── Compile-time type-level contract (fails tsc on any drift) ────────────────
const stageValue: ProjectStage = 'SchemeRegistration';
const moduleA: Module = 'payouts';
const moduleB: Module = 'scheme_registration';
const managerKey: keyof ChannelPartner = 'managerId';
const partnerIdKey: keyof ProjectRecord = 'partnerId';
const partnerNameKey: keyof ProjectRecord = 'partnerName';
const userIdKey: keyof ChannelPartner = 'userId';
// Silence no-unused-vars on the type probes (kept for tsc, not runtime use).
void stageValue; void moduleA; void moduleB;
void managerKey; void partnerIdKey; void partnerNameKey; void userIdKey;

describe('Phase 0 — canonical stage contract: New → SchemeRegistration → Survey', () => {
  it('inserts SchemeRegistration at index 1, between New and Survey (17 → 18 stages)', () => {
    expect(PROJECT_STAGE_ORDER).toHaveLength(18);
    expect(PROJECT_STAGE_ORDER[0]).toBe('New');
    expect(PROJECT_STAGE_ORDER[1]).toBe('SchemeRegistration');
    expect(PROJECT_STAGE_ORDER[2]).toBe('Survey');
  });

  it('keeps every pre-existing stage and its relative order intact', () => {
    expect(PROJECT_STAGE_ORDER).toEqual([
      'New', 'SchemeRegistration', 'Survey', 'Engineering', 'Quotation', 'Order', 'Procurement', 'Dispatch',
      'Installation', 'QC', 'Commissioning', 'NetMetering', 'Subsidy', 'Handover',
      'AMC', 'Service', 'Monitoring', 'Archived',
    ]);
  });

  it('does NOT use any vendor-lock business description as the stage value', () => {
    // Naming contract: the stage value is `SchemeRegistration`; the user-facing
    // label ("Registration") is a display concern only (projectDisplay.ts).
    for (const banned of ['VendorLock', 'VendorRegistration', 'PortalRegistration', 'SchemeRegistrationUI', 'Registration']) {
      expect(PROJECT_STAGE_ORDER.includes(banned as ProjectStage)).toBe(false);
    }
    expect(PROJECT_STAGE_ORDER.includes('SchemeRegistration')).toBe(true);
  });
});

describe('Phase 0 — collection separation: scheme_registrations ≠ registrations', () => {
  it('SCHEME_REGISTRATIONS = "scheme_registrations" — the NEW Vendor Lock collection', () => {
    expect(COLLECTIONS.SCHEME_REGISTRATIONS).toBe('scheme_registrations');
  });

  it('is NOT the loan module collection (which stays "registrations")', () => {
    expect(COLLECTIONS.SCHEME_REGISTRATIONS).not.toBe('registrations');
    expect(COLLECTIONS.LOAN_APPLICATIONS).toBe('registrations');
  });
});

describe('Phase 0 — reserved module names', () => {
  it('reserves payouts and scheme_registration in ALL_MODULES (action seeds are Phase 2)', () => {
    expect(ALL_MODULES).toContain('payouts');
    expect(ALL_MODULES).toContain('scheme_registration');
  });
});
