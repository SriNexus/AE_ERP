/**
 * channelPartnerPhase13Verification.test — VL-13 Verification / Test
 * Hardening for the Vendor Lock / Scheme Registration subsystem.
 *
 * Phase 13 of the authoritative Vendor Lock specification is the Tests /
 * Verification phase (§24/§25 battery): rename regression + vendor-lock
 * functional + security matrix + mobile parity. This suite adds the
 * verification contracts that were NOT already meaningfully covered by
 * Phase 6 (functional/status machine), VL-9/VL-10 (team visibility),
 * VL-11 (notifications/audit) and VL-12 (migration/compatibility):
 *
 *   1. Exhaustive canonical transition-map sweep — every legal edge
 *      succeeds with statusHistory/audit/notification side effects; every
 *      illegal pair is rejected with ZERO side effects (no write, no audit,
 *      no notification). Terminal-behavior verification for Completed /
 *      Cancelled.
 *   2. Status-machine edges Phase 6 left untested: Draft→Failed,
 *      Submitted→Failed, Submitted→Cancelled (staff-only), Rejected→Cancelled
 *      (staff-only), Failed→Cancelled, UnderVerification→Rejected, and the
 *      partner-side cancellation boundary after submission.
 *   3. Retry (Failed) precondition hardening — Failed→Submitted must still
 *      enforce the submit preconditions (application/portal reference +
 *      required documents).
 *   4. Legacy-record robustness — records missing Phase 6 fields
 *      (managerId/userId/statusHistory/requiredDocuments) transition safely,
 *      initialize history, and remain gated by the canonical checklist.
 *   5. Cross-company denial at the service boundary (partner scope) with the
 *      staff-tenant boundary documented as rules-enforced (sameCompany).
 *   6. Mobile parity — mobile routes reuse the desktop pages/hooks and no
 *      mobile component redefines the status machine (no parallel logic).
 *   7. Firestore rules static hardening — identity immutability (no
 *      partnerId/projectId/companyId forgery), Director view-only, Accounts
 *      denied, partner update restricted to pre-completion partner-side
 *      targets, sameCompany on every write path.
 *   8. Hooks wire to the canonical workflow — no parallel domain logic.
 *
 * The naming contract is enforced throughout: user-facing "Registration",
 * internal SchemeRegistration / scheme_registrations / SREG-, and complete
 * separation from the Loan "registrations" domain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(async (_collection: string, id: string, doc: any) => ({ id, ...doc })),
  updateDocById: vi.fn(async (..._args: any[]) => {}),
  getOne: vi.fn(async (..._args: any[]): Promise<any> => undefined),
  getAll: vi.fn(async (..._args: any[]): Promise<any[]> => []),
  genId: {
    schemeRegistration: vi.fn(() => 'SREG-001'),
    registration: vi.fn(() => 'RG-001'),
    generic: vi.fn(() => 'SRV-001'),
  },
  logActivity: vi.fn(async (..._args: any[]) => {}),
  resolveWorkflowCompanyId: vi.fn(() => 'comp-1'),
  notifyUsers: vi.fn(async (..._args: any[]) => {}),
  usersByRole: vi.fn(async (..._args: any[]): Promise<any[]> => []),
  sendNotification: vi.fn(async (..._args: any[]) => {}),
  notifyRoleUsers: vi.fn(async (..._args: any[]) => {}),
  canDo: vi.fn((..._args: any[]) => true),
  resolveCurrentPartnerDocId: vi.fn(async (..._args: any[]): Promise<string | null> => null),
  propagateCaseIdFromChain: vi.fn(async (..._args: any[]): Promise<any> => null),
  logEntityChange: vi.fn(async (..._args: any[]) => {}),
  notifyPartnerTeam: vi.fn(async (..._args: any[]) => {}),
}));

// Canonical Phase 0 constants keep their REAL values (scheme_registrations /
// registrations — the hard separation this subsystem protects).
vi.mock('../firebase', () => {
  const COLLECTIONS = new Proxy<Record<string, string>>({
    SCHEME_REGISTRATIONS: 'scheme_registrations',
    LOAN_APPLICATIONS: 'registrations',
  }, { get: (target, key: string) => target[key] ?? key.toLowerCase() });
  return { COLLECTIONS, firebaseEnv: { isConfigured: false }, db: {} };
});

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  genId: mocks.genId,
  resolveWriteCompanyId: () => 'comp-1',
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
  resolveWorkflowCompanyId: mocks.resolveWorkflowCompanyId,
  notifyUsers: mocks.notifyUsers,
  usersByRole: mocks.usersByRole,
  text: (value: unknown) => String(value ?? ''),
}));

vi.mock('../notifications', () => ({
  sendNotification: mocks.sendNotification,
  notifyRoleUsers: mocks.notifyRoleUsers,
}));

vi.mock('../permissions', () => ({
  canDo: mocks.canDo,
}));

vi.mock('../partnerOwnership', () => ({
  resolveCurrentPartnerDocId: mocks.resolveCurrentPartnerDocId,
}));

vi.mock('../casePropagation', () => ({
  propagateCaseIdFromChain: mocks.propagateCaseIdFromChain,
}));

vi.mock('../auditLogger', () => ({
  logEntityChange: mocks.logEntityChange,
}));

vi.mock('../partnerNotifications', () => ({
  notifyPartnerTeam: mocks.notifyPartnerTeam,
}));

import { useAppStore } from '../../store/useAppStore';
import {
  createSchemeRegistration,
  transitionSchemeRegistrationStatus,
  getSchemeRegistrationForProject,
} from '../../features/scheme-registration/services/schemeRegistrationWorkflow';
import {
  SCHEME_REGISTRATION_TRANSITIONS,
  SCHEME_REGISTRATION_REQUIRED_DOCUMENTS,
  isPartnerSideTransition,
  isValidSchemeRegistrationTransition,
  allRequiredDocumentsLinked,
  type SchemeRegistrationRecord,
  type SchemeRegistrationStatus,
} from '../../features/scheme-registration/types';

const USER = { id: 'u-user', name: 'Test User' } as any;
const PARTNER_PROJECT = {
  id: 'PRJ-1',
  projectId: 'PRJ-001',
  currentStage: 'New',
  partnerId: 'PART-1',
  partnerName: 'Partner One',
  customerId: 'CUS-1',
  customerName: 'Customer One',
  customerPhone: '9876543210',
  leadId: 'LD-1',
  caseId: 'CASE-1',
  companyId: 'comp-1',
};

const ALL_STATUSES: SchemeRegistrationStatus[] = [
  'Draft', 'Submitted', 'UnderVerification', 'VendorLocked',
  'Completed', 'Rejected', 'Cancelled', 'Failed',
];

function linkedDocs() {
  return SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.map((d) => ({
    ...d,
    documentId: d.required ? `DOC-${d.category}` : undefined,
  }));
}

/**
 * Brace-balanced extraction of the scheme_registrations rules block — robust
 * to indentation/formatting changes while still failing on real contract
 * changes (block missing, rule branches removed, etc.).
 */
