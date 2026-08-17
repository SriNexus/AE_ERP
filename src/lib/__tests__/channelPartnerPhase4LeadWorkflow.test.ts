/**
 * channelPartnerPhase4LeadWorkflow.test.ts — Phase 4 (Partner Lead Workflow) tests
 *
 * Covers the Phase 4 contract on top of the completed Phase 0–3 foundation:
 *   - filterPartnerOwnedLeads: the canonical partner-lead ownership predicate
 *     (partner DOC id match + non-deleted) adopted by the Partner Portal
 *     (desktop + mobile) and the internal Leads drill-down (G12), giving all
 *     partner lead surfaces one shared ownership contract
 *   - G12 drill-down contract: a `partnerId`-scoped query yields exactly the
 *     owning partner's leads and nothing else
 *   - Demo coherence: the demo partner commission records reference leads that
 *     actually carry the owning partner's partnerId (LEAD,4 → PART,1 and
 *     LEAD,5 → PART,2, source 'Partner'), so the drill-down demonstrates the
 *     real graph in Demo Mode
 *   - TEST-matrix assertions for the ownership/identity invariants the UI
 *     relies on (own-lead visibility, no cross-partner claiming)
 */

import { describe, it, expect } from 'vitest';
import { filterPartnerOwnedLeads } from '../partnerOwnership';
import { buildCompleteDemoPlan } from '../../../scripts/demo/datasets/complete';
import { DEMO_COMPANY_ID, demoDocumentId } from '../../../scripts/demo/config';

// ── Canonical filter helper ──────────────────────────────────

describe('filterPartnerOwnedLeads — canonical partner-lead ownership predicate', () => {
  const leads = [
    { id: 'L1', partnerId: 'PART-1', isDeleted: false },
    { id: 'L2', partnerId: 'PART-1', isDeleted: false },
    { id: 'L3', partnerId: 'PART-2', isDeleted: false },
    { id: 'L4', partnerId: 'PART-1', isDeleted: true },
    { id: 'L5' }, // no partner attribution
  ];

  it('returns exactly the non-deleted leads of the owning partner', () => {
    const result = filterPartnerOwnedLeads(leads, 'PART-1');
    expect(result.map((l) => l.id)).toEqual(['L1', 'L2']);
  });

  it('does NOT include another partner-owned lead (TEST 5)', () => {
    const result = filterPartnerOwnedLeads(leads, 'PART-1');
    expect(result.some((l) => l.id === 'L3')).toBe(false);
  });

  it('excludes deleted leads and leads without partner attribution', () => {
    const result = filterPartnerOwnedLeads(leads, 'PART-1');
    expect(result.some((l) => l.id === 'L4')).toBe(false);
    expect(result.some((l) => l.id === 'L5')).toBe(false);
  });

  it('returns [] for a missing/empty partner id (no accidental all-leads leak)', () => {
    expect(filterPartnerOwnedLeads(leads, '')).toEqual([]);
    expect(filterPartnerOwnedLeads(leads, undefined)).toEqual([]);
    expect(filterPartnerOwnedLeads(leads, null)).toEqual([]);
  });

  it('returns [] for null/undefined lead lists', () => {
    expect(filterPartnerOwnedLeads(null, 'PART-1')).toEqual([]);
    expect(filterPartnerOwnedLeads(undefined, 'PART-1')).toEqual([]);
  });

  it('is tenant-agnostic (partnerId matching is the contract; company scoping stays in the data layer)', () => {
    const crossTenant = [
      { id: 'X1', partnerId: 'PART-1', companyId: 'company-A', isDeleted: false },
      { id: 'X2', partnerId: 'PART-1', companyId: 'company-B', isDeleted: false },
    ];
    // Both records match by partnerId — the helper deliberately does NOT
    // decide tenant policy; the Firestore query layer enforces companyId.
    expect(filterPartnerOwnedLeads(crossTenant, 'PART-1')).toHaveLength(2);
  });
});

// ── G12 drill-down contract ──────────────────────────────────

describe('G12 partner→leads drill-down contract', () => {
  it('a partnerId-scoped query surfaces only that partner-owned leads (TEST 4)', () => {
    const own = [
      { id: 'A1', partnerId: 'PART-A', isDeleted: false },
      { id: 'A2', partnerId: 'PART-A', isDeleted: false },
    ];
    expect(filterPartnerOwnedLeads(own, 'PART-A').map((l) => l.id)).toEqual(['A1', 'A2']);
  });

  it('an unrelated partner cannot claim the same leads through the drill-down (TEST 5)', () => {
    const drill = filterPartnerOwnedLeads(
      [{ id: 'A1', partnerId: 'PART-A', isDeleted: false }],
      'PART-B',
    );
    expect(drill).toEqual([]);
  });
});

// ── Demo Mode coherence ──────────────────────────────────────

describe('Demo Mode — partner-owned leads exist and carry the owning partnerId', () => {
  const plan = () => buildCompleteDemoPlan('TEST-AUTH-UID');
  const docs = (collection: string) => plan().documents.filter((d) => d.collection === collection);

  it('LEAD,4 is owned by PART,1 and LEAD,5 by PART,2 (matching commission records)', () => {
    const leads = docs('leads');
    const lead4 = leads.find((d: any) => d.id === demoDocumentId('LEAD', 4));
    const lead5 = leads.find((d: any) => d.id === demoDocumentId('LEAD', 5));

    expect(lead4).toBeTruthy();
    expect(lead5).toBeTruthy();
    expect(lead4!.data.partnerId).toBe(demoDocumentId('PART', 1));
    expect(lead5!.data.partnerId).toBe(demoDocumentId('PART', 2));
    expect(lead4!.data.source).toBe('Partner');
    expect(lead5!.data.source).toBe('Partner');
    expect(lead4!.data.companyId).toBe(DEMO_COMPANY_ID);
    expect(lead5!.data.companyId).toBe(DEMO_COMPANY_ID);
  });

  it('commission records point at leads that are genuinely partner-owned (graph integrity)', () => {
    const commissions = docs('commission_records');
    const leads = docs('leads');
    expect(commissions.length).toBeGreaterThanOrEqual(2);
    for (const rec of commissions) {
      const leadId = String(rec.data.leadId ?? '');
      const lead = leads.find((d: any) => d.id === leadId);
      expect(lead, `commission ${rec.id} references lead ${leadId}`).toBeTruthy();
      // The lead's stored partnerId must match the commission's partnerId —
      // the drill-down and partner portal both filter on the LEAD field.
      expect(lead?.data.partnerId).toBe(rec.data.partnerId);
      expect(rec.data.partnerId).toMatch(/^DEMO-V1-PART-/);
    }
  });

  it('demo partners are linked per Phase 1 (PART,1 ↔ demo operator user)', () => {
    const partners = docs('channel_partners');
    const p1 = partners.find((d: any) => d.data.firmName === 'GreenLeaf Solar Consultants');
    expect(p1).toBeTruthy();
    // PART,1 carries the demo operator link from Phase 1; PART,2 stays unlinked
    // to exercise the unlinked partner state in Demo Mode.
    expect(String(p1?.data.userId ?? '')).not.toBe('');
  });
});
