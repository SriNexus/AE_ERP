/**
 * projectHandoverWorkflow.test.ts — Unit tests for Project Handover Workflow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetState } = vi.hoisted(() => {
  const mockGetState = vi.fn(() => ({
    activeCompanyId: 'company-1',
    company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
    user: { id: 'user-1', name: 'Test User' },
  }));
  return { mockGetState };
});

const mockCreateDocWithId = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockGetOne = vi.hoisted(() => vi.fn((_collection: string, _id: string): Promise<unknown> => Promise.resolve(null)));
const mockUpdateDocById = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: mockGetState },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mockCreateDocWithId,
  genId: { payment: vi.fn(() => 'HDO-TEST-ID') },
  getAll: vi.fn(() => Promise.resolve([])),
  getOne: mockGetOne,
  updateDocById: mockUpdateDocById,
}));

vi.mock('firebase/firestore', () => ({
  initializeFirestore: vi.fn(() => ({})),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  connectFirestoreEmulator: vi.fn(),
  getCountFromServer: vi.fn(() => Promise.resolve({ data: () => ({ count: 0 }) })),
  getDocs: vi.fn(() => Promise.resolve({ size: 0, docs: [], forEach: vi.fn() })),
  doc: vi.fn(() => ({})),
  runTransaction: vi.fn(async (db: any, fn: any) => {
    const transaction = {
      get: vi.fn(() => Promise.resolve({ exists: () => false, data: () => null })),
      set: vi.fn(() => {}),
    };
    return fn(transaction);
  }),
  serverTimestamp: vi.fn(() => new Date().toISOString()),
}));

vi.mock('../workflow', () => ({
  logActivity: vi.fn(() => Promise.resolve()),
}));

vi.mock('../notifications', () => ({
  notifyRoleUsers: vi.fn(() => Promise.resolve()),
}));

import {
  isValidTransition,
  createHandover,
  transitionHandoverStatus,
  type HandoverCreateInput,
  type HandoverRecord,
} from '../projectHandoverWorkflow';

describe('Project Handover Workflow', () => {
  beforeEach(() => {
    mockGetState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
      user: { id: 'user-1', name: 'Test User' },
    });
  });

  describe('State machine - isValidTransition', () => {
    it('allows Draft → Scheduled', () => {
      expect(isValidTransition('Draft', 'Scheduled')).toBe(true);
    });
    it('allows Draft → Cancelled', () => {
      expect(isValidTransition('Draft', 'Cancelled')).toBe(true);
    });
    it('allows Scheduled → Completed', () => {
      expect(isValidTransition('Scheduled', 'Completed')).toBe(true);
    });
    it('allows Scheduled → Cancelled', () => {
      expect(isValidTransition('Scheduled', 'Cancelled')).toBe(true);
    });
    it('disallows Draft → Completed', () => {
      expect(isValidTransition('Draft', 'Completed')).toBe(false);
    });
    it('disallows Completed → any', () => {
      expect(isValidTransition('Completed', 'Draft')).toBe(false);
      expect(isValidTransition('Completed', 'Scheduled')).toBe(false);
    });
    it('disallows Cancelled → any', () => {
      expect(isValidTransition('Cancelled', 'Draft')).toBe(false);
      expect(isValidTransition('Cancelled', 'Scheduled')).toBe(false);
    });
    it('disallows same-status transitions', () => {
      expect(isValidTransition('Draft', 'Draft')).toBe(false);
      expect(isValidTransition('Scheduled', 'Scheduled')).toBe(false);
    });
  });

  describe('createHandover', () => {
    const validInput: HandoverCreateInput = {
      projectId: 'project-1',
      projectName: 'PRJ-001',
      customerId: 'customer-1',
      customerName: 'Test Customer',
      handoverDate: '2024-06-15',
      assignedEngineerName: 'Test Engineer',
      notes: 'Test handover',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetOne.mockImplementation(async (_collection: string, id: string) =>
        id === 'project-1' ? { id, currentStage: 'Subsidy', stageHistory: [] } : null
      );
      mockGetState.mockReturnValue({
        activeCompanyId: 'company-1',
        company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
        user: { id: 'user-1', name: 'Test User' },
      });
    });

    it('creates a handover with valid input', async () => {
      const result = await createHandover(validInput);
      expect(result.status).toBe('Draft');
      expect(result.customerName).toBe('Test Customer');
      expect(result.projectName).toBe('PRJ-001');
      expect(mockCreateDocWithId).toHaveBeenCalled();
    });

    it('rejects missing projectId', async () => {
      await expect(createHandover({ ...validInput, projectId: '' })).rejects.toThrow('Project is required');
    });

    it('rejects missing customerName', async () => {
      await expect(createHandover({ ...validInput, customerName: '' })).rejects.toThrow('Customer name is required');
    });

    it('rejects missing handoverDate', async () => {
      await expect(createHandover({ ...validInput, handoverDate: '' })).rejects.toThrow('Handover date is required');
    });

    // Phase 11: createHandover() previously had no precondition on the
    // Project's currentStage at all, so it could be created (and force-
    // advance the Project stage) from any earlier stage.
    it('rejects creation when the project has not yet reached Subsidy', async () => {
      mockGetOne.mockImplementation(async (_collection: string, id: string) =>
        id === 'project-1' ? { id, currentStage: 'NetMetering', stageHistory: [] } : null
      );
      await expect(createHandover(validInput)).rejects.toThrow(/Subsidy/);
      expect(mockCreateDocWithId).not.toHaveBeenCalled();
    });

    it('rejects a second open handover while one (Draft/Scheduled) already exists for the project', async () => {
      const { getAll } = await import('../firestore');
      (getAll as any).mockResolvedValueOnce([{ id: 'HDO-OPEN', projectId: 'project-1', status: 'Scheduled', isDeleted: false }]);
      await expect(createHandover(validInput)).rejects.toThrow(/already exists/);
      expect(mockCreateDocWithId).not.toHaveBeenCalled();
    });

    it('allows a new handover when the prior one for the project was Cancelled', async () => {
      const { getAll } = await import('../firestore');
      (getAll as any).mockResolvedValueOnce([{ id: 'HDO-OLD', projectId: 'project-1', status: 'Cancelled', isDeleted: false }]);
      await createHandover(validInput);
      expect(mockCreateDocWithId).toHaveBeenCalled();
    });
  });

  describe('transitionHandoverStatus', () => {
    const mockHandover: HandoverRecord = {
      id: 'HDO-001',
      companyId: 'company-1',
      projectId: 'project-1',
      projectName: 'PRJ-001',
      customerId: 'customer-1',
      customerName: 'Test Customer',
      handoverNumber: 'HDO-001',
      handoverDate: '2024-06-15',
      notes: '',
      status: 'Draft',
      statusHistory: [{ status: 'Draft', changedAt: '2024-06-15T00:00:00.000Z', changedBy: 'user-1' }],
      createdBy: 'user-1',
      createdAt: '2024-06-15T00:00:00.000Z',
      updatedBy: 'user-1',
      updatedAt: '2024-06-15T00:00:00.000Z',
      isDeleted: false,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetOne.mockImplementation(async (_collection: string, id: string) =>
        id === 'project-1' ? { id, currentStage: 'Subsidy', stageHistory: [] } : null
      );
      mockGetState.mockReturnValue({
        activeCompanyId: 'company-1',
        company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
        user: { id: 'user-1', name: 'Test User' },
      });
      (mockGetOne as any).mockResolvedValue(mockHandover);
    });

    it('transitions Draft → Scheduled', async () => {
      const result = await transitionHandoverStatus('HDO-001', 'Scheduled');
      expect(result.status).toBe('Scheduled');
      expect(result.statusHistory.length).toBe(2);
      expect(result.statusHistory[1].status).toBe('Scheduled');
    });

    it('transitions Scheduled → Completed', async () => {
      (mockGetOne as any).mockResolvedValueOnce({
        ...mockHandover,
        status: 'Scheduled',
        statusHistory: [...mockHandover.statusHistory, { status: 'Scheduled', changedAt: '2024-06-16T00:00:00.000Z', changedBy: 'user-1' }],
      });
      const result = await transitionHandoverStatus('HDO-001', 'Completed');
      expect(result.status).toBe('Completed');
      expect(result.completedAt).toBeDefined();
      expect(result.statusHistory.length).toBe(3);
      expect(result.statusHistory[2].status).toBe('Completed');
    });

    it('transitions Draft → Cancelled with reason', async () => {
      const result = await transitionHandoverStatus('HDO-001', 'Cancelled', { note: 'Project on hold' });
      expect(result.status).toBe('Cancelled');
      expect(result.cancelledAt).toBeDefined();
      expect(result.cancellationReason).toBe('Project on hold');
    });

    it('sets scheduledDate and engineer on Schedule transition', async () => {
      const result = await transitionHandoverStatus('HDO-001', 'Scheduled', {
        scheduledDate: '2024-06-20',
        assignedEngineer: 'eng-1',
        assignedEngineerName: 'Engineer One',
      });
      expect(result.status).toBe('Scheduled');
      expect(result.scheduledDate).toBe('2024-06-20');
      expect(result.assignedEngineer).toBe('eng-1');
      expect(result.assignedEngineerName).toBe('Engineer One');
    });

    it('rejects invalid transition (Draft → Completed)', async () => {
      await expect(transitionHandoverStatus('HDO-001', 'Completed')).rejects.toThrow(/Cannot transition handover/);
    });

    it('rejects transition on deleted handover', async () => {
      (mockGetOne as any).mockResolvedValueOnce({ ...mockHandover, isDeleted: true });
      await expect(transitionHandoverStatus('HDO-001', 'Scheduled')).rejects.toThrow('Cannot transition a deleted handover record');
    });

    it('rejects transition on non-existent handover', async () => {
      (mockGetOne as any).mockResolvedValueOnce(null);
      await expect(transitionHandoverStatus('HDO-NONEXIST', 'Scheduled')).rejects.toThrow(/Handover .* not found/);
    });
  });
});
