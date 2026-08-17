/**
 * serviceTicketWorkflow.test.ts — Unit tests for Service Ticket Workflow
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
  genId: { payment: vi.fn(() => 'STK-TEST-ID') },
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
  createServiceTicket,
  transitionTicketStatus,
  reassignServiceTicket,
  type ServiceTicketCreateInput,
  type ServiceTicketRecord,
} from '../serviceTicketWorkflow';

describe('Service Ticket Workflow', () => {
  beforeEach(() => {
    mockGetState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
      user: { id: 'user-1', name: 'Test User' },
    });
  });

  describe('State machine - isValidTransition', () => {
    it('allows Open → InProgress', () => {
      expect(isValidTransition('Open', 'InProgress')).toBe(true);
    });
    it('allows Open → Cancelled', () => {
      expect(isValidTransition('Open', 'Cancelled')).toBe(true);
    });
    it('allows InProgress → Resolved', () => {
      expect(isValidTransition('InProgress', 'Resolved')).toBe(true);
    });
    it('allows InProgress → Cancelled', () => {
      expect(isValidTransition('InProgress', 'Cancelled')).toBe(true);
    });
    it('allows Resolved → Closed', () => {
      expect(isValidTransition('Resolved', 'Closed')).toBe(true);
    });
    it('allows Resolved → Cancelled', () => {
      expect(isValidTransition('Resolved', 'Cancelled')).toBe(true);
    });
    it('disallows Open → Closed', () => {
      expect(isValidTransition('Open', 'Closed')).toBe(false);
    });
    it('disallows Closed → any', () => {
      expect(isValidTransition('Closed', 'Open')).toBe(false);
      expect(isValidTransition('Closed', 'InProgress')).toBe(false);
      expect(isValidTransition('Closed', 'Resolved')).toBe(false);
    });
    it('disallows Cancelled → any', () => {
      expect(isValidTransition('Cancelled', 'Open')).toBe(false);
      expect(isValidTransition('Cancelled', 'InProgress')).toBe(false);
    });
    it('disallows same-status transitions', () => {
      expect(isValidTransition('Open', 'Open')).toBe(false);
      expect(isValidTransition('InProgress', 'InProgress')).toBe(false);
      expect(isValidTransition('Resolved', 'Resolved')).toBe(false);
      expect(isValidTransition('Closed', 'Closed')).toBe(false);
    });
  });

  describe('createServiceTicket', () => {
    const validInput: ServiceTicketCreateInput = {
      projectId: 'project-1',
      projectName: 'PRJ-001',
      customerId: 'customer-1',
      customerName: 'Test Customer',
      issueType: 'Fault Repair',
      description: 'Solar inverter not working',
      priority: 'High',
      assignedTechnicianName: 'Test Technician',
      notes: 'Customer reported issue via phone',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetOne.mockImplementation(async (_collection: string, id: string) =>
        id === 'project-1' ? { id, currentStage: 'NetMetering', stageHistory: [] } : null
      );
      mockGetState.mockReturnValue({
        activeCompanyId: 'company-1',
        company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
        user: { id: 'user-1', name: 'Test User' },
      });
    });

    it('creates a ticket with valid input', async () => {
      const result = await createServiceTicket(validInput);
      expect(result.status).toBe('Open');
      expect(result.customerName).toBe('Test Customer');
      expect(result.issueType).toBe('Fault Repair');
      expect(result.description).toBe('Solar inverter not working');
      expect(result.priority).toBe('High');
      expect(mockCreateDocWithId).toHaveBeenCalled();
    });

    it('rejects missing projectId', async () => {
      await expect(createServiceTicket({ ...validInput, projectId: '' })).rejects.toThrow('Project is required');
    });

    it('rejects missing customerName', async () => {
      await expect(createServiceTicket({ ...validInput, customerName: '' })).rejects.toThrow('Customer name is required');
    });

    it('rejects missing issueType', async () => {
      await expect(createServiceTicket({ ...validInput, issueType: '' })).rejects.toThrow('Issue type is required');
    });

    it('rejects missing description', async () => {
      await expect(createServiceTicket({ ...validInput, description: '' })).rejects.toThrow('Description is required');
    });
  });

  describe('transitionTicketStatus', () => {
    const mockTicket: ServiceTicketRecord = {
      id: 'STK-001',
      companyId: 'company-1',
      projectId: 'project-1',
      projectName: 'PRJ-001',
      customerId: 'customer-1',
      customerName: 'Test Customer',
      ticketNumber: 'STK-001',
      issueType: 'Fault Repair',
      description: 'Solar inverter not working',
      priority: 'High',
      reportedDate: '2024-07-01T00:00:00.000Z',
      assignedTechnician: 'tech-1',
      assignedTechnicianName: 'Test Technician',
      notes: '',
      status: 'Open',
      statusHistory: [{ status: 'Open', changedAt: '2024-07-01T00:00:00.000Z', changedBy: 'user-1' }],
      createdBy: 'user-1',
      createdAt: '2024-07-01T00:00:00.000Z',
      updatedBy: 'user-1',
      updatedAt: '2024-07-01T00:00:00.000Z',
      isDeleted: false,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetOne.mockImplementation(async (_collection: string, id: string) =>
        id === 'project-1' ? { id, currentStage: 'NetMetering', stageHistory: [] } : null
      );
      mockGetState.mockReturnValue({
        activeCompanyId: 'company-1',
        company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
        user: { id: 'user-1', name: 'Test User' },
      });
      (mockGetOne as any).mockResolvedValue(mockTicket);
    });

    it('transitions Open → InProgress', async () => {
      const result = await transitionTicketStatus('STK-001', 'InProgress');
      expect(result.status).toBe('InProgress');
      expect(result.statusHistory.length).toBe(2);
      expect(result.statusHistory[1].status).toBe('InProgress');
    });

    it('transitions InProgress → Resolved', async () => {
      (mockGetOne as any).mockResolvedValueOnce({
        ...mockTicket,
        status: 'InProgress',
        statusHistory: [...mockTicket.statusHistory, { status: 'InProgress', changedAt: '2024-07-02T00:00:00.000Z', changedBy: 'user-1' }],
      });
      const result = await transitionTicketStatus('STK-001', 'Resolved');
      expect(result.status).toBe('Resolved');
      expect(result.resolvedAt).toBeDefined();
      expect(result.statusHistory.length).toBe(3);
      expect(result.statusHistory[2].status).toBe('Resolved');
    });

    it('transitions Resolved → Closed', async () => {
      (mockGetOne as any).mockResolvedValueOnce({
        ...mockTicket,
        status: 'Resolved',
        statusHistory: [
          ...mockTicket.statusHistory,
          { status: 'InProgress', changedAt: '2024-07-02T00:00:00.000Z', changedBy: 'user-1' },
          { status: 'Resolved', changedAt: '2024-07-03T00:00:00.000Z', changedBy: 'user-1' },
        ],
      });
      const result = await transitionTicketStatus('STK-001', 'Closed');
      expect(result.status).toBe('Closed');
      expect(result.closedAt).toBeDefined();
      expect(result.statusHistory.length).toBe(4);
      expect(result.statusHistory[3].status).toBe('Closed');
    });

    it('transitions Open → Cancelled with reason', async () => {
      const result = await transitionTicketStatus('STK-001', 'Cancelled', { note: 'Customer cancelled request' });
      expect(result.status).toBe('Cancelled');
      expect(result.cancelledAt).toBeDefined();
      expect(result.cancellationReason).toBe('Customer cancelled request');
    });

    it('rejects invalid transition (Open → Closed)', async () => {
      await expect(transitionTicketStatus('STK-001', 'Closed')).rejects.toThrow(/Cannot transition service ticket/);
    });

    it('rejects transition on deleted ticket', async () => {
      (mockGetOne as any).mockResolvedValueOnce({ ...mockTicket, isDeleted: true });
      await expect(transitionTicketStatus('STK-001', 'InProgress')).rejects.toThrow('Cannot transition a deleted service ticket');
    });

    it('rejects transition on non-existent ticket', async () => {
      (mockGetOne as any).mockResolvedValueOnce(null);
      await expect(transitionTicketStatus('STK-NONEXIST', 'InProgress')).rejects.toThrow(/Service ticket .* not found/);
    });
  });

  describe('reassignServiceTicket', () => {
    // Phase 11: ServiceTickets.tsx's bulk-assign previously wrote a field
    // called assignedTechnicianId directly via a raw updateDocById — a typo
    // against the real schema field (assignedTechnician), so bulk-
    // reassignment silently failed to update the ID any filter/lookup
    // reads. Fixed by routing through this real service function.
    it('writes the real assignedTechnician/assignedTechnicianName fields, not a mistyped assignedTechnicianId', async () => {
      vi.clearAllMocks();
      await reassignServiceTicket('STK-1', 'USR-9', 'Reassigned Technician');
      expect(mockUpdateDocById).toHaveBeenCalledWith('service_tickets', 'STK-1', {
        assignedTechnician: 'USR-9',
        assignedTechnicianName: 'Reassigned Technician',
      });
    });
  });
});
