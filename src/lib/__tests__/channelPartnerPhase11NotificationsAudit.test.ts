/**
 * channelPartnerPhase11NotificationsAudit.test — VL-11 (Registration
 * Notifications + Audit Trail) verification.
 *
 * Reconciles the Registration workflow's notifications against the canonical
 * Channel Partner spec §18 event → recipient table (Partner + TL/Manager for
 * Registration events; Management/Admin NOT recipients) and the Vendor Lock
 * spec §25 audit requirements (structured logUpdate-style audit for create /
 * every transition / Admin reopen / document attachment, in addition to the
 * thin verb activity entry + statusHistory).
 *
 * Covers:
 *   - notifyPartnerTeam recipient resolution (partner + manager, actor-skip,
 *     dedup, optional Management broadcast per §18 "when configured")
 *   - the workflow matrix: create → TL/Manager; submit/resubmit → TL/Manager +
 *     owning partner; staff outcomes → partner + TL/Manager; Admin reopen →
 *     partner + TL/Manager; document attach → audit-only
 *   - security: cross-manager isolation, cross-partner isolation,
 *     cross-company exclusion, NO Admin/Director/Accounts recipients,
 *     no role broadcast (notifyRoleUsers never called by the workflow)
 *   - duplicate prevention: one transition → one notification per recipient;
 *     the acting user is never self-notified
 *   - structured §25 audit entries (oldValues/newValues + actor/company/
 *     project/case/partner metadata) for every event, and NO audit write for
 *     rejected/failed transitions
 *   - statusHistory unaffected by notifications/audit
 *   - loan separation: scheme notifications never use entityType 'registration'
 *     and the loan workflow never references the scheme notification helper
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
    generic: vi.fn(() => 'AUD-001'),
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

vi.mock('../firebase', () => {
  const COLLECTIONS = new Proxy<Record<string, string>>({
    SCHEME_REGISTRATIONS: 'scheme_registrations',
    LOAN_APPLICATIONS: 'registrations',
    AUDIT_LOGS: 'audit_logs',
    NOTIFICATIONS: 'notifications',
  }, { get: (target, key: string) => target[key] ?? key.toLowerCase() });
  return { COLLECTIONS, firebaseEnv: { isConfigured: false }, db: {} };
});

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  genId: mocks.genId,
  resolveWriteCompanyId: mocks.resolveWorkflowCompanyId,
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

vi.mock('../permissions', () => ({ canDo: mocks.canDo }));

vi.mock('../partnerOwnership', () => ({
  resolveCurrentPartnerDocId: mocks.resolveCurrentPartnerDocId,
}));

vi.mock('../casePropagation', () => ({
  propagateCaseIdFromChain: mocks.propagateCaseIdFromChain,
}));

import { useAppStore } from '../../store/useAppStore';
import { NotificationType } from '../../types';
import { getNotificationRoute } from '../notificationRoutes';
import { notifyPartnerTeam } from '../partnerNotifications';
import {
  createSchemeRegistration,
  transitionSchemeRegistrationStatus,
  reopenSchemeRegistration,
  attachRegistrationDocument,
} from '../../features/scheme-registration/services/schemeRegistrationWorkflow';
import { SCHEME_REGISTRATION_REQUIRED_DOCUMENTS, type SchemeRegistrationRecord } from '../../features/scheme-registration/types';

const USER = { id: 'u-user', name: 'Test User', role: 'Manager' } as any;
const PARTNER_PROJECT = {
  id: 'PRJ-1', projectId: 'PRJ-001', currentStage: 'New', partnerId: 'PART-1',
  partnerName: 'Partner One', customerId: 'CUS-1', customerName: 'Customer One',
  customerPhone: '9876543210', leadId: 'LD-1', caseId: 'CASE-1', companyId: 'comp-1',
};
const PARTNER_DOC = { id: 'PART-1', userId: 'u-partner', managerId: 'u-manager', partnerName: 'Partner One' };

function linkedDocs() {
  return SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.map((d) => ({
    ...d,
    documentId: d.required ? `DOC-${d.category}` : undefined,
  }));
}

function baseRecord(overrides: Partial<SchemeRegistrationRecord> = {}): SchemeRegistrationRecord {
  return {
    id: 'SREG-001', registrationId: 'SREG-001', projectId: 'PRJ-1',
    customerId: 'CUS-1', customerName: 'Customer One', leadId: 'LD-1', caseId: 'CASE-1',
    companyId: 'comp-1', partnerId: 'PART-1', partnerName: 'Partner One',
    managerId: 'u-manager', userId: 'u-partner', vendorName: 'Vendor A',
    schemeName: 'PM Surya Ghar', applicationNumber: 'APP-001',
    requiredDocuments: linkedDocs(), documents: [],
    status: 'Draft',
    statusHistory: [{ status: 'Draft', changedAt: '2026-01-01T00:00:00.000Z', changedBy: 'u-user' }],
    createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u-user',
    updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'u-user',
    ...overrides,
  };
}

/** sendNotification recipients actually called with (recipient id list). */
function notifiedRecipients(): string[] {
  return mocks.sendNotification.mock.calls.map((call) => call[0] as string);
}