function readSchemeBlock(): string {
  const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
  const matchLiteral = 'match /scheme_registrations/{id}';
  const start = rules.indexOf(matchLiteral);
  expect(start).toBeGreaterThan(-1);
  const bodyStart = rules.indexOf('{', start + matchLiteral.length);
  let depth = 0;
  for (let i = bodyStart; i < rules.length; i++) {
    if (rules[i] === '{') depth += 1;
    else if (rules[i] === '}') {
      depth -= 1;
      if (depth === 0) return rules.slice(start, i + 1);
    }
  }
  throw new Error('Could not extract the scheme_registrations rules block.');
}

function baseRecord(overrides: Partial<SchemeRegistrationRecord> = {}): SchemeRegistrationRecord {
  return {
    id: 'SREG-001',
    registrationId: 'SREG-001',
    projectId: 'PRJ-1',
    customerId: 'CUS-1',
    customerName: 'Customer One',
    leadId: 'LD-1',
    caseId: 'CASE-1',
    companyId: 'comp-1',
    partnerId: 'PART-1',
    partnerName: 'Partner One',
    managerId: 'u-manager',
    userId: 'u-partner',
    vendorName: 'Vendor A',
    schemeName: 'PM Surya Ghar',
    applicationNumber: 'APP-001',
    requiredDocuments: linkedDocs(),
    documents: [],
    status: 'Draft',
    statusHistory: [{ status: 'Draft', changedAt: '2026-01-01T00:00:00.000Z', changedBy: 'u-user' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'u-user',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'u-user',
    ...overrides,
  };
}

/** Same harness as Phase 6: getOne returns the mutable record + project. */
function transitionHarness(initial: Partial<SchemeRegistrationRecord> = {}) {
  const record = baseRecord(initial);
  mocks.getOne.mockImplementation(async (collection: string) => {
    if (collection === 'scheme_registrations') return record;
    if (collection === 'projects') return PARTNER_PROJECT;
    return undefined;
  });
  mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
    if (collection === 'scheme_registrations') Object.assign(record, patch);
  });
  return record;
}

