import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(),
  resolveWorkflowCompanyId: vi.fn(),
  stockSummaryId: vi.fn(),
  getState: vi.fn(),
  genId: {
    generic: vi.fn((prefix: string = 'GEN') => `${prefix}-001`),
  },
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
  stockSummaryId: mocks.stockSummaryId,
  text: (value: unknown) => (typeof value === 'string' ? value : ''),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: mocks.getState,
  },
}));

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: {
    STOCK: 'stock',
    STOCK_LEDGER: 'stock_ledger',
    DISPATCH: 'dispatch',
    ORDERS: 'orders',
  },
  firebaseEnv: { isConfigured: false },
}));

import { cancelOrder, stockIn } from '../stockWorkflow';

describe('stockIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
    mocks.resolveWorkflowCompanyId.mockReturnValue('comp-1');
    mocks.stockSummaryId.mockReturnValue('SUM-comp-1-P-1-W-1');
    mocks.usersByRole.mockResolvedValue([{ id: 'warehouse-1' }]);
    mocks.getAll.mockResolvedValue([]);
    mocks.getOne.mockResolvedValue({ id: 'SUM-comp-1-P-1-W-1', availableQty: 5, reservedQty: 1 });
  });

  it('updates an existing legacy stock summary instead of creating a duplicate tuple', async () => {
    mocks.getAll.mockResolvedValue([{ id: 'DEMO-V1-STK-001', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1' }]);
    mocks.getOne.mockResolvedValue({ id: 'DEMO-V1-STK-001', availableQty: 90, reservedQty: 22 });

    await expect(stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 8, unit: 'PCS', sourceType: 'purchase' }))
      .resolves.toMatchObject({ stockId: 'DEMO-V1-STK-001', beforeQty: 90, afterQty: 98 });

    expect(mocks.createDocWithId).toHaveBeenNthCalledWith(
      1,
      'stock',
      'DEMO-V1-STK-001',
      expect.objectContaining({ id: 'DEMO-V1-STK-001', availableQty: 98, reservedQty: 22 }),
    );
  });
  it('increments the stock summary and writes a ledger entry', async () => {
    await expect(
      stockIn({
        productId: 'P-1',
        warehouseId: 'W-1',
        qty: 7,
        unit: 'PCS',
        sourceType: 'purchase',
        sourceId: 'PO-1',
        notes: 'Incoming stock',
      })
    ).resolves.toEqual({
      stockId: 'SUM-comp-1-P-1-W-1',
      ledgerId: 'STK-001',
      transactionId: 'TXN-001',
      beforeQty: 5,
      afterQty: 12,
    });

    expect(mocks.createDocWithId).toHaveBeenNthCalledWith(
      1,
      'stock',
      'SUM-comp-1-P-1-W-1',
      expect.objectContaining({
        id: 'SUM-comp-1-P-1-W-1',
        companyId: 'comp-1',
        productId: 'P-1',
        warehouseId: 'W-1',
        availableQty: 12,
        reservedQty: 1,
        unit: 'PCS',
        updatedBy: 'user-1',
        isDeleted: false,
      })
    );

    expect(mocks.createDocWithId).toHaveBeenNthCalledWith(
      2,
      'stock_ledger',
      'STK-001',
      expect.objectContaining({
        id: 'STK-001',
        companyId: 'comp-1',
        productId: 'P-1',
        warehouseId: 'W-1',
        type: 'IN',
        qty: 7,
        unit: 'PCS',
        beforeQty: 5,
        afterQty: 12,
        transactionId: 'TXN-001',
        sourceType: 'purchase',
        sourceId: 'PO-1',
        notes: 'Incoming stock',
        createdBy: 'user-1',
        isDeleted: false,
      })
    );

  });
});

describe('cancelOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
    mocks.resolveWorkflowCompanyId.mockReturnValue('comp-1');
    mocks.stockSummaryId.mockImplementation((_companyId: string, productId: string, warehouseId: string) => `SUM-${productId}-${warehouseId}`);
    mocks.usersByRole.mockResolvedValue([{ id: 'accounts-1' }, { id: 'warehouse-1' }, { id: 'ops-1' }]);
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'orders' && id === 'ORD-1') {
        return {
          id: 'ORD-1',
          customer: 'Customer A',
          companyId: 'comp-1',
          status: 'Pending',
          paidAmount: 500,
          items: [{ productId: 'P-1', unit: 'PCS', dispatchedQty: 3, pendingQty: 0 }],
          createdBy: 'creator-1',
        };
      }
      if (collection === 'stock' && id === 'SUM-P-1-W-1') {
        return { id: 'SUM-P-1-W-1', availableQty: 2, reservedQty: 0 };
      }
      return null;
    });
    mocks.getAll.mockImplementation(async (collection: string) => {
      if (collection === 'dispatch') {
        return [
          {
            id: 'DSP-1',
            orderId: 'ORD-1',
            status: 'Dispatched',
            warehouseId: 'W-1',
            warehouse: 'Main Warehouse',
            items: [{ productId: 'P-1', unit: 'PCS', verifiedQty: 3 }],
          },
        ];
      }
      if (collection === 'stock_ledger') {
        return [];
      }
      return [];
    });
  });

  it('marks an order cancelled and restores dispatched stock', async () => {
    await expect(cancelOrder('ORD-1', 'Customer request')).resolves.toEqual(
      expect.objectContaining({
        orderId: 'ORD-1',
        refundRequired: true,
      })
    );

    expect(mocks.updateDocById).toHaveBeenCalledWith(
      'dispatch',
      'DSP-1',
      expect.objectContaining({
        status: 'Returned',
        cancellationOrderId: 'ORD-1',
        cancellationReason: 'Customer request',
      })
    );

    expect(mocks.updateDocById).toHaveBeenCalledWith(
      'orders',
      'ORD-1',
      expect.objectContaining({
        status: 'Cancelled',
        cancellationReason: 'Customer request',
        cancelledBy: 'user-1',
        refundRequired: true,
        paymentReconciliationPending: true,
      })
    );

  });
});