/** The structured audit entries actually written (audit_logs creates). */
function auditWrites() {
  return mocks.createDocWithId.mock.calls
    .filter((call) => call[0] === 'audit_logs')
    .map((call) => call[2] as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canDo.mockReturnValue(true);
  mocks.resolveCurrentPartnerDocId.mockResolvedValue(null);
  mocks.getAll.mockResolvedValue([]);
  mocks.getOne.mockResolvedValue(undefined);
  useAppStore.setState({ user: USER, activeCompanyId: 'comp-1' });
});

// ── notifyPartnerTeam recipient resolution ──────────────────

describe('VL-11 — notifyPartnerTeam (§18 helper)', () => {
  const opts = {
    partnerUserId: 'u-partner', managerUserId: 'u-manager', actorUserId: 'u-user',
    type: NotificationType.PARTNER_MILESTONE, title: 'T', body: 'B',
    entityType: 'scheme_registration', entityId: 'SREG-001',
    companyId: 'comp-1', projectId: 'PRJ-1',
  };

  it('notifies the partner + TL/Manager and skips the actor', async () => {
    await notifyPartnerTeam(opts);
    expect(notifiedRecipients()).toEqual(expect.arrayContaining(['u-partner', 'u-manager']));
    expect(notifiedRecipients()).not.toContain('u-user');
    // One notification per recipient — no duplicates.
    const counts = notifiedRecipients().reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});
    expect(counts['u-partner']).toBe(1);
    expect(counts['u-manager']).toBe(1);
  });

  it('does not self-notify the acting partner', async () => {
    await notifyPartnerTeam({ ...opts, actorUserId: 'u-partner' });
    expect(notifiedRecipients()).toEqual(['u-manager']);
  });

  it('deduplicates when partner and manager resolve to the same user', async () => {
    await notifyPartnerTeam({ ...opts, managerUserId: 'u-partner' });
    expect(notifiedRecipients()).toEqual(['u-partner']);
  });

  it('emits nothing when neither recipient resolves', async () => {
    await notifyPartnerTeam({ ...opts, partnerUserId: null, managerUserId: null });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('never broadcasts Management by default (Registration table row = Management —)', async () => {
    await notifyPartnerTeam(opts);
    expect(mocks.notifyRoleUsers).not.toHaveBeenCalled();
  });

  it('supports the §18 "when configured" Management broadcast (opt-in only)', async () => {
    await notifyPartnerTeam({ ...opts, includeManagement: true });
    expect(mocks.notifyRoleUsers).toHaveBeenCalledWith(
      ['Director', 'Manager'], 'PARTNER_MILESTONE', 'T', 'B', 'scheme_registration', 'SREG-001', 'comp-1', 'PRJ-1',
    );
  });

  it('threads the canonical companyId + projectId to every notification', async () => {
    await notifyPartnerTeam(opts);
    mocks.sendNotification.mock.calls.forEach((call) => {
      expect(call[6]).toBe('comp-1'); // companyId
      expect(call[7]).toBe('PRJ-1');  // projectId
    });
  });
});

// ── Workflow notification matrix (§18) ──────────────────────

