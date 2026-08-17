/**
 * channelPartnerPhase15DemoSeeding.test.ts — CP-15 (Demo Scheme Registrations
 * Seeding) permanent regression tests.
 *
 * CP-15 owns the demo `scheme_registrations` dataset. These tests prove the
 * seeded records are REAL records under the production contract — they use
 * the canonical SchemeRegistration types, the authoritative 8-status machine,
 * the locked required-document checklist, the canonical ownership chain
 * (Partner → managerId/userId → Project.partnerId → scheme_registrations),
 * and the §17 survey-gate contract — and that the Loan `registrations`
 * domain and production data are untouched.
 *
 * Every assertion is keyed off the generated plan's own data (never a
 * hardcoded scheme_registrations id) so it keeps protecting the invariant
 * if a future phase changes specific ids/names.
 */
import { describe, expect, it } from 'vitest';
import { buildCompleteDemoPlan } from '../../../scripts/demo/datasets/complete.ts';
import { DEMO_COMPANY_ID, DEMO_SEED_ID } from '../../../scripts/demo/config.ts';
import {
  SCHEME_REGISTRATION_REQUIRED_DOCUMENTS,
  SCHEME_REGISTRATION_TRANSITIONS,
  allRequiredDocumentsLinked,
  isSurveyGateSatisfied,
  isVendorLockDataComplete,
} from '../../features/scheme-registration/types.ts';
import type { SchemeRegistrationStatus } from '../../features/scheme-registration/types.ts';

const plan = () => buildCompleteDemoPlan('CP15-TEST-AUTH-UID');
const docs = (collection: string) => plan().documents.filter((d) => d.collection === collection);
const byId = <T extends { collection: string; id: string }>(rows: T[]) => new Map(rows.map((d) => [d.id, d]));
const ALL_STATUSES: SchemeRegistrationStatus[] = ['Draft', 'Submitted', 'UnderVerification', 'VendorLocked', 'Completed', 'Rejected', 'Cancelled', 'Failed'];
const LEGAL_PAIRS = new Set<string>(
  (Object.entries(SCHEME_REGISTRATION_TRANSITIONS) as [SchemeRegistrationStatus, SchemeRegistrationStatus[]][]).flatMap(
    ([from, targets]) => targets.map((to) => `${from}->${to}`),
  ),
);

describe('CP-15 — demo scheme_registrations dataset exists and is deterministic', () => {
  it('seeds a compact, comprehensive set of scheme registrations (one per represented lifecycle state)', () => {
    const regs = docs('scheme_registrations');
    expect(regs.length).toBeGreaterThanOrEqual(8);
  });

  it('is deterministic and repeatable: rebuilding the plan twice yields byte-identical registration data', () => {
    const a = plan();
    const b = plan();
    expect(a.documents.filter((d) => d.collection === 'scheme_registrations')).toEqual(
      b.documents.filter((d) => d.collection === 'scheme_registrations'),
    );
    expect(a).toEqual(b);
  });

  it('uses unique ids with the SREG- prefix (never colliding with loan RG- ids)', () => {
    const regIds = docs('scheme_registrations').map((d) => d.id);
    expect(new Set(regIds).size).toBe(regIds.length);
    expect(regIds.every((id) => id.includes('SREG'))).toBe(true);
    const loanIds = docs('registrations').map((d) => d.id);
    const overlap = regIds.filter((id) => loanIds.includes(id));
    expect(overlap).toEqual([]);
  });
});

