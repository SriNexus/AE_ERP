/**
 * netMeteringWorkflow.test.ts — Unit tests for Net Metering Application Workflow
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
  genId: { generic: vi.fn(() => 'NM-TEST-ID') },
  getAll: vi.fn(() => Promise.resolve([])),
  getOne: vi.fn(() => Promise.resolve({
    id: 'project-1',
    projectId: 'PRJ-001',
    currentStage: 'NetMetering',
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
  createNetMeteringApplication,
  transitionNetMeteringStatus,
  type NetMeteringCreateInput,
  type NetMeteringApplication,
} from '../netMeteringWorkflow';

import * as firestoreMock from '../firestore';
import { COLLECTIONS } from '../firebase';

describe('Net Metering Workflow', () => {
  describe('State machine - isValidTransition', () => {
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

    it('allows Approved → MeterInstalled', () => {
      expect(isValidTransition('Approved', 'MeterInstalled')).toBe(true);
    });

    it('allows Approved → Rejected', () => {
      expect(isValidTransition('Approved', 'Rejected')).toBe(true);
    });

    it('disallows MeterInstalled → any', () => {
      expect(isValidTransition('MeterInstalled', 'Approved')).toBe(false);
      expect(isValidTransition('MeterInstalled', 'Submitted')).toBe(false);
    });

    it('disallows Rejected → any', () => {
      expect(isValidTransition('Rejected', 'Submitted')).toBe(false);
      expect(isValidTransition('Rejected', 'Approved')).toBe(false);
    });

    it('disallows invalid jumps', () => {
      expect(isValidTransition('Submitted', 'Approved')).toBe(false);
      expect(isValidTransition('Submitted', 'MeterInstalled')).toBe(false);
      expect(isValidTransition('UnderReview', 'MeterInstalled')).toBe(false);
    });

    it('disallows same-status transitions', () => {
      expect(isValidTransition('Submitted', 'Submitted')).toBe(false);
      expect(isValidTransition('Approved', 'Approved')).toBe(false);
    });
  });

  describe('createNetMeteringApplication', () => {
    const validInput: NetMeteringCreateInput = {
      projectId: 'project-1',
      projectName: 'PRJ-001',
      discomName: 'TPNODL',
      applicationNumber: 'APP-2024-001',
      submittedDate: '2024-06-01T00:00:00.000Z',
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('creates an application with valid input', async () => {
      const result = await createNetMeteringApplication(validInput);
      expect(result.status).toBe('Submitted');
      expect(result.discomName).toBe('TPNODL');
      expect(result.applicationNumber).toBe('APP-2024-001');
    });

    it('rejects missing projectId', async () => {
      await expect(
        createNetMeteringApplication({ ...validInput, projectId: '' }),
      ).rejects.toThrow('Project ID is required');
    });

    it('rejects missing discomName', async () => {
      await expect(
        createNetMeteringApplication({ ...validInput, discomName: '' }),
      ).rejects.toThrow('DISCOM/Utility name is required');
    });

    it('rejects missing applicationNumber', async () => {
      await expect(
        createNetMeteringApplication({ ...validInput, applicationNumber: '' }),
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
        createNetMeteringApplication({ ...validInput, projectId: 'project-new' }),
      ).rejects.toThrow(/Net metering applications can only be created/);
    });
  });

  describe('transitionNetMeteringStatus', () => {
    const mockApp: NetMeteringApplication = {
      id: 'NM-001',
      companyId: 'company-1',
      projectId: 'project-1',
      projectName: 'PRJ-001',
      discomName: 'TPNODL',
      applicationNumber: 'APP-2024-001',
      status: 'Submitted',
      submittedDate: '2024-06-01T00:00:00.000Z',
      statusHistory: [{ status: 'Submitted', changedAt: '2024-06-01T00:00:00.000Z', changedBy: 'user-1' }],
      createdBy: 'user-1',
      createdAt: '2024-06-01T00:00:00.000Z',
      updatedAt: '2024-06-01T00:00:00.000Z',
      isDeleted: false,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      (firestoreMock.getOne as any).mockResolvedValue(mockApp);
    });

    it('transitions to UnderReview', async () => {
      const result = await transitionNetMeteringStatus('NM-001', 'UnderReview');
      expect(result.status).toBe('UnderReview');
    });

    it('transitions to Rejected with reason', async () => {
      const result = await transitionNetMeteringStatus('NM-001', 'Rejected', {
        rejectionReason: 'Incomplete documentation',
      });
      expect(result.status).toBe('Rejected');
      expect(result.rejectionReason).toBe('Incomplete documentation');
    });

    it('appends to status history on transition', async () => {
      const result = await transitionNetMeteringStatus('NM-001', 'UnderReview');
      expect(result.statusHistory.length).toBe(2);
      expect(result.statusHistory[1].status).toBe('UnderReview');
    });

    it('rejects invalid terminal-state transitions', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({
        ...mockApp,
        status: 'MeterInstalled',
      });
      await expect(
        transitionNetMeteringStatus('NM-001', 'Submitted'),
      ).rejects.toThrow(/Cannot transition/);
    });

    // Phase 16: cross-module regression guard. Before this fix, NEITHER
    // netMeteringWorkflow.ts nor subsidyWorkflow.ts ever advanced the
    // project's currentStage, which meant projectHandoverWorkflow.ts's
    // createHandover() (gated on currentStage>=Subsidy) could never be
    // satisfied by any real code path — Handover, and everything downstream
    // of it (AMC), was structurally unreachable.
    it('reaching MeterInstalled advances the project to the Subsidy stage', async () => {
      const project = { id: 'project-1', projectId: 'PRJ-001', currentStage: 'NetMetering', stageHistory: [] };
      (firestoreMock.getOne as any).mockImplementation((collection: string) =>
        collection === COLLECTIONS.PROJECTS ? Promise.resolve(project) : Promise.resolve({ ...mockApp, status: 'Approved' }),
      );
      await transitionNetMeteringStatus('NM-001', 'MeterInstalled');
      const projectUpdateCall = (firestoreMock.updateDocById as any).mock.calls.find(
        (call: unknown[]) => call[0] === COLLECTIONS.PROJECTS,
      );
      expect(projectUpdateCall, 'expected a projects update advancing the stage').toBeTruthy();
      expect(projectUpdateCall[2]).toMatchObject({ currentStage: 'Subsidy' });
    });

    it('does not regress a project already past the Subsidy stage', async () => {
      const project = { id: 'project-1', projectId: 'PRJ-001', currentStage: 'Handover', stageHistory: [] };
      (firestoreMock.getOne as any).mockImplementation((collection: string) =>
        collection === COLLECTIONS.PROJECTS ? Promise.resolve(project) : Promise.resolve({ ...mockApp, status: 'Approved' }),
      );
      await transitionNetMeteringStatus('NM-001', 'MeterInstalled');
      const projectUpdateCall = (firestoreMock.updateDocById as any).mock.calls.find(
        (call: unknown[]) => call[0] === COLLECTIONS.PROJECTS,
      );
      expect(projectUpdateCall).toBeUndefined();
    });
  });
});