/** Preconditions required by specific legal targets (spec §13/§15/§17). */
function optionsFor(to: SchemeRegistrationStatus) {
  switch (to) {
    case 'VendorLocked':
      return { vendorId: 'VEN-1', vendorName: 'Vendor A', vendorLockDate: '2026-01-10' };
    case 'Rejected':
      return { rejectionReason: 'Incomplete documents.' };
    case 'Cancelled':
      return { note: 'Cancelled per applicant.' };
    case 'Failed':
      return { failureReason: 'Portal submission failed.' };
    default:
      return {};
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canDo.mockReturnValue(true);
  mocks.resolveCurrentPartnerDocId.mockResolvedValue(null);
  mocks.getAll.mockResolvedValue([]);
  mocks.getOne.mockResolvedValue(undefined);
  useAppStore.setState({ user: USER });
});

describe('VL-13 — canonical transition map: exhaustive legal/illegal sweep', () => {
  it('the map covers exactly the 8 authoritative statuses with no drift', () => {
    for (const status of ALL_STATUSES) {
      expect(SCHEME_REGISTRATION_TRANSITIONS[status], `missing key ${status}`).toBeDefined();
    }
    expect(Object.keys(SCHEME_REGISTRATION_TRANSITIONS)).toHaveLength(ALL_STATUSES.length);
    // Pin the total legal-edge count so the sweep can never pass vacuously if
    // a refactor erodes the machine (16 = 3+5+2+1+0+2+0+3).
    const totalEdges = ALL_STATUSES.reduce(
      (n, s) => n + (SCHEME_REGISTRATION_TRANSITIONS[s]?.length ?? 0), 0,
    );
    expect(totalEdges).toBe(16);
  });

  it('every legal edge succeeds end-to-end (status + statusHistory + audit + notification)', async () => {
    for (const from of ALL_STATUSES) {
      const targets = SCHEME_REGISTRATION_TRANSITIONS[from] ?? [];
      for (const to of targets) {
        vi.clearAllMocks();
        mocks.canDo.mockReturnValue(true);
        mocks.resolveCurrentPartnerDocId.mockResolvedValue(null);
        const record = transitionHarness({ status: from });

        await transitionSchemeRegistrationStatus(record.id, to, optionsFor(to));

        expect(record.status, `legal edge ${from} → ${to}`).toBe(to);
        const history = record.statusHistory ?? [];
        expect(history[history.length - 1]?.status, `${from} → ${to} history tail`).toBe(to);
        expect(history[history.length - 1]?.changedBy, `${from} → ${to} actor`).toBe('u-user');
        // Exactly one structured audit + one activity + one team notification
        // per successful transition (duplicate-prevention contract).
        expect(mocks.logEntityChange, `${from} → ${to} audit count`).toHaveBeenCalledTimes(1);
        expect(mocks.logActivity, `${from} → ${to} activity count`).toHaveBeenCalledTimes(1);
        expect(mocks.notifyPartnerTeam, `${from} → ${to} notification count`).toHaveBeenCalledTimes(1);
        expect(mocks.notifyPartnerTeam).toHaveBeenCalledWith(expect.objectContaining({
          entityType: 'scheme_registration',
          entityId: record.id,
          companyId: 'comp-1',
          projectId: 'PRJ-1',
        }));
      }
    }
  });

  it('every illegal pair is rejected with ZERO side effects (no write/audit/notification)', async () => {
    for (const from of ALL_STATUSES) {
      const legal = SCHEME_REGISTRATION_TRANSITIONS[from] ?? [];
      for (const to of ALL_STATUSES) {
        if (legal.includes(to)) continue;
        vi.clearAllMocks();
        mocks.canDo.mockReturnValue(true);
        mocks.resolveCurrentPartnerDocId.mockResolvedValue(null);
        const record = transitionHarness({ status: from });

        const message = await transitionSchemeRegistrationStatus(record.id, to, optionsFor(to))
          .then(() => null)
          .catch((e: Error) => e.message);

        expect(message, `illegal edge ${from} → ${to} must be rejected`).toContain(
          'Cannot move a scheme registration',
        );
        expect(mocks.updateDocById, `illegal ${from} → ${to} wrote`).not.toHaveBeenCalled();
        expect(mocks.logEntityChange, `illegal ${from} → ${to} audited`).not.toHaveBeenCalled();
        expect(mocks.logActivity, `illegal ${from} → ${to} activity`).not.toHaveBeenCalled();
        expect(mocks.notifyPartnerTeam, `illegal ${from} → ${to} notified`).not.toHaveBeenCalled();
      }
    }
  });

  it('Completed and Cancelled are terminal — the machine exposes no outgoing edges', () => {
    expect(SCHEME_REGISTRATION_TRANSITIONS.Completed ?? []).toHaveLength(0);
    expect(SCHEME_REGISTRATION_TRANSITIONS.Cancelled ?? []).toHaveLength(0);
    for (const to of ALL_STATUSES) {
      expect(isValidSchemeRegistrationTransition('Completed', to), `Completed → ${to}`).toBe(false);
      expect(isValidSchemeRegistrationTransition('Cancelled', to), `Cancelled → ${to}`).toBe(false);
    }
  });
});

