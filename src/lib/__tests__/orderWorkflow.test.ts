import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType } from '../../types';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  getNextDocumentNumber: vi.fn(),
  resolveDocumentDefaults: vi.fn(),
  notifyRoleUsers: vi.fn(),
  genId: {
    order: vi.fn(() => 'ORD-001'),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  genId: mocks.genId,
}));

vi.mock('../documentNumbering', () => ({
  getNextDocumentNumber: mocks.getNextDocumentNumber,
  resolveDocumentDefaults: mocks.resolveDocumentDefaults,
}));

vi.mock('../notifications', () => ({
  notifyRoleUsers: mocks.notifyRoleUsers,
}));

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: {
    ORDERS: 'orders',
  },
  firebaseEnv: { isConfigured: false },
}));

import { createOrder } from '../orderWorkflow';

describe('createOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNextDocumentNumber.mockResolvedValue({ documentNumber: 'ORD-BIZ-001' });
    mocks.resolveDocumentDefaults.mockResolvedValue({
      companyId: 'comp-1',
      settings: { defaultNotes: 'Standard notes', sequencePadding: 3 },
    });
  });

  it('creates an order with computed totals, numbering, and defaults applied', async () => {
    const result = await createOrder({
      form: { customer: 'Customer A', customerId: 'C-1', orderType: 'B2B', notes: '' },
      items: [{ productId: 'P-1', qty: 3, price: 200, tax: 18 }],
      subtotal: 600,
      taxTotal: 108,
      discount: 0,
      grandTotal: 708,
      companyId: 'comp-1',
      orderPrefix: 'ORD-',
      createdBy: 'user-1',
      activeCompanyId: 'comp-1',
    });

    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'orders',
      'ORD-001',
      expect.objectContaining({
        id: 'ORD-001',
        customer: 'Customer A',
        customerId: 'C-1',
        orderType: 'B2B',
        items: [{ productId: 'P-1', qty: 3, price: 200, tax: 18 }],
        subtotal: 600,
        taxTotal: 108,
        discount: 0,
        total: 708,
        createdBy: 'user-1',
        orderNumber: 'ORD-BIZ-001',
        orderNo: 'ORD-BIZ-001',
        notes: 'Standard notes',
      })
    );
    expect(result).toMatchObject({ id: 'ORD-001', orderNumber: 'ORD-BIZ-001' });
  });

  it('preserves an explicit note over the default when the form supplies one', async () => {
    await createOrder({
      form: { customer: 'Customer A', customerId: 'C-1', notes: 'Rush delivery requested' },
      items: [], subtotal: 0, taxTotal: 0, discount: 0, grandTotal: 0,
      companyId: 'comp-1', createdBy: 'user-1', activeCompanyId: 'comp-1',
    });
    const [, , payload] = mocks.createDocWithId.mock.calls[0];
    expect(payload.notes).toBe('Rush delivery requested');
  });

  it('notifies Accounts/Operations/Director scoped to the active company', async () => {
    await createOrder({
      form: { customer: 'Customer A', customerId: 'C-1' },
      items: [], subtotal: 0, taxTotal: 0, discount: 0, grandTotal: 0,
      companyId: 'comp-1', createdBy: 'user-1', activeCompanyId: 'comp-active',
    });
    expect(mocks.notifyRoleUsers).toHaveBeenCalledWith(
      ['Accounts', 'Operations', 'Director'],
      NotificationType.ORDER_PLACED,
      'Order placed',
      'Order ORD-BIZ-001 was created for Customer A.',
      'order',
      'ORD-001',
      'comp-active',
    );
  });
});