describe('CP-15 — every seeded record conforms to the production SchemeRegistration contract', () => {
  const regs = docs('scheme_registrations');

  it('carries the mandatory base + identity + ownership fields', () => {
    for (const r of regs) {
      const d = r.data as Record<string, unknown>;
      expect(d.id).toBe(r.id);
      expect(d.registrationId).toBe(r.id);
      expect(typeof d.projectId).toBe('string');
      expect(d.companyId).toBe(DEMO_COMPANY_ID);
      expect(d.isDemo).toBe(true);
      expect(d.demoSeedId).toBe(DEMO_SEED_ID);
      expect(typeof d.partnerId).toBe('string');
      expect(typeof d.partnerName).toBe('string');
      expect(typeof d.managerId).toBe('string');
      expect(typeof d.createdAt).toBe('string');
      expect(typeof d.createdBy).toBe('string');
      expect(typeof d.updatedAt).toBe('string');
    }
  });

  it('every status is one of the 8 authoritative statuses — no invented status', () => {
    for (const r of regs) {
      expect(ALL_STATUSES).toContain(r.data.status as SchemeRegistrationStatus);
    }
  });

  it('every statusHistory entry carries actor/timestamp/status, and every consecutive transition is a legal edge of the canonical machine', () => {
    for (const r of regs) {
      const history = r.data.statusHistory as Array<{ status: string; changedAt: string; changedBy: string }>;
      expect(Array.isArray(history) && history.length).toBeGreaterThan(0);
      for (const entry of history) {
        expect(typeof entry.status).toBe('string');
        expect(typeof entry.changedAt).toBe('string');
        expect(typeof entry.changedBy).toBe('string');
      }
      // The seeded machine path must terminate at the record's own status.
      expect(history[history.length - 1].status).toBe(r.data.status);
      for (let i = 1; i < history.length; i++) {
        const from = history[i - 1].status;
        const to = history[i].status;
        expect(LEGAL_PAIRS.has(`${from}->${to}`), `illegal seeded transition ${from}->${to} in ${r.id}`).toBe(true);
      }
    }
  });

  it('the 8 statuses collectively cover the full lifecycle (not a single-status pile-up)', () => {
    const seen = new Set(regs.map((r) => r.data.status as string));
    for (const s of ALL_STATUSES) expect(seen.has(s), `status ${s} must be represented in the demo dataset`).toBe(true);
  });

  it('submitted-or-later records carry the manual portal data (applicationNumber/portalReference) — one is mandatory before submission', () => {
    for (const r of regs) {
      const status = r.data.status as SchemeRegistrationStatus;
      if (status === 'Draft' || status === 'Cancelled') continue;
      expect(Boolean(r.data.applicationNumber) || Boolean(r.data.portalReference), `${r.id} (${status}) must have portal data`).toBe(true);
      if (status === 'Submitted' || status === 'UnderVerification' || status === 'VendorLocked' || status === 'Completed' || status === 'Rejected' || status === 'Failed') {
        expect(typeof r.data.registrationDate).toBe('string');
      }
    }
  });
});

describe('CP-15 — ownership chain is canonical and internally consistent', () => {
  const regs = docs('scheme_registrations');
  const partnersById = byId(docs('channel_partners'));
  const projectsById = byId(docs('projects'));
  const customersById = byId(docs('customers'));
  const usersById = byId(docs('users'));

  it('partnerId resolves to a real channel_partners doc whose managerId/userId match the record (manager/team visibility contract)', () => {
    for (const r of regs) {
      const partner = partnersById.get(String(r.data.partnerId));
      expect(partner, `${r.id}.partnerId must resolve to a real channel partner`).toBeTruthy();
      // managerId must equal the partner's own managerId (never an invented id).
      expect(r.data.managerId).toBe(partner!.data.managerId);
      // userId must equal the partner's linked user when the partner has one.
      if (partner!.data.userId) expect(r.data.userId).toBe(partner!.data.userId);
    }
  });

  it('projectId resolves to a real project owned by the SAME partner (project.partnerId === registration.partnerId)', () => {
    for (const r of regs) {
      const project = projectsById.get(String(r.data.projectId));
      expect(project, `${r.id}.projectId must resolve to a real project`).toBeTruthy();
      expect(project!.data.partnerId, `project ${project!.id} must belong to the same partner as registration ${r.id}`).toBe(r.data.partnerId);
      expect(project!.data.customerId).toBe(r.data.customerId);
    }
  });

  it('customerId/leadId resolve to real demo records within the same company', () => {
    for (const r of regs) {
      const customer = customersById.get(String(r.data.customerId));
      expect(customer, `${r.id}.customerId must resolve to a real customer`).toBeTruthy();
      expect(customer!.data.companyId).toBe(DEMO_COMPANY_ID);
      expect(customer!.data.type).toBe('B2C');
      if (r.data.leadId) {
        const lead = byId(docs('leads')).get(String(r.data.leadId));
        expect(lead, `${r.id}.leadId must resolve to a real lead`).toBeTruthy();
      }
    }
  });

  it('seeded registrations live in the pre-Survey window: their projects are at New or SchemeRegistration (never past Registration)', () => {
    for (const r of regs) {
      const project = projectsById.get(String(r.data.projectId))!;
      expect(['New', 'SchemeRegistration']).toContain(project.data.currentStage);
    }
  });

  it('no cross-company relationships exist anywhere in the seeded scheme registration graph', () => {
    const companyScoped = [...docs('scheme_registrations'), ...docs('channel_partners'), ...docs('projects'), ...docs('customers'), ...docs('leads')]
      .filter((d) => d.data.companyId !== DEMO_COMPANY_ID);
    expect(companyScoped).toEqual([]);
  });
});