describe('VL-11 — workflow notification matrix (§18: Partner + TL/Manager only)', () => {
  it('notifies the TL/Manager on create — never the acting partner', async () => {
    useAppStore.setState({ user: { id: 'u-partner', name: 'Partner User', role: 'Partner' } as any });
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('PART-1');
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'projects') return PARTNER_PROJECT;
      if (collection === 'channel_partners') return PARTNER_DOC;
      return undefined;
    });
    const record = await createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' });
    expect(record.status).toBe('Draft');
    expect(notifiedRecipients()).toEqual(['u-manager']);
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'u-manager', expect.anything(), 'Registration draft created', expect.stringContaining('SREG-001'),
      'scheme_registration', 'SREG-001', 'comp-1', 'PRJ-1',
    );
  });

  it('submission notifies the owning partner + TL/Manager (staff actor) — no role broadcast', async () => {
    const record = baseRecord();
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return record;
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'scheme_registrations') Object.assign(record, patch);
    });
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    expect(notifiedRecipients()).toEqual(expect.arrayContaining(['u-partner', 'u-manager']));
    expect(notifiedRecipients()).not.toContain('u-user');
    expect(mocks.notifyRoleUsers).not.toHaveBeenCalled();
  });

  it('a partner submitting their OWN record is not self-notified (manager only)', async () => {
    useAppStore.setState({ user: { id: 'u-partner', name: 'Partner User', role: 'Partner' } as any });
    const record = baseRecord();
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return record;
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'scheme_registrations') Object.assign(record, patch);
    });
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    expect(notifiedRecipients()).toEqual(['u-manager']);
  });

  it('staff outcomes (lock / complete / reject) notify partner + TL/Manager', async () => {
    const record = baseRecord({ status: 'UnderVerification' });
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return record;
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'scheme_registrations') Object.assign(record, patch);
    });
    await transitionSchemeRegistrationStatus(record.id, 'VendorLocked', { vendorId: 'VEN-1', vendorName: 'Vendor A', vendorLockDate: '2026-01-10' });
    expect(notifiedRecipients()).toEqual(expect.arrayContaining(['u-partner', 'u-manager']));
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'u-partner', expect.anything(), 'Registration vendor locked', expect.stringContaining('SREG-001'),
      'scheme_registration', 'SREG-001', 'comp-1', 'PRJ-1',
    );
  });

  it('Admin reopen notifies the partner + TL/Manager', async () => {
    useAppStore.setState({ user: { ...USER, role: 'Admin' } });
    const record = baseRecord({ status: 'Completed', completedAt: '2026-01-20T00:00:00.000Z' });
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'scheme_registrations' ? record : undefined));
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'scheme_registrations') Object.assign(record, patch);
    });
    await reopenSchemeRegistration(record.id, 'Filing error');
    expect(notifiedRecipients()).toEqual(expect.arrayContaining(['u-partner', 'u-manager']));
    expect(notifiedRecipients()).not.toContain('u-user'); // admin actor not notified
    expect(mocks.notifyRoleUsers).not.toHaveBeenCalled();
  });

  it('document attachment is audit-only — no notification (required/verified/rejected are the §18 doc events)', async () => {
    const record = baseRecord();
    mocks.getOne.mockImplementation(async (collection: string) => (collection === 'scheme_registrations' ? record : undefined));
    await attachRegistrationDocument(record.id, 'customer_identity', 'DOC-1');
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});

// ── Recipient security / isolation ──────────────────────────

