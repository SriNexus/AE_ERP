/**
 * channelPartnerPhase6SchemeRegistration.test — Vendor Lock / Scheme
 * Registration (Phase 6 + VL reconciliation) verification.
 *
 * Covers: collection separation (scheme_registrations vs Loan Applications'
 * registrations + SREG-/RG- id prefixes), canonical ownership derivation and
 * §9.3 cross-partner rejection, the authoritative 8-status machine (valid +
 * invalid transitions, resubmit → Submitted, retry → Draft/Submitted, cancel,
 * failure), submit/complete preconditions (application/portal reference +
 * required documents), one-active-registration-per-project, Admin-only
 * audited reopen, statusHistory/actor capture, RBAC (staff approve vs
 * partner-side), Project stage advancement (New → SchemeRegistration on
 * submit), the Survey gate (blocked before VendorLocked; blocked at
 * VendorLocked without the vendor-lock data contract; allowed at
 * VendorLocked/Completed with it; vacuous with no registration), and the
 * wiring contracts (entityRegistry, PROJECT_SCOPED_COLLECTIONS,
 * casePropagation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

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
}));

// Mocked COLLECTIONS (defined INSIDE the factory — vi.mock factories are
// hoisted, so they cannot reference top-level variables): the two canonical
// Phase 0 constants keep their REAL values (scheme_registrations /
// registrations — the hard separation this phase protects); every other key
// self-names so downstream modules that reference e.g. COLLECTIONS.SURVEYS
// keep working in tests.
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
  // Resolved by the auditLogger (logEntityChange) context on every transition.
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

import { useAppStore } from '../../store/useAppStore';
import { COLLECTIONS as C } from '../firebase';
import { PROJECT_SCOPED_COLLECTIONS } from '../projectVisibility';
import { getEntityRegistryEntry } from '../entityRegistry';
import { resolveProjectWorkspaceStages } from '../../hooks/useProjectStage';
import {
  createSchemeRegistration,
  transitionSchemeRegistrationStatus,
  reopenSchemeRegistration,
  getSchemeRegistrationForProject,
  assertSchemeRegistrationSurveyGate,
} from '../../features/scheme-registration/services/schemeRegistrationWorkflow';
import {
  allRequiredDocumentsLinked,
  isPartnerSideTransition,
  isSurveyGateSatisfied,
  isVendorLockDataComplete,
  isValidSchemeRegistrationTransition,
  SCHEME_REGISTRATION_REQUIRED_DOCUMENTS,
  type SchemeRegistrationRecord,
} from '../../features/scheme-registration/types';
import { scheduleSurvey } from '../../features/surveys/services/surveyWorkflow';

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

function linkedDocs() {
  return SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.map((d) => ({
    ...d,
    documentId: d.required ? `DOC-${d.category}` : undefined,
  }));
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canDo.mockReturnValue(true);
  mocks.resolveCurrentPartnerDocId.mockResolvedValue(null);
  mocks.getAll.mockResolvedValue([]);
  mocks.getOne.mockResolvedValue(undefined);
  useAppStore.setState({ user: USER });
});

describe('Phase 6 — collection separation (hard invariant)', () => {
  it('keeps SCHEME_REGISTRATIONS and LOAN_APPLICATIONS as distinct collections', () => {
    expect(C.SCHEME_REGISTRATIONS).toBe('scheme_registrations');
    expect(C.LOAN_APPLICATIONS).toBe('registrations');
    expect(C.SCHEME_REGISTRATIONS).not.toBe(C.LOAN_APPLICATIONS);
  });

  it('uses the SREG- prefix for scheme registrations, distinct from the loan RG- prefix', () => {
    expect(mocks.genId.schemeRegistration()).toMatch(/^SREG-/);
    expect(mocks.genId.registration()).toMatch(/^RG-/);
  });

  it('registers scheme_registrations in the entity registry + project-scoped collections', () => {
    const entry = getEntityRegistryEntry('scheme_registrations');
    expect(entry?.entityType).toBe('scheme_registration');
    expect(entry?.module).toBe('scheme_registration');
    expect(entry?.ownerFields).toContain('partnerId');
    expect(PROJECT_SCOPED_COLLECTIONS.has('scheme_registrations')).toBe(true);
  });

  it('wires scheme_registrations into the case-propagation chain (project parent, not loan customers)', () => {
    const src = readFileSync(new URL('../../lib/casePropagation.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/scheme_registrations:[\s\S]*?parentCollection: 'projects',\s*parentFk: 'projectId'/);
    expect(src).toMatch(/scheme_registrations:\s*COLLECTIONS\.SCHEME_REGISTRATIONS/);
  });
});

describe('Phase 6 — creation + canonical ownership', () => {
  it('creates a Draft record with ownership derived from the project (partner actor)', async () => {
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('PART-1');
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'projects') return PARTNER_PROJECT;
      if (collection === 'channel_partners') return { id: 'PART-1', userId: 'u-partner', managerId: 'u-manager', partnerName: 'Partner One' };
      return undefined;
    });

    const record = await createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' });

    expect(record.id).toBe('SREG-001');
    expect(record.status).toBe('Draft');
    expect(record.partnerId).toBe('PART-1');
    expect(record.partnerName).toBe('Partner One');
    expect(record.userId).toBe('u-partner'); // resolved from channel_partners, not the form
    expect(record.managerId).toBe('u-manager'); // TL/Manager derived from the partner doc
    expect(record.customerName).toBe('Customer One');
    expect(record.companyId).toBe('comp-1');
    expect(record.createdBy).toBe('u-user');
    expect(record.statusHistory[0]).toMatchObject({ status: 'Draft', changedBy: 'u-user' });
    // The locked required-document checklist is initialized (mechanism locked;
    // exact scheme-specific checklist is a business decision).
    expect(record.requiredDocuments?.length).toBe(SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.length);
    expect(allRequiredDocumentsLinked(record.requiredDocuments)).toBe(false);
    expect(mocks.createDocWithId).toHaveBeenCalledWith('scheme_registrations', 'SREG-001', expect.objectContaining({ status: 'Draft' }));
    expect(mocks.propagateCaseIdFromChain).toHaveBeenCalledWith('scheme_registrations', 'SREG-001');
  });

  it('rejects a partner creating a registration for another partner\'s project (§9.3)', async () => {
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('PART-1');
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'projects') return { ...PARTNER_PROJECT, partnerId: 'PART-2' };
      return undefined;
    });

    await expect(createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' }))
      .rejects.toThrow('You can only create a registration for a project you own.');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('staff (non-partner) creation inherits partnerId/partnerName from the project', async () => {
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });

    const record = await createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' });
    expect(record.partnerId).toBe('PART-1');
    expect(record.partnerName).toBe('Partner One');
  });

  it('prevents a SECOND active registration for the same project (§16)', async () => {
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'projects' ? PARTNER_PROJECT : undefined));
    mocks.getAll.mockResolvedValue([baseRecord({ id: 'SREG-000', registrationId: 'SREG-000', status: 'Submitted' })]);
    await expect(createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' }))
      .rejects.toThrow('A scheme registration already exists for this project');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('allows a fresh registration after the previous one was Cancelled (voided)', async () => {
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'projects') return PARTNER_PROJECT;
      if (collection === 'channel_partners') return { id: 'PART-1', userId: 'u-partner' };
      return undefined;
    });
    mocks.getAll.mockResolvedValue([baseRecord({ id: 'SREG-000', registrationId: 'SREG-000', status: 'Cancelled', cancelledAt: '2026-01-05T00:00:00.000Z' })]);
    const record = await createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' });
    expect(record.status).toBe('Draft');
  });

  it('rejects creation once the project is past the New/Registration window (lifecycle guard)', async () => {
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'projects') return { ...PARTNER_PROJECT, currentStage: 'Survey' };
      return undefined;
    });
    await expect(createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' }))
      .rejects.toThrow('A scheme registration can only be created while the project is in the New or Registration stage.');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('rejects creation for an Archived project', async () => {
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'projects') return { ...PARTNER_PROJECT, currentStage: 'Archived' };
      return undefined;
    });
    await expect(createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' }))
      .rejects.toThrow('A scheme registration can only be created while the project is in the New or Registration stage.');
  });

  it('validates a 10-digit applicant phone before creating', async () => {
    await expect(createSchemeRegistration({ projectId: 'PRJ-1', applicantPhone: '123' }))
      .rejects.toThrow('A valid 10-digit mobile number is required.');
  });

  it('enforces the create permission (RBAC)', async () => {
    mocks.canDo.mockImplementation((action: string, module: string) => !(action === 'create' && module === 'scheme_registration'));
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'projects' ? PARTNER_PROJECT : undefined));
    await expect(createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' }))
      .rejects.toThrow('You do not have permission to create scheme registrations.');
  });
});

describe('Phase 6 — status machine (authoritative 8-status model)', () => {
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

  it('follows the canonical happy path Draft → Submitted → UnderVerification → VendorLocked → Completed', async () => {
    const record = transitionHarness();

    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    expect(record.status).toBe('Submitted');
    expect(record.submittedAt).toBeTruthy();
    expect(record.submittedBy).toBe('u-user');

    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    expect(record.status).toBe('UnderVerification');
    expect(record.verificationStartedBy).toBe('u-user');

    await transitionSchemeRegistrationStatus(record.id, 'VendorLocked');
    expect(record.status).toBe('VendorLocked');
    expect(record.vendorLockedAt).toBeTruthy();
    expect(record.vendorLockDate).toBeTruthy(); // §17 vendor-lock data contract
    expect(record.vendorLockedBy).toBe('u-user');

    await transitionSchemeRegistrationStatus(record.id, 'Completed');
    expect(record.status).toBe('Completed');
    expect(record.completedAt).toBeTruthy();
    expect(record.statusHistory).toHaveLength(5);
    expect(record.statusHistory.map((e) => e.status)).toEqual(['Draft', 'Submitted', 'UnderVerification', 'VendorLocked', 'Completed']);
    expect(record.statusHistory.every((e) => e.changedBy === 'u-user' && e.changedAt)).toBe(true);
  });

  it('rejects invalid transitions', async () => {
    const record = transitionHarness();
    await expect(transitionSchemeRegistrationStatus(record.id, 'VendorLocked')).rejects.toThrow(
      'Cannot move a scheme registration from Draft to VendorLocked.',
    );
    expect(isValidSchemeRegistrationTransition('Draft', 'VendorLocked')).toBe(false);
    expect(isValidSchemeRegistrationTransition('Completed', 'Draft')).toBe(false);
  });

  it('treats Vendor Lock as irreversible — no unlock/rejection edge after VendorLocked', async () => {
    expect(isValidSchemeRegistrationTransition('VendorLocked', 'Completed')).toBe(true);
    expect(isValidSchemeRegistrationTransition('VendorLocked', 'Rejected')).toBe(false);
    const record = transitionHarness({ status: 'VendorLocked', vendorLockedAt: '2026-01-10T00:00:00.000Z', vendorLockDate: '2026-01-10' });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Rejected')).rejects.toThrow(
      'Cannot move a scheme registration from VendorLocked to Rejected.',
    );
  });

  it('allows locking directly from Submitted (spec §13)', async () => {
    expect(isValidSchemeRegistrationTransition('Submitted', 'VendorLocked')).toBe(true);
    const record = transitionHarness({ status: 'Submitted', submittedAt: '2026-01-02T00:00:00.000Z' });
    await transitionSchemeRegistrationStatus(record.id, 'VendorLocked');
    expect(record.status).toBe('VendorLocked');
  });

  it('requires an application number or portal reference before submitting', async () => {
    const record = transitionHarness({ applicationNumber: undefined, portalReference: undefined });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Submitted'))
      .rejects.toThrow('Application number or portal reference is required before submitting.');
  });

  it('records the portal reference on submit (manual portal operation — no fake API)', async () => {
    const record = transitionHarness({ applicationNumber: undefined, portalReference: undefined });
    await transitionSchemeRegistrationStatus(record.id, 'Submitted', { portalReference: 'REF-1' });
    expect(record.status).toBe('Submitted');
    expect(record.portalReference).toBe('REF-1');
  });

  it('requires all required documents before submitting', async () => {
    const record = transitionHarness({
      requiredDocuments: [{ category: 'customer_identity', label: 'Customer identity / address proof', required: true }],
    });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Submitted'))
      .rejects.toThrow('All required documents must be attached before submitting.');
  });

  it('requires all required documents before completing', async () => {
    const record = transitionHarness({
      status: 'VendorLocked',
      vendorLockedAt: '2026-01-10T00:00:00.000Z',
      vendorLockDate: '2026-01-10',
      requiredDocuments: [{ category: 'site_photos', label: 'Site photos', required: true }],
    });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Completed'))
      .rejects.toThrow('All required registration documents must be attached before completing the registration.');
  });

  it('advances the project New → SchemeRegistration on submit (forward-only patch)', async () => {
    const record = transitionHarness();
    let project = { ...PARTNER_PROJECT };
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return record;
      if (collection === 'projects') return project;
      return undefined;
    });
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'scheme_registrations') Object.assign(record, patch);
      if (collection === 'projects') project = { ...project, ...patch };
    });

    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    expect(project.currentStage).toBe('SchemeRegistration');
    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', expect.objectContaining({ currentStage: 'SchemeRegistration' }));
  });

  it('requires a vendor selection before Vendor Lock (irreversible lock)', async () => {
    const record = transitionHarness({ vendorName: undefined, vendorId: undefined });
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    await expect(transitionSchemeRegistrationStatus(record.id, 'VendorLocked'))
      .rejects.toThrow('Select a vendor before locking the registration.');
  });

  it('requires a rejection reason', async () => {
    const record = transitionHarness({ status: 'UnderVerification' });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Rejected')).rejects.toThrow('Rejection reason is required.');
  });

  it('supports Rejected → Submitted (resubmit) — there is NO separate Resubmitted status', async () => {
    const record = transitionHarness({ status: 'Rejected', rejectionReason: 'Documents mismatch' });
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    expect(record.status).toBe('Submitted');
    expect(record.rejectionReason).toBe('');
    expect(record.submittedBy).toBe('u-user');
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    expect(record.status).toBe('UnderVerification');
  });

  it('supports Draft → Cancelled (note required) and Failed → Draft / Submitted (retry)', async () => {
    const draft = transitionHarness();
    await expect(transitionSchemeRegistrationStatus(draft.id, 'Cancelled')).rejects.toThrow('Cancellation note is required.');
    await transitionSchemeRegistrationStatus(draft.id, 'Cancelled', { note: 'Withdrawn by partner' });
    expect(draft.status).toBe('Cancelled');
    expect(draft.cancelledAt).toBeTruthy();

    const failed = transitionHarness({ status: 'Failed', failureReason: 'Document mismatch' });
    await transitionSchemeRegistrationStatus(failed.id, 'Draft');
    expect(failed.status).toBe('Draft');
    expect(failed.failureReason).toBe('');
    expect(failed.retriedAt).toBeTruthy();

    const failed2 = transitionHarness({ status: 'Failed', failureReason: 'Document mismatch' });
    await transitionSchemeRegistrationStatus(failed2.id, 'Submitted');
    expect(failed2.status).toBe('Submitted');
    expect(failed2.failureReason).toBe('');
  });

  it('a partner can only cancel BEFORE submission (partner-side transition pairs)', () => {
    expect(isPartnerSideTransition('Draft', 'Submitted')).toBe(true);
    expect(isPartnerSideTransition('Draft', 'Cancelled')).toBe(true);
    expect(isPartnerSideTransition('Rejected', 'Submitted')).toBe(true);
    expect(isPartnerSideTransition('Failed', 'Draft')).toBe(true);
    expect(isPartnerSideTransition('Failed', 'Submitted')).toBe(true);
    expect(isPartnerSideTransition('Submitted', 'Cancelled')).toBe(false);
    expect(isPartnerSideTransition('Submitted', 'UnderVerification')).toBe(false);
    expect(isPartnerSideTransition('UnderVerification', 'Cancelled')).toBe(false);
  });

  it('notifies the record\'s TL/Manager on submit and the partner + TL/Manager on staff outcomes (§18 team-scoped matrix)', async () => {
    const record = transitionHarness();
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    // §18: submission nudges the verification queue via the record's OWN
    // TL/Manager (u-manager) + owning partner (u-partner) — NEVER a
    // company-wide Manager/Admin broadcast.
    expect(mocks.notifyRoleUsers).not.toHaveBeenCalled();
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'u-manager',
      expect.anything(),
      'Scheme registration awaiting verification',
      expect.stringContaining('SREG-001'),
      'scheme_registration', 'SREG-001', 'comp-1', 'PRJ-1',
    );
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'u-partner',
      expect.anything(),
      'Scheme registration awaiting verification',
      expect.stringContaining('SREG-001'),
      'scheme_registration', 'SREG-001', 'comp-1', 'PRJ-1',
    );

    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    await transitionSchemeRegistrationStatus(record.id, 'VendorLocked');
    // Staff outcomes notify the owning partner AND their TL/Manager.
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'u-partner',
      expect.anything(),
      'Registration vendor locked',
      expect.stringContaining('SREG-001'),
      'scheme_registration', 'SREG-001', 'comp-1', 'PRJ-1',
    );
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'u-manager',
      expect.anything(),
      'Registration vendor locked',
      expect.stringContaining('SREG-001'),
      'scheme_registration', 'SREG-001', 'comp-1', 'PRJ-1',
    );
  });
});

describe('Phase 6 — §9.3 ownership + RBAC on transitions', () => {
  function harness(partnerId: string | null, recordPartnerId: string) {
    const record = baseRecord({ partnerId: recordPartnerId });
    mocks.resolveCurrentPartnerDocId.mockResolvedValue(partnerId);
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

  it('a partner cannot perform staff (approve) transitions on their own record', async () => {
    const record = harness('PART-1', 'PART-1');
    await transitionSchemeRegistrationStatus(record.id, 'Submitted'); // partner-side OK
    await expect(transitionSchemeRegistrationStatus(record.id, 'UnderVerification'))
      .rejects.toThrow('This action requires staff approval rights.');
  });

  it('a partner cannot act on another partner\'s registration', async () => {
    const record = harness('PART-1', 'PART-2');
    await expect(transitionSchemeRegistrationStatus(record.id, 'Submitted'))
      .rejects.toThrow('You can only manage your own scheme registrations.');
  });

  it('a non-partner actor without the approve permission is rejected for staff targets', async () => {
    const record = harness(null, 'PART-1');
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    mocks.canDo.mockImplementation((action: string, module: string) => !(action === 'approve' && module === 'scheme_registration'));
    await expect(transitionSchemeRegistrationStatus(record.id, 'UnderVerification'))
      .rejects.toThrow('You do not have permission to approve scheme registrations.');
  });

  // ── VL-9/VL-10: role matrix at the service boundary ──
  it('Director / Management is strictly READ-ONLY — no create, submit or approve', async () => {
    useAppStore.setState({ user: { ...USER, role: 'Director' } });
    mocks.canDo.mockImplementation((action: string) => action === 'view');
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'projects' ? PARTNER_PROJECT : undefined));
    await expect(createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' }))
      .rejects.toThrow('You do not have permission to create scheme registrations.');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();

    const record = baseRecord();
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return record;
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Submitted'))
      .rejects.toThrow('You do not have permission to edit scheme registrations.');
    // A Director is also denied every staff-approval target: use a Submitted
    // record so the transition itself is legal and the PERMISSION is the only
    // thing that can block it.
    const submitted = baseRecord({ status: 'Submitted', submittedAt: '2026-01-02T00:00:00.000Z' });
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return submitted;
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });
    await expect(transitionSchemeRegistrationStatus(submitted.id, 'UnderVerification'))
      .rejects.toThrow('You do not have permission to approve scheme registrations.');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('Manager / TL with the approve permission performs verification + vendor lock', async () => {
    useAppStore.setState({ user: { ...USER, role: 'Manager' } });
    mocks.canDo.mockReturnValue(true);
    const record = baseRecord({ status: 'Submitted', submittedAt: '2026-01-02T00:00:00.000Z' });
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return record;
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'scheme_registrations') Object.assign(record, patch);
    });

    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    expect(record.status).toBe('UnderVerification');
    expect(record.verificationStartedBy).toBe('u-user');
    await transitionSchemeRegistrationStatus(record.id, 'VendorLocked', { vendorId: 'VEN-1', vendorName: 'Vendor A', vendorLockDate: '2026-01-10' });
    expect(record.status).toBe('VendorLocked');
    expect(record.vendorLockedBy).toBe('u-user');
    expect(record.vendorLockDate).toBe('2026-01-10');
  });

  it('Accounts (no Registration permissions) is denied create and transitions', async () => {
    useAppStore.setState({ user: { ...USER, role: 'Accounts' } });
    mocks.canDo.mockImplementation((action: string) => action === 'view');
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'projects' ? PARTNER_PROJECT : undefined));
    await expect(createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' }))
      .rejects.toThrow('You do not have permission to create scheme registrations.');
    const record = baseRecord();
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return record;
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });
    await expect(transitionSchemeRegistrationStatus(record.id, 'Submitted'))
      .rejects.toThrow('You do not have permission to edit scheme registrations.');
  });
});

describe('Phase 6 — Admin-only audited reopen (§13)', () => {
  it('Admin reopens a Completed registration back to Submitted with a Reopened history entry', async () => {
    useAppStore.setState({ user: { ...USER, role: 'Admin' } });
    const record = baseRecord({ status: 'Completed', completedAt: '2026-01-20T00:00:00.000Z' });
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'scheme_registrations' ? record : undefined));
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'scheme_registrations') Object.assign(record, patch);
    });

    const reopened = await reopenSchemeRegistration(record.id, 'Filing error discovered');
    expect(reopened.status).toBe('Submitted');
    expect(reopened.reopenedBy).toBe('u-user');
    const statuses = record.statusHistory.map((e) => e.status);
    expect(statuses).toContain('Reopened');
    expect(statuses).toContain('Submitted');
    expect(record.statusHistory[record.statusHistory.length - 1]).toMatchObject({ status: 'Submitted', changedBy: 'u-user' });
    expect(mocks.logActivity).toHaveBeenCalledWith('scheme_registration', 'reopened', record.id, expect.anything());
  });

  it('refuses reopen for a non-Admin actor', async () => {
    useAppStore.setState({ user: { ...USER, role: 'Manager' } });
    const record = baseRecord({ status: 'Completed', completedAt: '2026-01-20T00:00:00.000Z' });
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'scheme_registrations' ? record : undefined));
    await expect(reopenSchemeRegistration(record.id, 'nope')).rejects.toThrow('Only an Admin can reopen a completed registration.');
  });

  it('refuses reopen for records not in Completed/VendorLocked and requires a reason', async () => {
    useAppStore.setState({ user: { ...USER, role: 'Admin' } });
    const draft = baseRecord({ status: 'Draft' });
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'scheme_registrations' ? draft : undefined));
    await expect(reopenSchemeRegistration(draft.id, 'x')).rejects.toThrow('Only Completed or VendorLocked registrations can be reopened.');
    const completed = baseRecord({ status: 'Completed', completedAt: '2026-01-20T00:00:00.000Z' });
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'scheme_registrations' ? completed : undefined));
    await expect(reopenSchemeRegistration(completed.id, '  ')).rejects.toThrow('A reopen reason is required for the audit trail.');
  });
});

describe('Phase 6 — Survey gate (enforced in the Survey service + helper)', () => {
  const SURVEY_INPUT = {
    projectId: 'PRJ-1',
    surveyorId: 'u-surveyor',
    scheduledDate: '2026-03-01',
  };

  function projectHarness(project: any) {
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'projects') return project;
      return undefined;
    });
  }

  it('blocks scheduling while the registration is Submitted', async () => {
    projectHarness(PARTNER_PROJECT);
    mocks.getAll.mockResolvedValue([baseRecord({ status: 'Submitted' })]);
    await expect(scheduleSurvey(SURVEY_INPUT)).rejects.toThrow(
      'A Survey can be scheduled only after the Registration (Vendor Lock) is Vendor Locked or Completed.',
    );
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('blocks scheduling while the registration is UnderVerification / Rejected', async () => {
    projectHarness(PARTNER_PROJECT);
    mocks.getAll.mockResolvedValue([baseRecord({ status: 'Rejected', rejectionReason: 'x' })]);
    await expect(scheduleSurvey(SURVEY_INPUT)).rejects.toThrow('Vendor Locked or Completed');
    expect(isSurveyGateSatisfied('UnderVerification')).toBe(false);
    expect(isSurveyGateSatisfied('Rejected')).toBe(false);
  });

  it('blocks scheduling at VendorLocked when the vendor-lock data contract is incomplete (§17)', async () => {
    projectHarness(PARTNER_PROJECT);
    mocks.getAll.mockResolvedValue([baseRecord({ status: 'VendorLocked', vendorLockDate: undefined, vendorLockedAt: undefined })]);
    expect(isVendorLockDataComplete(baseRecord({ status: 'VendorLocked', vendorLockDate: undefined, vendorLockedAt: undefined }))).toBe(false);
    await expect(scheduleSurvey(SURVEY_INPUT)).rejects.toThrow('Vendor Locked or Completed');
  });

  it('allows scheduling once the registration is VendorLocked with complete data', async () => {
    let project = { ...PARTNER_PROJECT };
    projectHarness(project);
    mocks.getAll.mockResolvedValue([baseRecord({ status: 'VendorLocked', vendorLockedAt: '2026-02-01T00:00:00.000Z', vendorLockDate: '2026-02-01' })]);
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'projects') project = { ...project, ...patch };
    });

    await scheduleSurvey(SURVEY_INPUT);
    expect(mocks.createDocWithId).toHaveBeenCalledWith('surveys', 'SRV-001', expect.objectContaining({ projectId: 'PRJ-1' }));
    expect(project.currentStage).toBe('Survey');
    expect(isSurveyGateSatisfied('VendorLocked', baseRecord({ status: 'VendorLocked', vendorLockedAt: '2026-02-01T00:00:00.000Z' }))).toBe(true);
  });

  it('allows scheduling once the registration is Completed', async () => {
    projectHarness(PARTNER_PROJECT);
    mocks.getAll.mockResolvedValue([baseRecord({ status: 'Completed', completedAt: '2026-02-02T00:00:00.000Z' })]);
    await scheduleSurvey(SURVEY_INPUT);
    expect(mocks.createDocWithId).toHaveBeenCalledWith('surveys', 'SRV-001', expect.anything());
    expect(isSurveyGateSatisfied('Completed')).toBe(true);
  });

  it('leaves projects with no registration unaffected (gate is vacuous)', async () => {
    projectHarness(PARTNER_PROJECT);
    await scheduleSurvey(SURVEY_INPUT); // getAll → []
    expect(mocks.createDocWithId).toHaveBeenCalledWith('surveys', 'SRV-001', expect.anything());
    expect(isSurveyGateSatisfied(undefined)).toBe(true);
    expect(() => assertSchemeRegistrationSurveyGate({ id: 'PRJ-1' }, null)).not.toThrow();
  });

  it('getSchemeRegistrationForProject returns the latest non-deleted record', async () => {
    mocks.getAll.mockResolvedValue([
      baseRecord({ id: 'SREG-001', registrationId: 'SREG-001', status: 'Submitted', updatedAt: '2026-01-02T00:00:00.000Z' }),
      baseRecord({ id: 'SREG-002', registrationId: 'SREG-002', status: 'VendorLocked', updatedAt: '2026-01-05T00:00:00.000Z' }),
      { ...baseRecord({ id: 'SREG-003', registrationId: 'SREG-003', status: 'Submitted', updatedAt: '2026-01-03T00:00:00.000Z' }), isDeleted: true },
      baseRecord({ id: 'OTHER', registrationId: 'OTHER', projectId: 'PRJ-9', status: 'Draft', updatedAt: '2026-01-09T00:00:00.000Z' }),
    ]);
    const latest = await getSchemeRegistrationForProject('PRJ-1');
    expect(latest?.id).toBe('SREG-002');
  });
});

describe('Phase 6 — naming contract (spec §23): the user-facing stage is exactly "Registration"', () => {
  it('never renames the stage to Vendor Lock / Scheme Registration in stage-card or portal copy', () => {
    const stageSrc = readFileSync(new URL('../../hooks/useProjectStage.ts', import.meta.url), 'utf8');
    const portalSrc = readFileSync(new URL('../../pages/partner/PartnerRegistration.tsx', import.meta.url), 'utf8');
    const workspaceSrc = readFileSync(new URL('../../features/projects/components/workspace/stages/ProjectSchemeRegistrationWorkspace.tsx', import.meta.url), 'utf8');
    // The stage card title is exactly 'Registration' and its description
    // must not rename the stage to "Vendor Lock".
    expect(stageSrc).toContain("title: 'Registration'");
    expect(stageSrc).not.toMatch(/title: 'Registration'[^\n]*description: 'Vendor/);
    // Portal + workspace user-facing copy must not promote "Vendor Lock" as
    // the stage name ("Vendor Lock" remains documentation/action-only).
    expect(portalSrc).not.toContain('Vendor lock /');
    expect(workspaceSrc).not.toContain('File the Vendor Lock');
    expect(portalSrc).toContain('title="My Registration"');
  });
});

describe('Phase 6 — project workspace stage integration', () => {
  it('exposes Registration (SchemeRegistration) as a canonical workspace stage', () => {
    const stages = resolveProjectWorkspaceStages({
      id: 'PRJ-1',
      projectId: 'PRJ-001',
      currentStage: 'SchemeRegistration',
      stageHistory: [],
    } as any);
    const registration = stages.find((s) => s.id === 'registration');
    expect(registration).toBeDefined();
    expect(registration?.projectStage).toBe('SchemeRegistration');
    expect(registration?.title).toBe('Registration');
    expect(registration?.status).toBe('current');
    expect(registration?.href).toBe('/projects/PRJ-1');
    // Canonical position: registration sits BEFORE survey.
    const idxReg = stages.findIndex((s) => s.id === 'registration');
    const idxSurvey = stages.findIndex((s) => s.id === 'survey');
    expect(idxReg).toBeGreaterThanOrEqual(0);
    expect(idxReg).toBeLessThan(idxSurvey);
  });
});
