import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType } from '../../types';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  getOne: vi.fn(),
  updateDocById: vi.fn(),
  getNextDocumentNumber: vi.fn(),
  resolveDocumentDefaults: vi.fn(),
  notifyRoleUsers: vi.fn(),
  genId: {
    order: vi.fn(() => 'ORD-001'),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  getOne: mocks.getOne,
  updateDocById: mocks.updateDocById,
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

import { createOrder, isOrderLineLocked, updateOrder } from '../orderWorkflow';

describe('INVENTORY-04 — order line lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDocById.mockResolvedValue(undefined);
  });

  const unlocked = { id: 'ORD-9', status: 'Pending', items: [{ productId: 'P-1', product: 'Panel', qty: 5, price: 100, tax: 18, unit: 'PCS', dispatchedQty: 0 }], notes: 'old' };
  const dispatchedLine = { id: 'ORD-9', status: 'Pending', items: [{ productId: 'P-1', product: 'Panel', qty: 5, price: 100, tax: 18, unit: 'PCS', dispatchedQty: 2 }], notes: 'old' };
  const byStatus = (status: string) => ({ id: 'ORD-9', status, items: [{ productId: 'P-1', product: 'Panel', qty: 5, price: 100, tax: 18, unit: 'PCS', dispatchedQty: 0 }], notes: 'old' });

  it('isOrderLineLocked — Σ dispatchedQty > 0', () => {
    expect(isOrderLineLocked(unlocked)).toBe(false);
    expect(isOrderLineLocked(dispatchedLine)).toBe(true);
  });
  it('isOrderLineLocked — locked statuses', () => {
    for (const s of ['Partial Dispatch', 'Dispatched', 'Closed', 'Cancelled']) expect(isOrderLineLocked(byStatus(s))).toBe(true);
    for (const s of ['Pending', 'Processing', 'Confirmed', 'Delivered']) expect(isOrderLineLocked(byStatus(s))).toBe(false);
  });

  it('1. unlocked order — line edit allowed', async () => {
    mocks.getOne.mockResolvedValue(unlocked);
    await expect(updateOrder('ORD-9', { items: [{ productId: 'P-1', product: 'Panel', qty: 9, price: 100, tax: 18, unit: 'PCS' }] })).resolves.toMatchObject({ id: 'ORD-9' });
    expect(mocks.updateDocById).toHaveBeenCalledWith('orders', 'ORD-9', expect.objectContaining({ items: expect.any(Array) }));
  });

  it('2. locked (dispatchedQty>0) — line qty change rejected', async () => {
    mocks.getOne.mockResolvedValue(dispatchedLine);
    await expect(updateOrder('ORD-9', { items: [{ productId: 'P-1', product: 'Panel', qty: 9, price: 100, tax: 18, unit: 'PCS' }] })).rejects.toThrow(/dispatched/i);
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it.each(['Partial Dispatch', 'Dispatched', 'Closed', 'Cancelled'])('3-6. locked by status %s — line change rejected', async (status) => {
    mocks.getOne.mockResolvedValue(byStatus(status));
    await expect(updateOrder('ORD-9', { items: [{ productId: 'P-2', product: 'Inverter', qty: 5, price: 100, tax: 18, unit: 'PCS' }] })).rejects.toThrow(/dispatched/i);
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('7. locked order — non-line edit (notes) still allowed', async () => {
    mocks.getOne.mockResolvedValue(dispatchedLine);
    // full payload from the form re-sends items, but their product/qty/price is unchanged
    await expect(updateOrder('ORD-9', { notes: 'updated note', items: [{ productId: 'P-1', product: 'Panel', qty: 5, price: 100, tax: 18, unit: 'PCS' }] })).resolves.toMatchObject({ id: 'ORD-9' });
    expect(mocks.updateDocById).toHaveBeenCalledWith('orders', 'ORD-9', expect.objectContaining({ notes: 'updated note' }));
  });

  it('7b. locked order — patch with NO items key always allowed', async () => {
    mocks.getOne.mockResolvedValue(byStatus('Dispatched'));
    await expect(updateOrder('ORD-9', { customerPhone: '99999' })).resolves.toMatchObject({ id: 'ORD-9' });
    expect(mocks.updateDocById).toHaveBeenCalledWith('orders', 'ORD-9', { customerPhone: '99999' });
  });

  it('rejects when the order does not exist', async () => {
    mocks.getOne.mockResolvedValue(null);
    await expect(updateOrder('NOPE', { notes: 'x' })).rejects.toThrow('not found');
  });
});

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