describe('VL-11 — recipient security (no leakage)', () => {
  function harness(record: SchemeRegistrationRecord) {
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

  it('Manager A never receives another Manager\'s team notifications', async () => {
    const record = harness(baseRecord({ managerId: 'u-manager-1', userId: 'u-partner-1' }));
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    expect(notifiedRecipients()).not.toContain('u-manager-2');
    expect(notifiedRecipients()).toContain('u-manager-1');
  });

  it('Partner A never receives Partner B\'s notifications', async () => {
    const record = harness(baseRecord({ partnerId: 'PART-2', userId: 'u-partner-2', managerId: 'u-manager-2' }));
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    expect(notifiedRecipients()).not.toContain('u-partner-1');
    expect(notifiedRecipients()).toContain('u-partner-2');
  });

  it('every notification stays company-scoped to the record\'s own companyId', async () => {
    const record = harness(baseRecord({ companyId: 'comp-2' }));
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    expect(mocks.sendNotification.mock.calls.length).toBeGreaterThan(0);
    mocks.sendNotification.mock.calls.forEach((call) => expect(call[6]).toBe('comp-2'));
    expect(mocks.sendNotification.mock.calls.some((call) => call[6] === 'comp-1')).toBe(false);
  });

  it('no Admin / Director / Accounts user ever receives a Registration notification', async () => {
    const record = harness(baseRecord());
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    await transitionSchemeRegistrationStatus(record.id, 'VendorLocked', { vendorId: 'V', vendorName: 'Vendor A', vendorLockDate: '2026-01-10' });
    expect(notifiedRecipients().some((id) => ['u-admin', 'u-director', 'u-accounts'].includes(id))).toBe(false);
  });

  it('one transition produces at most one notification per recipient (duplicate prevention)', async () => {
    mocks.sendNotification.mockClear();
    const record = harness(baseRecord({ status: 'UnderVerification' }));
    await transitionSchemeRegistrationStatus(record.id, 'VendorLocked', { vendorId: 'V', vendorName: 'Vendor A', vendorLockDate: '2026-01-10' });
    const counts = notifiedRecipients().reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});
    expect(counts['u-partner']).toBe(1);
    expect(counts['u-manager']).toBe(1);
  });
});

// ── Structured audit (§25) ──────────────────────────────────

describe('VL-11 — structured audit trail (§25)', () => {
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

  it('create writes a structured audit entry with actor/company/project/partner context', async () => {
    useAppStore.setState({ user: { id: 'u-partner', name: 'Partner User', role: 'Partner' } as any });
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('PART-1');
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'projects') return PARTNER_PROJECT;
      if (collection === 'channel_partners') return PARTNER_DOC;
      return undefined;
    });
    await createSchemeRegistration({ projectId: 'PRJ-1', vendorName: 'Vendor A' });
    const writes = auditWrites();
    expect(writes.length).toBeGreaterThan(0);
    const createAudit = writes.find((w) => w.entityId === 'SREG-001' && w.action === 'update');
    expect(createAudit).toMatchObject({
      entityType: 'scheme_registration', entityId: 'SREG-001', module: 'scheme_registration',
      oldValues: {}, newValues: { status: 'Draft', projectId: 'PRJ-1' },
      userId: 'u-partner', companyId: 'comp-1',
      metadata: expect.objectContaining({ projectId: 'PRJ-1', caseId: 'CASE-1', partnerId: 'PART-1', actorId: 'u-partner', actorRole: 'Partner' }),
    });
  });

  it('every transition writes a structured audit entry with previous/new status + §25 metadata', async () => {
    const record = transitionHarness();
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    await transitionSchemeRegistrationStatus(record.id, 'VendorLocked', { vendorId: 'VEN-1', vendorName: 'Vendor A', vendorLockDate: '2026-01-10' });
    await transitionSchemeRegistrationStatus(record.id, 'Completed');

    const writes = auditWrites().filter((w) => w.entityId === 'SREG-001');
    const statuses = writes.map((w) => w.newValues?.status);
    expect(statuses).toEqual(expect.arrayContaining(['Submitted', 'UnderVerification', 'VendorLocked', 'Completed']));
    const lockAudit = writes.find((w) => w.newValues?.status === 'VendorLocked');
    expect(lockAudit).toMatchObject({
      oldValues: { status: 'UnderVerification' },
      metadata: expect.objectContaining({
        projectId: 'PRJ-1', caseId: 'CASE-1', partnerId: 'PART-1',
        vendorName: 'Vendor A', actorId: 'u-user', actorRole: 'Manager',
      }),
    });
    // Actor identity is the authenticated user — never a client-supplied value.
    expect(lockAudit.userId).toBe('u-user');
    expect(lockAudit.userRole).toBe('Manager');
    expect(lockAudit.companyId).toBe('comp-1');
  });

  it('reopen writes a structured audit entry (Completed → Submitted, reopened flag)', async () => {
    useAppStore.setState({ user: { ...USER, role: 'Admin' } });
    const record = transitionHarness({ status: 'Completed', completedAt: '2026-01-20T00:00:00.000Z' });
    await reopenSchemeRegistration(record.id, 'Filing error');
    const reopenAudit = auditWrites().find((w) => w.entityId === 'SREG-001' && w.newValues?.reopened === true);
    expect(reopenAudit).toMatchObject({
      oldValues: { status: 'Completed' },
      newValues: { status: 'Submitted', reopened: true },
      metadata: expect.objectContaining({ note: 'Filing error', actorId: 'u-user', actorRole: 'Admin', projectId: 'PRJ-1', caseId: 'CASE-1', partnerId: 'PART-1' }),
    });
  });

  it('document attachment writes a structured audit entry (audit-only event)', async () => {
    const record = transitionHarness();
    await attachRegistrationDocument(record.id, 'site_photos', 'DOC-2');
    const docAudit = auditWrites().find((w) => w.entityId === 'SREG-001' && w.metadata?.category === 'site_photos');
    expect(docAudit).toBeDefined();
    expect(docAudit).toMatchObject({
      entityType: 'scheme_registration',
      oldValues: { documents: 0 },
      newValues: { documents: 1 },
      metadata: expect.objectContaining({ category: 'site_photos', documentId: 'DOC-2', projectId: 'PRJ-1' }),
    });
  });

  it('a REJECTED transition writes NO audit entry (and no notification)', async () => {
    mocks.sendNotification.mockClear();
    const record = transitionHarness();
    const auditBefore = auditWrites().length;
    await expect(transitionSchemeRegistrationStatus(record.id, 'VendorLocked')).rejects.toThrow(
      'Cannot move a scheme registration from Draft to VendorLocked.',
    );
    // No audit + no notification + no record write for the failed transition.
    expect(auditWrites().length).toBe(auditBefore);
    expect(mocks.updateDocById).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('notifications and audit do not disturb the statusHistory contract', async () => {
    const record = transitionHarness();
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    await transitionSchemeRegistrationStatus(record.id, 'UnderVerification');
    expect(record.statusHistory.map((e) => e.status)).toEqual(['Draft', 'Submitted', 'UnderVerification']);
    expect(record.statusHistory.every((e) => e.changedBy === 'u-user' && e.changedAt)).toBe(true);
  });
});

