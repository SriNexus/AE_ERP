/**
 * subsidyWorkflow.test.ts — Unit tests for Subsidy Application Workflow
 *
 * Covers:
 * - State machine / valid transitions
 * - Create application (validation, stage check)
 * - Status transitions (all valid paths)
 * - Immutable disbursement ledger
 * - Invalid transitions
 * - Audit logging and notification generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  getState: vi.fn(() => ({
    activeCompanyId: 'company-1',
    company: { id: 'company-1' },
    user: { id: 'user-1', name: 'Test User' },
  })),
}));

// Mock external dependencies
vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: store.getState },
}));

vi.mock('../firestore', () => ({
  createDocWithId: vi.fn(() => Promise.resolve()),
  resolveWriteCompanyId: () => {
    const s = store.getState() as any;
    return s.activeCompanyId || s.company?.id || s.user?.companyId || '';
  },
  genId: {
    generic: vi.fn((prefix: string) => {
      if (prefix === 'SUB') return 'SUB-TEST-ID';
      if (prefix === 'DISB') return 'DISB-TEST-ID';
      return 'GEN-TEST-ID';
    }),
  },
  getAll: vi.fn(() => Promise.resolve([])),
  getOne: vi.fn(() => Promise.resolve({
    id: 'project-1',
    projectId: 'PRJ-001',
    currentStage: 'Subsidy',
    stageHistory: [],
  })),
  updateDocById: vi.fn(() => Promise.resolve()),
}));

vi.mock('../workflow', () => ({
  logActivity: vi.fn(() => Promise.resolve()),
}));

vi.mock('../notifications', () => ({
  notifyRoleUsers: vi.fn(() => Promise.resolve()),
}));

import {
  isValidTransition,
  createSubsidyApplication,
  transitionSubsidyStatus,
  recordDisbursement,
  type SubsidyCreateInput,
  type SubsidyApplication,
  type DisburseInput,
} from '../subsidyWorkflow';

import * as firestoreMock from '../firestore';
import { COLLECTIONS } from '../firebase';

describe('Subsidy Workflow', () => {
  describe('State machine - isValidTransition', () => {
    it('allows Draft → Submitted', () => {
      expect(isValidTransition('Draft', 'Submitted')).toBe(true);
    });

    it('allows Draft → Rejected', () => {
      expect(isValidTransition('Draft', 'Rejected')).toBe(true);
    });

    it('allows Submitted → UnderReview', () => {
      expect(isValidTransition('Submitted', 'UnderReview')).toBe(true);
    });

    it('allows Submitted → Rejected', () => {
      expect(isValidTransition('Submitted', 'Rejected')).toBe(true);
    });

    it('allows UnderReview → Approved', () => {
      expect(isValidTransition('UnderReview', 'Approved')).toBe(true);
    });

    it('allows UnderReview → Rejected', () => {
      expect(isValidTransition('UnderReview', 'Rejected')).toBe(true);
    });

    it('allows Approved → Disbursed', () => {
      expect(isValidTransition('Approved', 'Disbursed')).toBe(true);
    });

    it('allows Approved → Rejected', () => {
      expect(isValidTransition('Approved', 'Rejected')).toBe(true);
    });

    it('disallows Disbursed → any', () => {
      expect(isValidTransition('Disbursed', 'Approved')).toBe(false);
      expect(isValidTransition('Disbursed', 'Submitted')).toBe(false);
    });

    it('disallows Rejected → any', () => {
      expect(isValidTransition('Rejected', 'Submitted')).toBe(false);
      expect(isValidTransition('Rejected', 'Approved')).toBe(false);
    });

    it('disallows invalid jumps', () => {
      expect(isValidTransition('Draft', 'Approved')).toBe(false);
      expect(isValidTransition('Draft', 'Disbursed')).toBe(false);
      expect(isValidTransition('Submitted', 'Approved')).toBe(false);
      expect(isValidTransition('Submitted', 'Disbursed')).toBe(false);
      expect(isValidTransition('UnderReview', 'Disbursed')).toBe(false);
    });

    it('disallows same-status transitions', () => {
      expect(isValidTransition('Draft', 'Draft')).toBe(false);
      expect(isValidTransition('Approved', 'Approved')).toBe(false);
      expect(isValidTransition('Disbursed', 'Disbursed')).toBe(false);
    });
  });

  describe('createSubsidyApplication', () => {
    const validInput: SubsidyCreateInput = {
      projectId: 'project-1',
      projectName: 'PRJ-001',
      schemeName: 'PM Surya Ghar',
      applicationNumber: 'SUB-2024-001',
      submittedDate: '2024-06-01T00:00:00.000Z',
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('creates an application with valid input', async () => {
      const result = await createSubsidyApplication(validInput);
      expect(result.status).toBe('Submitted');
      expect(result.schemeName).toBe('PM Surya Ghar');
      expect(result.applicationNumber).toBe('SUB-2024-001');
      expect(result.disbursements).toEqual([]);
      expect(result.totalDisbursedAmount).toBe(0);
    });

    it('creates as Draft when no submittedDate', async () => {
      const result = await createSubsidyApplication({
        ...validInput,
        submittedDate: undefined,
      });
      expect(result.status).toBe('Draft');
    });

    it('rejects missing projectId', async () => {
      await expect(
        createSubsidyApplication({ ...validInput, projectId: '' }),
      ).rejects.toThrow('Project ID is required');
    });

    it('rejects missing schemeName', async () => {
      await expect(
        createSubsidyApplication({ ...validInput, schemeName: '' }),
      ).rejects.toThrow('Scheme name is required');
    });

    it('rejects missing applicationNumber', async () => {
      await expect(
        createSubsidyApplication({ ...validInput, applicationNumber: '' }),
      ).rejects.toThrow('Application number is required');
    });

    it('rejects project in invalid stage (New)', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({
        id: 'project-new',
        projectId: 'PRJ-NEW',
        currentStage: 'New',
        stageHistory: [],
      });
      await expect(
        createSubsidyApplication({ ...validInput, projectId: 'project-new' }),
      ).rejects.toThrow(/Subsidy applications can only be created/);
    });

    it('accepts project in NetMetering stage', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({
        id: 'project-nm',
        projectId: 'PRJ-NM',
        currentStage: 'NetMetering',
        stageHistory: [],
      });
      const result = await createSubsidyApplication({
        ...validInput,
        projectId: 'project-nm',
      });
      expect(result.status).toBe('Submitted');
    });

    // Phase 16: cross-module regression guard. Before this fix, NEITHER
    // subsidyWorkflow.ts nor netMeteringWorkflow.ts ever advanced the
    // project's currentStage, which meant projectHandoverWorkflow.ts's
    // createHandover() (gated on currentStage>=Subsidy) could never be
    // satisfied by any real code path — Handover, and everything downstream
    // of it (AMC), was structurally unreachable.
    it('filing an application for a project still in NetMetering advances the project to the Subsidy stage', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({
        id: 'project-nm',
        projectId: 'PRJ-NM',
        currentStage: 'NetMetering',
        stageHistory: [],
      });
      await createSubsidyApplication({ ...validInput, projectId: 'project-nm' });
      const projectUpdateCall = (firestoreMock.updateDocById as any).mock.calls.find(
        (call: unknown[]) => call[0] === COLLECTIONS.PROJECTS,
      );
      expect(projectUpdateCall, 'expected a projects update advancing the stage').toBeTruthy();
      expect(projectUpdateCall[2]).toMatchObject({ currentStage: 'Subsidy' });
    });

    it('does not regress a project already past the Subsidy stage', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({
        id: 'project-handover',
        projectId: 'PRJ-HND',
        currentStage: 'Handover',
        stageHistory: [],
      });
      await createSubsidyApplication({ ...validInput, projectId: 'project-handover' });
      const projectUpdateCall = (firestoreMock.updateDocById as any).mock.calls.find(
        (call: unknown[]) => call[0] === COLLECTIONS.PROJECTS,
      );
      expect(projectUpdateCall).toBeUndefined();
    });
  });

  describe('transitionSubsidyStatus', () => {
    const mockApp: SubsidyApplication = {
      id: 'SUB-001',
      companyId: 'company-1',
      projectId: 'project-1',
      projectName: 'PRJ-001',
      schemeName: 'PM Surya Ghar',
      applicationNumber: 'SUB-2024-001',
      status: 'Draft',
      applicationDate: '2024-06-01T00:00:00.000Z',
      statusHistory: [{ status: 'Draft' as const, changedAt: '2024-06-01T00:00:00.000Z', changedBy: 'user-1', note: 'Application draft created' }],
      disbursements: [],
      totalDisbursedAmount: 0,
      createdBy: 'user-1',
      createdAt: '2024-06-01T00:00:00.000Z',
      updatedAt: '2024-06-01T00:00:00.000Z',
      isDeleted: false,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      (firestoreMock.getOne as any).mockResolvedValue(mockApp);
    });

    it('transitions from Draft to Submitted', async () => {
      const result = await transitionSubsidyStatus('SUB-001', 'Submitted');
      expect(result.status).toBe('Submitted');
    });

    it('transitions to UnderReview', async () => {
      const draftApp = { ...mockApp, status: 'Submitted' as const };
      (firestoreMock.getOne as any).mockResolvedValueOnce(draftApp);
      const result = await transitionSubsidyStatus('SUB-001', 'UnderReview');
      expect(result.status).toBe('UnderReview');
    });

    it('transitions to Approved with sanctioned amount', async () => {
      const reviewApp = { ...mockApp, status: 'UnderReview' as const };
      (firestoreMock.getOne as any).mockResolvedValueOnce(reviewApp);
      const result = await transitionSubsidyStatus('SUB-001', 'Approved', {
        approvedDate: '2024-07-01T00:00:00.000Z',
        totalSanctionedAmount: 50000,
      });
      expect(result.status).toBe('Approved');
    });

    it('transitions to Rejected with reason', async () => {
      const result = await transitionSubsidyStatus('SUB-001', 'Rejected', {
        rejectionReason: 'Incomplete documentation',
      });
      expect(result.status).toBe('Rejected');
      expect(result.rejectionReason).toBe('Incomplete documentation');
    });

    it('appends to status history on transition', async () => {
      const result = await transitionSubsidyStatus('SUB-001', 'Submitted');
      expect(result.statusHistory.length).toBe(2);
      expect(result.statusHistory[1].status).toBe('Submitted');
    });

    it('rejects invalid transitions', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({
        ...mockApp,
        status: 'Disbursed',
      });
      await expect(
        transitionSubsidyStatus('SUB-001', 'Approved'),
      ).rejects.toThrow(/Cannot transition/);
    });
  });

  describe('Immutable Disbursement Ledger', () => {
    const mockApprovedApp: SubsidyApplication = {
      id: 'SUB-002',
      companyId: 'company-1',
      projectId: 'project-1',
      projectName: 'PRJ-001',
      schemeName: 'State Scheme',
      applicationNumber: 'SUB-2024-002',
      status: 'Approved',
      applicationDate: '2024-06-01T00:00:00.000Z',
      approvedDate: '2024-07-01T00:00:00.000Z',
      totalSanctionedAmount: 100000,
      statusHistory: [
        { status: 'Draft' as const, changedAt: '2024-06-01T00:00:00.000Z', changedBy: 'user-1' },
        { status: 'Submitted' as const, changedAt: '2024-06-05T00:00:00.000Z', changedBy: 'user-1' },
        { status: 'UnderReview' as const, changedAt: '2024-06-20T00:00:00.000Z', changedBy: 'user-1' },
        { status: 'Approved' as const, changedAt: '2024-07-01T00:00:00.000Z', changedBy: 'user-1' },
      ],
      disbursements: [],
      totalDisbursedAmount: 0,
      createdBy: 'user-1',
      createdAt: '2024-06-01T00:00:00.000Z',
      updatedAt: '2024-07-01T00:00:00.000Z',
      isDeleted: false,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      (firestoreMock.getOne as any).mockResolvedValue(mockApprovedApp);
    });

    it('records a disbursement on an approved application', async () => {
      const input: DisburseInput = {
        amount: 25000,
        referenceNumber: 'PAY-REF-001',
        notes: 'First tranche disbursement',
      };
      const result = await recordDisbursement('SUB-002', input);
      expect(result.disbursements.length).toBe(1);
      expect(result.disbursements[0].amount).toBe(25000);
      expect(result.disbursements[0].referenceNumber).toBe('PAY-REF-001');
      expect(result.totalDisbursedAmount).toBe(25000);
    });

    it('auto-transitions to Disbursed status on first disbursement', async () => {
      const result = await recordDisbursement('SUB-002', { amount: 50000 });
      expect(result.status).toBe('Disbursed');
    });

    it('accumulates multiple disbursements correctly', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce(mockApprovedApp);
      await recordDisbursement('SUB-002', { amount: 25000 });
      // Second call with updated mock
      const updatedApp = {
        ...mockApprovedApp,
        status: 'Disbursed' as const,
        disbursedDate: new Date().toISOString(),
        disbursements: [{
          id: 'DISB-001',
          amount: 25000,
          disbursedDate: new Date().toISOString(),
          disbursedBy: 'user-1',
          createdAt: new Date().toISOString(),
        }],
        totalDisbursedAmount: 25000,
      };
      (firestoreMock.getOne as any).mockResolvedValueOnce(updatedApp);
      const result = await recordDisbursement('SUB-002', { amount: 15000 });
      expect(result.disbursements.length).toBe(2);
      expect(result.totalDisbursedAmount).toBe(40000);
    });

    it('rejects disbursement on non-approved application', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({
        ...mockApprovedApp,
        status: 'Draft',
      });
      await expect(
        recordDisbursement('SUB-002', { amount: 10000 }),
      ).rejects.toThrow(/Disbursements can only be recorded for approved/);
    });

    it('rejects negative or zero disbursement amount', async () => {
      await expect(
        recordDisbursement('SUB-002', { amount: 0 }),
      ).rejects.toThrow('Disbursement amount must be positive');
      await expect(
        recordDisbursement('SUB-002', { amount: -100 }),
      ).rejects.toThrow('Disbursement amount must be positive');
    });
  });
});
