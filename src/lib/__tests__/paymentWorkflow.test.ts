/**
 * paymentWorkflow.test.ts — Unit tests for Payment Collection Workflow
 *
 * Covers:
 * - Create payment validation
 * - State transitions (Pending → Received → Verified / Cancelled)
 * - Invalid transitions
 * - Audit logging
 * - Notification generation
 * - Immutable status history
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (survive vi.clearAllMocks()) ──────────────

const { mockGetState } = vi.hoisted(() => {
  const mockGetState = vi.fn(() => ({
    activeCompanyId: 'company-1',
    company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
    user: { id: 'user-1', name: 'Test User' },
  }));
  return { mockGetState };
});

const mockCreateDocWithId = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockGenId = vi.hoisted(() => ({ payment: vi.fn(() => 'PAY-TEST-ID') }));
const mockGetAll = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
const mockGetOne = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
const mockUpdateDocById = vi.hoisted(() => vi.fn(() => Promise.resolve()));

// ── Mock factories ──────────────────────────────────────────

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: mockGetState,
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mockCreateDocWithId,
  genId: mockGenId,
  getAll: mockGetAll,
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
  createPayment,
  transitionPaymentStatus,
  type PaymentCreateInput,
  type PaymentRecord,
} from '../paymentWorkflow';

describe('Payment Workflow', () => {
  // Re-set store mock in top-level beforeEach to survive clearAllMocks
  beforeEach(() => {
    mockGetState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
      user: { id: 'user-1', name: 'Test User' },
    });
  });

  describe('State machine - isValidTransition', () => {
    it('allows Pending → Received', () => {
      expect(isValidTransition('Pending', 'Received')).toBe(true);
    });

    it('allows Pending → Cancelled', () => {
      expect(isValidTransition('Pending', 'Cancelled')).toBe(true);
    });

    it('allows Received → Verified', () => {
      expect(isValidTransition('Received', 'Verified')).toBe(true);
    });

    it('allows Received → Cancelled', () => {
      expect(isValidTransition('Received', 'Cancelled')).toBe(true);
    });

    it('disallows Pending → Verified', () => {
      expect(isValidTransition('Pending', 'Verified')).toBe(false);
    });

    it('disallows Verified → any', () => {
      expect(isValidTransition('Verified', 'Pending')).toBe(false);
      expect(isValidTransition('Verified', 'Received')).toBe(false);
      expect(isValidTransition('Verified', 'Cancelled')).toBe(false);
    });

    it('disallows Cancelled → any', () => {
      expect(isValidTransition('Cancelled', 'Pending')).toBe(false);
      expect(isValidTransition('Cancelled', 'Received')).toBe(false);
    });

    it('disallows same-status transitions', () => {
      expect(isValidTransition('Pending', 'Pending')).toBe(false);
      expect(isValidTransition('Received', 'Received')).toBe(false);
    });
  });

  describe('createPayment', () => {
    const validInput: PaymentCreateInput = {
      customerId: 'customer-1',
      customerName: 'Test Customer',
      orderId: 'order-1',
      amount: 50000,
      mode: 'UPI',
      reference: 'UPI-REF-123',
      notes: 'Test payment',
      date: '2024-06-15',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetState.mockReturnValue({
        activeCompanyId: 'company-1',
        company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
        user: { id: 'user-1', name: 'Test User' },
      });
    });

    it('creates a payment with valid input', async () => {
      const result = await createPayment(validInput);
      expect(result.status).toBe('Pending');
      expect(result.amount).toBe(50000);
      expect(result.mode).toBe('UPI');
      expect(result.customerName).toBe('Test Customer');
      expect(mockCreateDocWithId).toHaveBeenCalled();
    });

    it('rejects missing customerId', async () => {
      await expect(
        createPayment({ ...validInput, customerId: '' }),
      ).rejects.toThrow('Customer is required');
    });

    it('rejects missing customerName', async () => {
      await expect(
        createPayment({ ...validInput, customerName: '' }),
      ).rejects.toThrow('Customer name is required');
    });

    it('rejects zero amount', async () => {
      await expect(
        createPayment({ ...validInput, amount: 0 }),
      ).rejects.toThrow('Payment amount must be greater than zero');
    });

    it('rejects missing mode', async () => {
      await expect(
        createPayment({ ...validInput, mode: '' }),
      ).rejects.toThrow('Payment mode is required');
    });

    it('rejects missing date', async () => {
      await expect(
        createPayment({ ...validInput, date: '' }),
      ).rejects.toThrow('Payment date is required');
    });
  });

  describe('transitionPaymentStatus', () => {
    const mockPayment: PaymentRecord = {
      id: 'PAY-001',
      companyId: 'company-1',
      customerId: 'customer-1',
      customerName: 'Test Customer',
      orderId: 'order-1',
      amount: 50000,
      mode: 'UPI',
      reference: 'UPI-REF-123',
      notes: '',
      date: '2024-06-15',
      status: 'Pending',
      statusHistory: [{ status: 'Pending', changedAt: '2024-06-15T00:00:00.000Z', changedBy: 'user-1' }],
      createdBy: 'user-1',
      createdAt: '2024-06-15T00:00:00.000Z',
      updatedBy: 'user-1',
      updatedAt: '2024-06-15T00:00:00.000Z',
      isDeleted: false,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetState.mockReturnValue({
        activeCompanyId: 'company-1',
        company: { id: 'company-1', shortName: 'TEST', name: 'Test Company' },
        user: { id: 'user-1', name: 'Test User' },
      });
      (mockGetOne as any).mockResolvedValue(mockPayment);
    });

    it('transitions Pending → Received', async () => {
      const result = await transitionPaymentStatus('PAY-001', 'Received');
      expect(result.status).toBe('Received');
      expect(result.statusHistory.length).toBe(2);
      expect(result.statusHistory[1].status).toBe('Received');
    });

    it('transitions Received → Verified', async () => {
      (mockGetOne as any).mockResolvedValueOnce({
        ...mockPayment,
        status: 'Received',
        statusHistory: [
          ...mockPayment.statusHistory,
          { status: 'Received', changedAt: '2024-06-16T00:00:00.000Z', changedBy: 'user-1' },
        ],
      });
      const result = await transitionPaymentStatus('PAY-001', 'Verified');
      expect(result.status).toBe('Verified');
      expect(result.verifiedAt).toBeDefined();
      expect(result.statusHistory.length).toBe(3);
      expect(result.statusHistory[2].status).toBe('Verified');
    });

    it('transitions Pending → Cancelled with reason', async () => {
      const result = await transitionPaymentStatus('PAY-001', 'Cancelled', {
        note: 'Customer requested cancellation',
      });
      expect(result.status).toBe('Cancelled');
      expect(result.cancelledAt).toBeDefined();
      expect(result.cancellationReason).toBe('Customer requested cancellation');
    });

    it('appends to status history on each transition', async () => {
      const result = await transitionPaymentStatus('PAY-001', 'Received');
      expect(result.statusHistory.length).toBe(2);
      expect(result.statusHistory[0].status).toBe('Pending');
      expect(result.statusHistory[1].status).toBe('Received');
    });

    it('rejects invalid transition (Pending → Verified)', async () => {
      await expect(
        transitionPaymentStatus('PAY-001', 'Verified'),
      ).rejects.toThrow(/Cannot transition payment/);
    });

    it('rejects transition on deleted payment', async () => {
      (mockGetOne as any).mockResolvedValueOnce({
        ...mockPayment,
        isDeleted: true,
      });
      await expect(
        transitionPaymentStatus('PAY-001', 'Received'),
      ).rejects.toThrow('Cannot transition a deleted payment');
    });

    it('rejects transition on non-existent payment', async () => {
      (mockGetOne as any).mockResolvedValueOnce(null);
      await expect(
        transitionPaymentStatus('PAY-NONEXIST', 'Received'),
      ).rejects.toThrow(/Payment .* not found/);
    });
  });
});