describe('CP-15 — required documents and vendor-lock/survey preconditions are coherent', () => {
  const regs = docs('scheme_registrations');
  const CANONICAL_CATEGORIES = SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.map((d) => d.category);

  it("every record's requiredDocuments uses the locked canonical checklist categories — never invented categories", () => {
    for (const r of regs) {
      const checklist = (r.data.requiredDocuments as Array<{ category: string }>) || [];
      expect(checklist.length).toBeGreaterThan(0);
      for (const entry of checklist) {
        expect(CANONICAL_CATEGORIES, `${r.id} has an unknown document category: ${entry.category}`).toContain(entry.category);
      }
    }
  });

  it('Draft/Cancelled records are document-incomplete; Submitted-or-later records satisfy the submit precondition (all required docs linked)', () => {
    for (const r of regs) {
      const status = r.data.status as SchemeRegistrationStatus;
      const checklist = (r.data.requiredDocuments as Array<{ required: boolean; documentId?: string }>) || [];
      if (status === 'Draft' || status === 'Cancelled') {
        // Never fully linked before submission — represents the pre-submit window.
        expect(allRequiredDocumentsLinked(checklist as never)).toBe(false);
      } else {
        expect(allRequiredDocumentsLinked(checklist as never), `${r.id} (${status}) must satisfy the submit document precondition`).toBe(true);
      }
    }
  });

  it("VendorLocked/Completed records satisfy the vendor-lock data contract (vendor selected + lock date recorded)", () => {
    for (const r of regs) {
      const status = r.data.status as SchemeRegistrationStatus;
      if (status === 'VendorLocked' || status === 'Completed') {
        expect(isVendorLockDataComplete(r.data as never), `${r.id} (${status}) must have a complete vendor-lock data contract`).toBe(true);
        expect(typeof r.data.vendorLockDate).toBe('string');
        expect(typeof r.data.vendorLockedAt).toBe('string');
      }
    }
  });

  it('Completed records satisfy the completion precondition: every required document is linked', () => {
    for (const r of regs) {
      if (r.data.status !== 'Completed') continue;
      expect(allRequiredDocumentsLinked(r.data.requiredDocuments as never)).toBe(true);
      const docsArr = (r.data.documents as Array<{ category: string; documentId: string }>) || [];
      expect(docsArr.length).toBeGreaterThan(0);
      for (const ref of docsArr) {
        expect(CANONICAL_CATEGORIES).toContain(ref.category);
        expect(typeof ref.documentId).toBe('string');
      }
    }
  });

  it('every linked documentId resolves to a REAL seeded documents record (Phase 14 convention: demo:// URLs, scheme_registration sourceEntityType) — never a dangling placeholder', () => {
    const documentsById = byId(docs('documents'));
    const projectsById = byId(docs('projects'));
    for (const r of regs) {
      const checklist = (r.data.requiredDocuments as Array<{ category: string; documentId?: string }>) || [];
      for (const entry of checklist) {
        if (!entry.documentId) continue;
        const linked = documentsById.get(entry.documentId);
        expect(linked, `${r.id} links documentId ${entry.documentId} which must resolve to a seeded documents record`).toBeTruthy();
        expect(linked!.data.sourceEntityType).toBe('scheme_registration');
        expect(String(linked!.data.url)).toMatch(/^demo:\/\//);
        expect(linked!.data.projectId).toBe(r.data.projectId);
        expect(projectsById.has(String(linked!.data.projectId))).toBe(true);
      }
      // Every resolved document stays inside the demo company boundary.
      for (const entry of checklist) {
        if (!entry.documentId) continue;
        expect(documentsById.get(entry.documentId)!.data.companyId).toBe(DEMO_COMPANY_ID);
      }
    }
  });

  it('every survey-ready registration (VendorLocked/Completed) satisfies the §17 survey gate — and only those do', () => {
    for (const r of regs) {
      const status = r.data.status as SchemeRegistrationStatus;
      if (status === 'VendorLocked' || status === 'Completed') {
        expect(isSurveyGateSatisfied(status, r.data as never), `${r.id} (${status}) must satisfy the survey gate`).toBe(true);
      } else {
        expect(isSurveyGateSatisfied(status, r.data as never), `${r.id} (${status}) must NOT satisfy the survey gate`).toBe(false);
      }
    }
  });
});

describe('CP-15 — Loan `registrations` domain is untouched and demo data cannot pollute production', () => {
  it('the Loan registrations dataset is unchanged (still the 6 documented loan fixtures, loan statuses only)', () => {
    const loans = docs('registrations');
    expect(loans.length).toBe(6);
    // 'Draft'/'Rejected' are shared vocabulary words — what matters is that
    // no SCHEME-SPECIFIC status (UnderVerification/VendorLocked/Completed/
    // Cancelled/Failed) has leaked into the loan fixtures.
    const schemeOnlyStatuses = ['UnderVerification', 'VendorLocked', 'Completed', 'Cancelled', 'Failed'];
    for (const l of loans) {
      expect(schemeOnlyStatuses).not.toContain(l.data.status);
    }
    // None of the loan fixtures may carry scheme registration fields.
    for (const l of loans) {
      expect((l.data as Record<string, unknown>).schemeName).toBeUndefined();
      expect((l.data as Record<string, unknown>).portalType).toBeUndefined();
      expect((l.data as Record<string, unknown>).vendorLockDate).toBeUndefined();
    }
  });

  it('every seeded scheme registration is unambiguously demo-marked (isDemo + demoSeedId + demo company)', () => {
    for (const r of docs('scheme_registrations')) {
      expect(r.data.isDemo).toBe(true);
      expect(r.data.demoSeedId).toBe(DEMO_SEED_ID);
      expect(r.data.companyId).toBe(DEMO_COMPANY_ID);
    }
  });

  it('no seeded registration triggers a notification/audit storm: no plan notification or audit_log references any seeded SREG id', () => {
    const sregIds = new Set(docs('scheme_registrations').map((d) => d.id));
    // StatusHistory is fixture data; notifications/audit are NOT seeded for demo records.
    const sideEffects = plan().documents
      .filter((d) => d.collection === 'notifications' || d.collection === 'audit_logs')
      .filter((d) => [...sregIds].some((id) => JSON.stringify(d.data).includes(id)));
    expect(sideEffects).toEqual([]);
  });

  it('reset repeatability holds at the collection level: scheme_registrations is resettable and re-seeds identically', () => {
    const a = plan();
    const b = plan();
    expect(a.documents.filter((d) => d.collection === 'scheme_registrations')).toEqual(b.documents.filter((d) => d.collection === 'scheme_registrations'));
    // The full plan (and therefore the demo graph) is byte-identical on rebuild — no accumulation.
    expect(a).toEqual(b);
  });
});