// ── Loan separation + route mapping ─────────────────────────

describe('VL-11 — loan separation + notification routing', () => {
  it('scheme notifications never use the loan entityType \'registration\'', async () => {
    const record = baseRecord();
    mocks.getOne.mockImplementation(async (collection: string) => {
      if (collection === 'scheme_registrations') return record;
      if (collection === 'projects') return PARTNER_PROJECT;
      return undefined;
    });
    mocks.updateDocById.mockImplementation(async (collection: string, _id: string, patch: any) => {
      if (collection === 'scheme_registrations') Object.assign(record, patch);
    });
    await transitionSchemeRegistrationStatus(record.id, 'Submitted');
    mocks.sendNotification.mock.calls.forEach((call) => expect(call[4]).toBe('scheme_registration'));
  });

  it('the loan workflow never references the scheme notification helper or collection', () => {
    const loanSrc = readFileSync(new URL('../../features/loan-applications/services/loanApplicationWorkflow.ts', import.meta.url), 'utf8');
    expect(loanSrc).not.toContain('notifyPartnerTeam');
    expect(loanSrc).not.toContain('scheme_registration');
    // Loan notifications stay on the loan entityType + loan notification types.
    expect(loanSrc).toContain("'registration'");
  });

  it('getNotificationRoute maps scheme_registration to the project workspace (role-safe deep link)', () => {
    expect(getNotificationRoute('scheme_registration', 'SREG-001', 'PRJ-1')).toBe('/projects/PRJ-1');
    expect(getNotificationRoute('schemeregistration', 'SREG-001', 'PRJ-1')).toBe('/projects/PRJ-1');
    expect(getNotificationRoute('scheme_registration', 'SREG-001')).toBe('/projects');
  });

  it('the loan entityType \'registration\' keeps its existing (non-scheme) routing', () => {
    expect(getNotificationRoute('registration', 'RG-001', 'PRJ-1')).toBe('/notifications');
  });
});
