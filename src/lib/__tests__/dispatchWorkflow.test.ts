import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType } from '../../types';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(),
  resolveWorkflowCompanyId: vi.fn(),
  generateDeliveryOTP: vi.fn(),
  hashOTP: vi.fn(),
  canDo: vi.fn(),
  getState: vi.fn(),
  genId: {
    dispatch: vi.fn(() => 'DSP-001'),
    generic: vi.fn((prefix: string = 'GEN') => `${prefix}-001`),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  genId: mocks.genId,
  resolveWriteCompanyId: () => {
    const s = mocks.getState();
    return s.activeCompanyId || s.company?.id || s.user?.companyId || '';
  },
  resolveWriteGroupId: () => 'grp-1',
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
  notifyUsers: mocks.notifyUsers,
  usersByRole: mocks.usersByRole,
  resolveWorkflowCompanyId: mocks.resolveWorkflowCompanyId,
  generateDeliveryOTP: mocks.generateDeliveryOTP,
  hashOTP: mocks.hashOTP,
  isDispatchImmutable: (status: string) => status === 'Delivered' || status === 'Closed',
  stockSummaryId: (c: string, p: string, w: string) => `SUM-${c}-${p}-${w}`,
  text: (value: unknown) => (typeof value === 'string' ? value : ''),
  timestampMillis: (value: unknown) => (typeof value === 'number' ? value : 0),
}));

vi.mock('../permissions', () => ({
  canDo: mocks.canDo,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: mocks.getState,
  },
}));

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: {
    DISPATCH: 'dispatch',
    DISPATCH_SERIALS: 'dispatch_serials',
    ORDERS: 'orders',
    STOCK: 'stock',
    STOCK_LEDGER: 'stock_ledger',
    STOCK_RESERVATIONS: 'stock_reservations',
    USERS: 'users',
    WAREHOUSES: 'warehouses',
    PRODUCTS: 'products',
    PROJECTS: 'projects',
  },
  firebaseEnv: { isConfigured: false },
}));

import { approveDispatch, executeAndVerifyDispatch, projectDispatchPatch, projectInstallationPatch, requestDispatch } from '../dispatchWorkflow';

describe('project dispatch lifecycle patches', () => {
  it('advances through Dispatch and Installation without regressing a later stage', () => {
    const dispatch = projectDispatchPatch({ currentStage: 'Procurement', linkedDispatchIds: [], stageHistory: [] }, 'DSP-1', 'U-1', 'NOW');
    expect(dispatch).toMatchObject({ currentStage: 'Dispatch', linkedDispatchIds: ['DSP-1'], stageHistory: [{ stage: 'Dispatch' }] });
    expect(projectInstallationPatch({ ...dispatch, currentStage: 'Dispatch' }, 'DSP-1', 'U-1', 'LATER')).toMatchObject({ currentStage: 'Installation', stageHistory: [{ stage: 'Dispatch' }, { stage: 'Installation' }] });
    expect(projectInstallationPatch({ currentStage: 'QC', stageHistory: [] }, 'DSP-1', 'U-1', 'NOW')).toEqual({});
  });
});
describe('requestDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { dispatchPrefix: 'DSP-' },
      user: { id: 'user-1', role: 'Warehouse', companyId: 'comp-1' },
    });
    mocks.resolveWorkflowCompanyId.mockReturnValue('comp-1');
    mocks.generateDeliveryOTP.mockReturnValue('123456');
    mocks.hashOTP.mockResolvedValue('HASH-123456');
    mocks.usersByRole.mockResolvedValue([{ id: 'warehouse-1' }]);
  });

  it('creates a dispatch request and returns the OTP', async () => {
    const payload = {
      orderId: 'ORD-1',
      customerId: 'C-1',
      customer: 'Customer A',
      warehouseId: 'W-1',
      warehouse: 'Main Warehouse',
      vehicleNo: 'UP32AA1234',
      driverName: 'Driver',
      driverPhone: '9999999999',
      transporterId: 'T-1',
      lrNumber: 'LR-1',
      notes: 'Handle carefully',
      items: [
        { productId: 'P-1', product: 'Panel', requestedQty: 4, trackingType: 'serial', unit: 'PCS' },
      ],
    };

    await expect(requestDispatch(payload)).resolves.toEqual({
      dispatchId: 'DSP-001',
      deliveryOTP: '123456',
    });

    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'dispatch',
      'DSP-001',
      expect.objectContaining({
        id: 'DSP-001',
        dispatchId: 'DSP-001',
        dispatchNumber: 'DSP-001',
        orderId: 'ORD-1',
        customerId: 'C-1',
        companyId: 'comp-1',
        deliveryOTPHash: 'HASH-123456',
        status: 'Pending Verification',
        approvalStatus: 'Pending',
        createdBy: 'user-1',
        items: [
          expect.objectContaining({
            productId: 'P-1',
            verifiedQty: 0,
            serials: [],
            barcodes: [],
          }),
        ],
      })
    );

    expect(mocks.logActivity).toHaveBeenCalledWith(
      'Dispatch',
      'Requested Dispatch',
      'DSP-001',
      expect.objectContaining({
        orderId: 'ORD-1',
        entityName: 'Customer A',
        actionLabel: 'Requested dispatch',
      })
    );

    expect(mocks.notifyUsers).toHaveBeenCalledWith(
      [{ id: 'warehouse-1' }],
      NotificationType.DISPATCH_REQUESTED,
      'Dispatch approval requested',
      'Dispatch DSP-001 is pending approval for order ORD-1.',
      'dispatch',
      'DSP-001',
      'comp-1'
    );
  });
});

