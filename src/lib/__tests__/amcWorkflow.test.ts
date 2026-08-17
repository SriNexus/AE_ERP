/**
 * amcWorkflow.test.ts — Unit tests for AMC Contract Workflow
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
  genId: { payment: vi.fn(() => 'AMC-TEST-ID') },
  getAll: vi.fn(() => Promise.resolve([])),
  getOne: mockGetOne,
  updateDocById: mockUpdateDocById,
  resolveWriteCompanyId: () => {
    const s = mockGetState() as any;
    return s.activeCompanyId || s.company?.id || s.user?.companyId || '';
  },
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
  createAmcContract,
  transitionAmcStatus,
  type AmcContractCreateInput,
  type AmcContractRecord,
} from '../amcWorkflow';

describe('AMC Contract Workflow', () => {
  beforeEach(() => {
    mockGetState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
      user: { id: 'user-1', name: 'Test User' },
    });
  });

  describe('State machine - isValidTransition', () => {
    it('allows Draft → Active', () => {
      expect(isValidTransition('Draft', 'Active')).toBe(true);
    });
    it('allows Draft → Cancelled', () => {
      expect(isValidTransition('Draft', 'Cancelled')).toBe(true);
    });
    it('allows Active → Expired', () => {
      expect(isValidTransition('Active', 'Expired')).toBe(true);
    });
    it('allows Active → Cancelled', () => {
      expect(isValidTransition('Active', 'Cancelled')).toBe(true);
    });
    it('disallows Draft → Expired', () => {
      expect(isValidTransition('Draft', 'Expired')).toBe(false);
    });
    it('disallows Expired → any', () => {
      expect(isValidTransition('Expired', 'Draft')).toBe(false);
      expect(isValidTransition('Expired', 'Active')).toBe(false);
    });
    it('disallows Cancelled → any', () => {
      expect(isValidTransition('Cancelled', 'Draft')).toBe(false);
      expect(isValidTransition('Cancelled', 'Active')).toBe(false);
    });
    it('disallows same-status transitions', () => {
      expect(isValidTransition('Draft', 'Draft')).toBe(false);
      expect(isValidTransition('Active', 'Active')).toBe(false);
    });
  });

  describe('createAmcContract', () => {
    const validInput: AmcContractCreateInput = {
      projectId: 'project-1',
      projectName: 'PRJ-001',
      customerId: 'customer-1',
      customerName: 'Test Customer',
      startDate: '2024-07-01',
      endDate: '2025-06-30',
      visitsPerYear: 2,
      contractValue: 25000,
      assignedToName: 'Test Engineer',
      notes: 'Test AMC contract',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetOne.mockImplementation(async (_collection: string, id: string) =>
        id === 'project-1' ? { id, currentStage: 'Handover', stageHistory: [] } : null
      );
      mockGetState.mockReturnValue({
        activeCompanyId: 'company-1',
        company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
        user: { id: 'user-1', name: 'Test User' },
      });
    });

    it('creates a contract with valid input', async () => {
      const result = await createAmcContract(validInput);
      expect(result.status).toBe('Draft');
      expect(result.customerName).toBe('Test Customer');
      expect(result.projectName).toBe('PRJ-001');
      expect(result.visitsPerYear).toBe(2);
      expect(result.contractValue).toBe(25000);
      expect(mockCreateDocWithId).toHaveBeenCalled();
    });

    it('rejects missing projectId', async () => {
      await expect(createAmcContract({ ...validInput, projectId: '' })).rejects.toThrow('Project is required');
    });

    it('rejects missing customerName', async () => {
      await expect(createAmcContract({ ...validInput, customerName: '' })).rejects.toThrow('Customer name is required');
    });

    it('rejects missing startDate', async () => {
      await expect(createAmcContract({ ...validInput, startDate: '' })).rejects.toThrow('Start date is required');
    });

    it('rejects missing endDate', async () => {
      await expect(createAmcContract({ ...validInput, endDate: '' })).rejects.toThrow('End date is required');
    });

    it('rejects negative visitsPerYear', async () => {
      await expect(createAmcContract({ ...validInput, visitsPerYear: -1 })).rejects.toThrow('Visits per year cannot be negative');
    });

    it('rejects negative contractValue', async () => {
      await expect(createAmcContract({ ...validInput, contractValue: -100 })).rejects.toThrow('Contract value cannot be negative');
    });

    // Phase 11: createAmcContract() previously had no precondition on the
    // Project's currentStage at all, so it could be created (and force-
    // advance the Project stage) from any earlier stage.
    it('rejects creation when the project has not yet reached Handover', async () => {
      mockGetOne.mockImplementation(async (_collection: string, id: string) =>
        id === 'project-1' ? { id, currentStage: 'Subsidy', stageHistory: [] } : null
      );
      await expect(createAmcContract(validInput)).rejects.toThrow(/Handover/);
      expect(mockCreateDocWithId).not.toHaveBeenCalled();
    });

    it('rejects a second open contract while one (Draft/Active) already exists for the project', async () => {
      const { getAll } = await import('../firestore');
      (getAll as any).mockResolvedValueOnce([{ id: 'AMC-OPEN', projectId: 'project-1', status: 'Active', isDeleted: false }]);
      await expect(createAmcContract(validInput)).rejects.toThrow(/already exists/);
      expect(mockCreateDocWithId).not.toHaveBeenCalled();
    });

    it('allows a new contract when the prior one for the project has Expired', async () => {
      const { getAll } = await import('../firestore');
      (getAll as any).mockResolvedValueOnce([{ id: 'AMC-OLD', projectId: 'project-1', status: 'Expired', isDeleted: false }]);
      await createAmcContract(validInput);
      expect(mockCreateDocWithId).toHaveBeenCalled();
    });
  });

  describe('transitionAmcStatus', () => {
    const mockContract: AmcContractRecord = {
      id: 'AMC-001',
      companyId: 'company-1',
      projectId: 'project-1',
      projectName: 'PRJ-001',
      customerId: 'customer-1',
      customerName: 'Test Customer',
      contractNumber: 'AMC-001',
      startDate: '2024-07-01',
      endDate: '2025-06-30',
      visitsPerYear: 2,
      contractValue: 25000,
      notes: '',
      status: 'Draft',
      statusHistory: [{ status: 'Draft', changedAt: '2024-07-01T00:00:00.000Z', changedBy: 'user-1' }],
      createdBy: 'user-1',
      createdAt: '2024-07-01T00:00:00.000Z',
      updatedBy: 'user-1',
      updatedAt: '2024-07-01T00:00:00.000Z',
      isDeleted: false,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetOne.mockImplementation(async (_collection: string, id: string) =>
        id === 'project-1' ? { id, currentStage: 'Handover', stageHistory: [] } : null
      );
      mockGetState.mockReturnValue({
        activeCompanyId: 'company-1',
        company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
        user: { id: 'user-1', name: 'Test User' },
      });
      (mockGetOne as any).mockResolvedValue(mockContract);
    });

    it('transitions Draft → Active', async () => {
      const result = await transitionAmcStatus('AMC-001', 'Active');
      expect(result.status).toBe('Active');
      expect(result.statusHistory.length).toBe(2);
      expect(result.statusHistory[1].status).toBe('Active');
    });

    it('transitions Active → Expired', async () => {
      (mockGetOne as any).mockResolvedValueOnce({
        ...mockContract,
        status: 'Active',
        statusHistory: [...mockContract.statusHistory, { status: 'Active', changedAt: '2024-07-15T00:00:00.000Z', changedBy: 'user-1' }],
      });
      const result = await transitionAmcStatus('AMC-001', 'Expired');
      expect(result.status).toBe('Expired');
      expect(result.expiredAt).toBeDefined();
      expect(result.statusHistory.length).toBe(3);
      expect(result.statusHistory[2].status).toBe('Expired');
    });

    it('transitions Draft → Cancelled with reason', async () => {
      const result = await transitionAmcStatus('AMC-001', 'Cancelled', { note: 'Customer requested cancellation' });
      expect(result.status).toBe('Cancelled');
      expect(result.cancelledAt).toBeDefined();
      expect(result.cancellationReason).toBe('Customer requested cancellation');
    });

    it('rejects invalid transition (Draft → Expired)', async () => {
      await expect(transitionAmcStatus('AMC-001', 'Expired')).rejects.toThrow(/Cannot transition AMC contract/);
    });

    it('rejects transition on deleted contract', async () => {
      (mockGetOne as any).mockResolvedValueOnce({ ...mockContract, isDeleted: true });
      await expect(transitionAmcStatus('AMC-001', 'Active')).rejects.toThrow('Cannot transition a deleted AMC contract');
    });

    it('rejects transition on non-existent contract', async () => {
      (mockGetOne as any).mockResolvedValueOnce(null);
      await expect(transitionAmcStatus('AMC-NONEXIST', 'Active')).rejects.toThrow(/AMC contract .* not found/);
    });
  });
});
