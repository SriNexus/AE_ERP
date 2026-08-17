import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 9: confirmDelivery() used to unconditionally auto-close the dispatch
// immediately after marking it Delivered, bypassing closeDispatch()'s own
// Accounts-only permission check and making 'Delivered' impossible to ever
// observe as a persisted state. This locks in the fix: confirmDelivery()
// only ever writes 'Delivered' and stops; closing is a separate action.
const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(),
  resolveWorkflowCompanyId: vi.fn(() => 'comp-1'),
  generateDeliveryOTP: vi.fn(),
  hashOTP: vi.fn(() => Promise.resolve('HASH-123456')),
  canDo: vi.fn(() => false),
  getState: vi.fn(),
  genId: { dispatch: vi.fn(() => 'DSP-001'), generic: vi.fn((prefix = 'GEN') => `${prefix}-001`) },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  genId: mocks.genId,
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
  notifyUsers: mocks.notifyUsers,
  usersByRole: mocks.usersByRole,
  resolveWorkflowCompanyId: mocks.resolveWorkflowCompanyId,
  generateDeliveryOTP: mocks.generateDeliveryOTP,
  hashOTP: mocks.hashOTP,
  isDispatchImmutable: (status: string) => status === 'Delivered' || status === 'Closed',
  text: (value: unknown) => (typeof value === 'string' ? value : ''),
  timestampMillis: (value: unknown) => (typeof value === 'number' ? value : 0),
}));

vi.mock('../permissions', () => ({
  canDo: mocks.canDo,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: mocks.getState },
}));

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: { DISPATCH: 'dispatch', ORDERS: 'orders', STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', USERS: 'users' },
  firebaseEnv: { isConfigured: false },
}));

import { confirmDelivery } from '../dispatchWorkflow';

describe('confirmDelivery — Phase 9 no-auto-close guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      user: { id: 'driver-1', role: 'Warehouse', companyId: 'comp-1' },
    });
  });

  it('marks the dispatch Delivered and does not also close it', async () => {
    mocks.getOne.mockResolvedValueOnce({
      id: 'DSP-1', status: 'Dispatched', deliveryOTPHash: 'HASH-123456',
      deliveryOTPExpiresAt: Date.now() + 100000, orderId: 'ORD-1', customer: 'Customer A',
    });

    await confirmDelivery('DSP-1', '123456');

    expect(mocks.updateDocById).toHaveBeenCalledTimes(1);
    expect(mocks.updateDocById).toHaveBeenCalledWith('dispatch', 'DSP-1', expect.objectContaining({ status: 'Delivered', deliveryConfirmed: true }));
    // Closing writes status:'Closed' — confirm that never happens here.
    expect(mocks.updateDocById).not.toHaveBeenCalledWith('dispatch', 'DSP-1', expect.objectContaining({ status: 'Closed' }));
  });
});