describe('approveDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { dispatchPrefix: 'DSP-' },
      user: { id: 'user-1', role: 'Warehouse', companyId: 'comp-1' },
    });
    mocks.usersByRole.mockResolvedValue([{ id: 'warehouse-1' }]);
  });

  it('marks the dispatch approved and notifies warehouse users', async () => {
    await approveDispatch('DSP-009');

    expect(mocks.updateDocById).toHaveBeenCalledWith('dispatch', 'DSP-009', { approvalStatus: 'Approved' });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      'Dispatch',
      'Approved Dispatch',
      'DSP-009',
      expect.objectContaining({
        entityName: 'DSP-009',
        actionLabel: 'Approved dispatch',
      })
    );
    expect(mocks.usersByRole).toHaveBeenCalledWith('Warehouse');
    expect(mocks.notifyUsers).toHaveBeenCalledWith(
      [{ id: 'warehouse-1' }],
      NotificationType.DISPATCH_APPROVED,
      'Dispatch approved',
      'Dispatch DSP-009 was approved.',
      'dispatch',
      'DSP-009',
      'comp-1'
    );
  });
});

describe('executeAndVerifyDispatch — duplicate serial protection', () => {
  const dispatch = { id: 'DSP-010', orderId: 'ORD-1', warehouseId: 'W-1', warehouse: 'Main', companyId: 'comp-1', status: 'Pending Verification' };

  // INVENTORY-01: getOne now resolves the authoritative dispatch status + the
  // referenced warehouse/product (P1-6 dispatch-side validation).
  function stubRefs(overrides: Record<string, any> = {}) {
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'dispatch' && id === 'DSP-010') return { id: 'DSP-010', status: 'Pending Verification', companyId: 'comp-1' };
      if (collection === 'warehouses' && id === 'W-1') return { id: 'W-1', companyId: 'comp-1', isDeleted: false };
      if (collection === 'products') return { id, companyId: 'comp-1', isDeleted: false };
      if (collection === 'stock_ledger') return null; // no prior ledger row for this line
      if (collection === 'orders') return null; // no linked order in these tests
      return overrides[collection] ?? null;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      user: { id: 'user-1', role: 'Warehouse', companyId: 'comp-1' },
    });
    stubRefs();
    mocks.usersByRole.mockResolvedValue([]);
  });

  it('rejects verification when the same serial is entered twice in one batch', async () => {
    mocks.getAll.mockResolvedValue([]); // no other dispatches yet
    const verifiedItems = [
      { productId: 'P-1', product: 'Panel', verifiedQty: 2, serials: ['SN-100', 'SN-100'] },
    ];
    await expect(executeAndVerifyDispatch(dispatch, verifiedItems)).rejects.toThrow('entered more than once');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('rejects a same-batch duplicate that only matches after normalization (case-insensitive)', async () => {
    mocks.getAll.mockResolvedValue([]);
    const verifiedItems = [
      { productId: 'P-1', product: 'Panel', verifiedQty: 2, serials: ['sn-100', 'SN-100'] },
    ];
    await expect(executeAndVerifyDispatch(dispatch, verifiedItems)).rejects.toThrow('entered more than once');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('rejects verification when a serial is already recorded on another dispatch for the same company', async () => {
    // INVENTORY-11 (§11a): the guard is now the `dispatch_serials` lock doc,
    // read INSIDE the movement-engine transaction (via the participant's
    // `read`) — not a `getAll(DISPATCH)` scan. Stub the specific lock doc id
    // (`{companyId}_{normalizedSerial}`) as already held by a DIFFERENT
    // dispatch, and give the engine a real stock summary so the rejection is
    // provably the SERIAL conflict, not a masking insufficient-stock error.
    const lockId = 'comp-1_SN-200';
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'dispatch' && id === 'DSP-010') return { id: 'DSP-010', status: 'Pending Verification', companyId: 'comp-1' };
      if (collection === 'warehouses' && id === 'W-1') return { id: 'W-1', companyId: 'comp-1', isDeleted: false };
      if (collection === 'products') return { id, companyId: 'comp-1', isDeleted: false };
      if (collection === 'stock_ledger') return null;
      if (collection === 'orders') return null;
      if (collection === 'dispatch_serials' && id === lockId) {
        return { id: lockId, companyId: 'comp-1', dispatchId: 'DSP-009', serial: 'SN-200', productId: 'P-1', status: 'assigned', isDeleted: false };
      }
      return null;
    });
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'stock') return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', onHandQty: 10, availableQty: 10, reservedQty: 0 }]);
      return Promise.resolve([]);
    });
    const verifiedItems = [
      { productId: 'P-1', product: 'Panel', verifiedQty: 1, serials: ['SN-200'] },
    ];
    await expect(executeAndVerifyDispatch(dispatch, verifiedItems)).rejects.toThrow('already been dispatched');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
    // No stock/ledger mutation from the aborted transaction (validate threw
    // before any write) — zero partial mutation, same as INV-1/INV-13.
    expect(mocks.createDocWithId).not.toHaveBeenCalledWith('stock', expect.anything(), expect.anything());
  });

  it('a serial already held by THIS SAME dispatch (a resumed retry) is not treated as a conflict', async () => {
    const lockId = 'comp-1_SN-450';
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'dispatch' && id === 'DSP-010') return { id: 'DSP-010', status: 'Pending Verification', companyId: 'comp-1' };
      if (collection === 'warehouses' && id === 'W-1') return { id: 'W-1', companyId: 'comp-1', isDeleted: false };
      if (collection === 'products') return { id, companyId: 'comp-1', isDeleted: false };
      if (collection === 'stock_ledger') return null;
      if (collection === 'orders') return null;
      if (collection === 'dispatch_serials' && id === lockId) {
        return { id: lockId, companyId: 'comp-1', dispatchId: 'DSP-010', serial: 'SN-450', productId: 'P-1', status: 'assigned', isDeleted: false };
      }
      return null;
    });
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'stock') return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', onHandQty: 10, availableQty: 10, reservedQty: 0 }]);
      return Promise.resolve([]);
    });
    const verifiedItems = [
      { productId: 'P-1', product: 'Panel', verifiedQty: 1, serials: ['SN-450'] },
    ];
    const result = await executeAndVerifyDispatch(dispatch, verifiedItems);
    expect(result).toMatchObject({ dispatchId: 'DSP-010', alreadyVerified: false });
  });

  it('rejects a serial captured against a zero-quantity line (never silently un-locked)', async () => {
    const verifiedItems = [
      { productId: 'P-1', product: 'Panel', verifiedQty: 0, serials: ['SN-999'] },
    ];
    await expect(executeAndVerifyDispatch(dispatch, verifiedItems)).rejects.toThrow('verified quantity greater than zero');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('ignores a matching serial recorded on another company\'s dispatch (no cross-tenant false positive)', async () => {
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'dispatch') {
        return Promise.resolve([
          { id: 'DSP-OTHER-CO', companyId: 'comp-2', items: [{ productId: 'P-1', serials: ['SN-300'] }] },
        ]);
      }
      return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', availableQty: 10, reservedQty: 0 }]);
    });
    const verifiedItems = [
      { productId: 'P-1', product: 'Panel', verifiedQty: 1, serials: ['SN-300'] },
    ];
    const result = await executeAndVerifyDispatch(dispatch, verifiedItems);
    expect(result).toMatchObject({ dispatchId: 'DSP-010', alreadyVerified: false, applied: [{ productId: 'P-1', appliedQty: 1 }] });
    expect(mocks.createDocWithId).toHaveBeenCalledWith('stock', 'STOCK-1', expect.objectContaining({ onHandQty: 9, availableQty: 9 }));
  });

  it('allows verification of items with no serials at all (non-serial-tracked products)', async () => {
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'dispatch') return Promise.resolve([]);
      return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', availableQty: 10, reservedQty: 0 }]);
    });
    const verifiedItems = [
      { productId: 'P-1', product: 'Cable', verifiedQty: 5 },
    ];
    const result = await executeAndVerifyDispatch(dispatch, verifiedItems);
    expect(result).toMatchObject({ dispatchId: 'DSP-010', alreadyVerified: false });
    expect(mocks.createDocWithId).toHaveBeenCalledWith('stock', 'STOCK-1', expect.objectContaining({ onHandQty: 5, availableQty: 5 }));
  });

  it('INVENTORY-01: rejects re-verification when the dispatch is already in a terminal status', async () => {
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'dispatch') return { id, status: 'Dispatched', companyId: 'comp-1' };
      return null;
    });
    mocks.getAll.mockResolvedValue([]);
    await expect(executeAndVerifyDispatch(dispatch, [{ productId: 'P-1', product: 'Panel', verifiedQty: 1 }]))
      .rejects.toThrow('already been verified');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('INVENTORY-01 (P1-6): rejects a deleted / cross-company product with no stock mutation', async () => {
    mocks.getAll.mockResolvedValue([]);
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'dispatch') return { id, status: 'Pending Verification', companyId: 'comp-1' };
      if (collection === 'warehouses') return { id, companyId: 'comp-1', isDeleted: false };
      if (collection === 'products') return { id, companyId: 'comp-1', isDeleted: true }; // soft-deleted
      return null;
    });
    await expect(executeAndVerifyDispatch(dispatch, [{ productId: 'P-DEL', product: 'Old', verifiedQty: 1 }]))
      .rejects.toThrow('does not exist or has been removed');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('INVENTORY-01 (P1-6): rejects a deleted / missing warehouse with no stock mutation', async () => {
    mocks.getAll.mockResolvedValue([]);
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'dispatch') return { id, status: 'Pending Verification', companyId: 'comp-1' };
      if (collection === 'warehouses') return null; // missing
      return null;
    });
    await expect(executeAndVerifyDispatch(dispatch, [{ productId: 'P-1', product: 'Panel', verifiedQty: 1 }]))
      .rejects.toThrow('does not exist or has been removed');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('INVENTORY-01 (D3/K3): insufficient stock throws and mutates nothing', async () => {
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'dispatch') return Promise.resolve([]);
      return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', availableQty: 2, reservedQty: 0 }]);
    });
    await expect(executeAndVerifyDispatch(dispatch, [{ productId: 'P-1', product: 'Panel', verifiedQty: 5 }]))
      .rejects.toThrow('Insufficient stock');
    expect(mocks.updateDocById).not.toHaveBeenCalledWith('stock', expect.anything(), expect.anything());
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('INVENTORY-01 (D5/K5): a prior deterministic ledger row for the line => idempotent no-op, no second decrement', async () => {
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'dispatch') return { id, status: 'Pending Verification', companyId: 'comp-1' };
      if (collection === 'warehouses') return { id, companyId: 'comp-1', isDeleted: false };
      if (collection === 'products') return { id, companyId: 'comp-1', isDeleted: false };
      if (collection === 'stock_ledger') return { id, type: 'OUT' }; // already recorded
      if (collection === 'orders') return null;
      return null;
    });
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'dispatch') return Promise.resolve([]);
      return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', availableQty: 10, reservedQty: 0 }]);
    });
    const result = await executeAndVerifyDispatch(dispatch, [{ productId: 'P-1', product: 'Panel', verifiedQty: 3 }]);
    expect(result).toMatchObject({ applied: [{ productId: 'P-1', appliedQty: 0 }] });
    expect(mocks.updateDocById).not.toHaveBeenCalledWith('stock', 'STOCK-1', expect.objectContaining({ availableQty: expect.any(Number) }));
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('INVENTORY-05c: the OUT ledger row is a DISPATCH_OUT movement with a deterministic id + unified + legacy fields', async () => {
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'dispatch') return Promise.resolve([]);
      return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', availableQty: 10, reservedQty: 0 }]);
    });
    await executeAndVerifyDispatch(dispatch, [{ productId: 'P-1', product: 'Panel', verifiedQty: 1, unit: 'PCS' }]);
    const key = 'DISPATCH_OUT:dispatch:DSP-010:P-1';
    expect(mocks.createDocWithId).toHaveBeenCalledWith('stock_ledger', `STKMV-${encodeURIComponent(key)}`, expect.objectContaining({
      movementType: 'DISPATCH_OUT', direction: 'OUT', qty: 1,
      onHandBefore: 10, onHandAfter: 9,
      // legacy compat
      type: 'OUT', beforeQty: 10, afterQty: 9, referenceType: 'Dispatch', referenceId: 'DSP-010',
      idempotencyKey: key,
    }));
    // the dispatch-doc status flip happens inside the engine txn (participant)
    expect(mocks.updateDocById).toHaveBeenCalledWith('dispatch', 'DSP-010', expect.objectContaining({ status: 'Dispatched' }));
  });
});