describe('VL-13 — status-machine edges not covered by Phase 6', () => {
  it('Draft → Failed records the failure reason and history (staff)', async () => {
    const record = transitionHarness();
    await transitionSchemeRegistrationStatus(record.id, 'Failed', { failureReason: 'Portal error 502.' });
    expect(record.status).toBe('Failed');
    expect(record.failedAt).toBeTruthy();
    expect(record.failureReason).toBe('Portal error 502.');
    const history = record.statusHistory ?? [];
    expect(history[history.length - 1]?.status).toBe('Failed');
  });

  it('Submitted → Failed (staff) is legal', async () => {
    const record = transitionHarness({ status: 'Submitted', submittedAt: '2026-01-02T00:00:00.000Z' });
    await transitionSchemeRegistrationStatus(record.id, 'Failed', { failureReason: 'Verification cancelled by portal.' });
    expect(record.status).toBe('Failed');
    expect(record.failureReason).toBe('Verification cancelled by portal.');
  });

  it('Submitted → Cancelled requires a note and is staff-only (partner denied at the service boundary)', async () => {
    const record = transitionHarness({ status: 'Submitted', submittedAt: '2026-01-02T00:00:00.000Z' });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Cancelled'))
      .rejects.toThrow('Cancellation note is required.');

    // Staff with a note succeeds.
    await transitionSchemeRegistrationStatus(record.id, 'Cancelled', { note: 'Duplicate filing.' });
    expect(record.status).toBe('Cancelled');
    expect(record.cancelledAt).toBeTruthy();
    const history = record.statusHistory ?? [];
    expect(history[history.length - 1]?.note).toBe('Duplicate filing.');

    // The same edge is NOT partner-side: a partner actor is denied.
    expect(isPartnerSideTransition('Submitted', 'Cancelled')).toBe(false);
    vi.clearAllMocks();
    mocks.canDo.mockReturnValue(true);
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('PART-1');
    const partnerView = transitionHarness({ status: 'Submitted', submittedAt: '2026-01-02T00:00:00.000Z' });
    await expect(transitionSchemeRegistrationStatus(partnerView.id, 'Cancelled', { note: 'x' }))
      .rejects.toThrow('This action requires staff approval rights.');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('Rejected → Cancelled requires a note and is staff-only (partner may only resubmit)', async () => {
    expect(isPartnerSideTransition('Rejected', 'Cancelled')).toBe(false);
    expect(isPartnerSideTransition('Rejected', 'Submitted')).toBe(true);

    const record = transitionHarness({ status: 'Rejected', rejectionReason: 'Docs missing.' });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Cancelled'))
      .rejects.toThrow('Cancellation note is required.');
    await transitionSchemeRegistrationStatus(record.id, 'Cancelled', { note: 'Applicant withdrew.' });
    expect(record.status).toBe('Cancelled');
    expect(record.cancelledAt).toBeTruthy();
  });

  it('Failed → Cancelled requires a note (staff)', async () => {
    const record = transitionHarness({ status: 'Failed', failureReason: 'Portal error.' });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Cancelled'))
      .rejects.toThrow('Cancellation note is required.');
    await transitionSchemeRegistrationStatus(record.id, 'Cancelled', { note: 'Closed without retry.' });
    expect(record.status).toBe('Cancelled');
  });

  it('UnderVerification → Rejected requires a rejection reason (staff)', async () => {
    const record = transitionHarness({ status: 'UnderVerification' });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Rejected'))
      .rejects.toThrow('Rejection reason is required.');
    await transitionSchemeRegistrationStatus(record.id, 'Rejected', { rejectionReason: 'Documents did not match the scheme.' });
    expect(record.status).toBe('Rejected');
    expect(record.rejectionReason).toBe('Documents did not match the scheme.');
  });
});

describe('VL-13 — retry (Failed) precondition hardening', () => {
  it('Failed → Submitted still enforces the application/portal reference precondition', async () => {
    const record = transitionHarness({ status: 'Failed', applicationNumber: undefined, portalReference: undefined, failureReason: 'Portal error.' });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Submitted'))
      .rejects.toThrow('Application number or portal reference is required before submitting.');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('Failed → Submitted still enforces the required-documents precondition', async () => {
    const record = transitionHarness({
      status: 'Failed',
      failureReason: 'Portal error.',
      requiredDocuments: SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.map((d) => ({ ...d, documentId: undefined })),
    });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Submitted'))
      .rejects.toThrow('All required documents must be attached before submitting.');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('Failed → Submitted succeeds when preconditions hold and clears the failure reason', async () => {
    const record = transitionHarness({ status: 'Failed', failureReason: 'Portal error.' });
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    expect(record.status).toBe('Submitted');
    expect(record.submittedAt).toBeTruthy();
    expect(record.failureReason).toBeFalsy();
  });

  it('Failed → Draft retry needs no submit preconditions and records retriedAt', async () => {
    const record = transitionHarness({ status: 'Failed', applicationNumber: undefined, portalReference: undefined, failureReason: 'Portal error.' });
    await transitionSchemeRegistrationStatus(record.id, 'Draft');
    expect(record.status).toBe('Draft');
    expect(record.retriedAt).toBeTruthy();
    expect(record.failureReason).toBeFalsy();
    const history = record.statusHistory ?? [];
    expect(history[history.length - 1]?.status).toBe('Draft');
  });
});

describe('VL-13 — legacy-record robustness (records missing Phase 6 fields)', () => {
  it('a legacy record without managerId/userId still transitions safely (staff), recipients resolve to none', async () => {
    const record = transitionHarness({ status: 'Submitted', submittedAt: '2026-01-02T00:00:00.000Z', managerId: undefined, userId: undefined });
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    expect(record.status).toBe('UnderVerification');
    expect(record.verificationStartedBy).toBe('u-user');
    // §18: no partner user / manager user on the record → the team-scoped
    // helper is still invoked (with undefined recipients it emits nothing).
    expect(mocks.notifyPartnerTeam).toHaveBeenCalledWith(expect.objectContaining({
      partnerUserId: undefined,
      managerUserId: undefined,
      entityType: 'scheme_registration',
    }));
  });

  it('a legacy record without statusHistory initializes history on first transition', async () => {
    const record = transitionHarness({ status: 'Submitted', submittedAt: '2026-01-02T00:00:00.000Z', statusHistory: undefined });
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    expect(record.statusHistory).toHaveLength(1);
    expect(record.statusHistory?.[0]?.status).toBe('UnderVerification');
    expect(record.statusHistory?.[0]?.changedBy).toBe('u-user');
  });

  it('the required-document checklist is initialized at create — docs-gating is never opt-in', async () => {
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('PART-1');
    mocks.getAll.mockResolvedValue([]);
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'projects') return PARTNER_PROJECT;
      if (collection === 'channel_partners') return { userId: 'u-partner', managerId: 'u-manager' };
      return undefined;
    });
    const record = await createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' });
    expect(record.status).toBe('Draft');
    expect(record.requiredDocuments).toHaveLength(SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.length);
    expect(record.requiredDocuments?.every((d) => !d.documentId)).toBe(true);
    expect(record.userId).toBe('u-partner');
    expect(record.managerId).toBe('u-manager');
    expect(record.partnerId).toBe('PART-1');
    expect(record.companyId).toBe('comp-1');
    expect(record.caseId).toBe('CASE-1');
  });

  it('documented normalization: a record with NO checklist is vacuously complete (unreachable via the service)', () => {
    // allRequiredDocumentsLinked treats a missing checklist as satisfied —
    // the canonical checklist is initialized at create, so no service-created
    // record can reach this state. This pins the normalization so a future
    // change to it is a deliberate decision, not an accident.
    expect(allRequiredDocumentsLinked(undefined)).toBe(true);
    expect(allRequiredDocumentsLinked(null)).toBe(true);
  });

  it('getSchemeRegistrationForProject returns the latest non-deleted legacy-shaped record without crashing', async () => {
    const legacy = baseRecord({ managerId: undefined, userId: undefined, statusHistory: undefined, requiredDocuments: undefined });
    mocks.getAll.mockResolvedValue([legacy]);
    const resolved = await getSchemeRegistrationForProject('PRJ-1');
    expect(resolved?.id).toBe('SREG-001');
    expect(resolved?.status).toBe('Draft');
  });
});

describe('VL-13 — cross-company denial at the service boundary', () => {
  it('a partner of company B cannot create a registration on company A\'s project', async () => {
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('PART-9');
    mocks.getAll.mockResolvedValue([]);
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'projects' ? PARTNER_PROJECT : undefined));
    await expect(createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' }))
      .rejects.toThrow('You can only create a registration for a project you own.');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('a partner of company B cannot transition company A\'s record', async () => {
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('PART-9');
    const record = transitionHarness();
    await expect(transitionSchemeRegistrationStatus(record.id, 'Submitted'))
      .rejects.toThrow('You can only manage your own scheme registrations.');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
    expect(mocks.logEntityChange).not.toHaveBeenCalled();
    expect(mocks.notifyPartnerTeam).not.toHaveBeenCalled();
  });

  it('staff cross-company writes are rules-enforced (sameCompany) — the service trusts the tenant-gated rules layer', () => {
    // The service enforces partner self-scope + permissions; the Firestore
    // rules enforce the company/tenant boundary for staff (Manager/Admin).
    // Static contract assertion — see the rules hardening block below.
    const block = readSchemeBlock();
    expect(block).toContain('sameCompany(request.resource.data)');
    expect(block).toContain('sameCompany(resource.data)');
  });
});

describe('VL-13 — mobile parity (shared business logic only)', () => {
  const mobileRoutes = () => readFileSync(new URL('../../components/mobile/routing/MobileRoutes.tsx', import.meta.url), 'utf8');

  it('the mobile /registration route reuses the desktop page under the scheme_registration module gate', () => {
    const src = mobileRoutes();
    expect(src).toMatch(/path="\/registration"/);
    expect(src).toMatch(/module="scheme_registration"/);
    expect(src).toContain('SchemeRegistrations');
  });

  it('the legacy loan path keeps its existing redirect (no route collision)', () => {
    const src = mobileRoutes();
    expect(src).toMatch(/path="registrations"/);
    expect(src).toContain('/loan-applications');
  });

  it('the partner portal mobile route exists', () => {
    const src = mobileRoutes();
    expect(src).toMatch(/path="\/partner\/registration"/);
    expect(src).toContain('PartnerRegistration');
  });

  it('the mobile project workspace consumes the SAME hooks (no parallel business logic)', () => {
    const src = readFileSync(new URL('../../components/mobile/projects/MobileProjectWorkspace.tsx', import.meta.url), 'utf8');
    expect(src).toContain('useSchemeRegistrations');
    expect(src).toContain('useTransitionSchemeRegistration');
  });

  it('no mobile component REDEFINES the registration status machine (imports from canonical types are the shared path)', () => {
    // Reuse is expected and required: MobileProjectWorkspace imports the
    // canonical constants for UI action filtering. What must never happen is
    // a mobile-local DEFINITION of the machine (a parallel domain logic).
    const mobileRoot = fileURLToPath(new URL('../../components/mobile/', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = `${dir}/${entry}`;
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const source = readFileSync(full, 'utf8');
        if (/(export const|const) (SCHEME_REGISTRATION_TRANSITIONS|PARTNER_SIDE_TRANSITION_PAIRS|STAFF_APPROVE_TRANSITIONS)/.test(source)) {
          offenders.push(full);
        }
      }
    };
    walk(mobileRoot);
    expect(offenders).toEqual([]);
    // And the reusing file must import from the canonical types module
    // (path ending scheme-registration/types) rather than defining its own.
    const workspace = readFileSync(new URL('../../components/mobile/projects/MobileProjectWorkspace.tsx', import.meta.url), 'utf8');
    expect(workspace).toMatch(/scheme-registration\/types'/);
  });
});

describe('VL-13 — Firestore rules hardening (static contract)', () => {
  it('identity fields are immutable on update — no partnerId/projectId/companyId forgery', () => {
    const block = readSchemeBlock();
    expect(block).toContain('schemeRegIdentityUnchanged()');
    // The immutability helper must compare all three canonical identity fields.
    const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const fn = rules.slice(rules.indexOf('function schemeRegIdentityUnchanged'), rules.indexOf('function isSpecialCollection'));
    expect(fn).toContain('request.resource.data.partnerId == resource.data.partnerId');
    expect(fn).toContain('request.resource.data.projectId == resource.data.projectId');
    expect(fn).toContain('request.resource.data.companyId == resource.data.companyId');
  });

  it('Director is view-only (no write branch) and Accounts is never an allowed writer', () => {
    const block = readSchemeBlock();
    expect(block).not.toContain('Director');
    expect(block).not.toContain('Accounts');
  });

  it('partner updates are restricted to pre-completion sources and partner-side targets', () => {
    const block = readSchemeBlock();
    expect(block).toContain("resource.data.status in ['Draft', 'Submitted', 'Rejected', 'Failed']");
    expect(block).toContain("request.resource.data.status in ['Draft', 'Submitted', 'Cancelled']");
    expect(block).toContain('partnerLinkedToSelf(resource.data.partnerId)');
  });

  it('create/update/delete all enforce the sameCompany tenant boundary', () => {
    const block = readSchemeBlock();
    expect(block).toContain('sameCompany(request.resource.data)');
    expect(block).toContain('sameCompany(resource.data)');
    expect(block).toMatch(/allow delete: if isAdmin\(\) && sameCompany\(resource\.data\)/);
  });
});

describe('VL-13 — hooks wire to the canonical workflow (no parallel domain logic)', () => {
  it('useSchemeRegistrations imports the workflow functions and defines no status machine', () => {
    const hook = readFileSync(new URL('../../features/scheme-registration/hooks/useSchemeRegistrations.ts', import.meta.url), 'utf8');
    expect(hook).toContain('transitionSchemeRegistrationStatus');
    expect(hook).toContain('createSchemeRegistration');
    expect(hook).toContain('reopenSchemeRegistration');
    expect(hook).toContain('attachRegistrationDocument');
    expect(hook).not.toContain('SCHEME_REGISTRATION_TRANSITIONS');
    expect(hook).not.toContain('PARTNER_SIDE_TRANSITION_PAIRS');
  });
});
