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
  useAppStore: {
    getState: mocks.getState,
  },
}));

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: {
    DISPATCH: 'dispatch',
    ORDERS: 'orders',
    STOCK: 'stock',
    STOCK_LEDGER: 'stock_ledger',
    USERS: 'users',
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
  const dispatch = { id: 'DSP-010', orderId: 'ORD-1', warehouseId: 'W-1', warehouse: 'Main', companyId: 'comp-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      user: { id: 'user-1', role: 'Warehouse', companyId: 'comp-1' },
    });
    mocks.getOne.mockResolvedValue(null); // no linked order/project in this test
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

  it('rejects verification when a serial is already recorded on another dispatch for the same company', async () => {
    mocks.getAll.mockResolvedValue([
      { id: 'DSP-009', companyId: 'comp-1', items: [{ productId: 'P-1', serials: ['SN-200'] }] },
    ]);
    const verifiedItems = [
      { productId: 'P-1', product: 'Panel', verifiedQty: 1, serials: ['SN-200'] },
    ];
    await expect(executeAndVerifyDispatch(dispatch, verifiedItems)).rejects.toThrow('already been dispatched');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('ignores a matching serial recorded on another company\'s dispatch (no cross-tenant false positive)', async () => {
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'dispatch') {
        return Promise.resolve([
          { id: 'DSP-OTHER-CO', companyId: 'comp-2', items: [{ productId: 'P-1', serials: ['SN-300'] }] },
        ]);
      }
      // stock lookup — provide enough to satisfy the verification loop
      return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', availableQty: 10 }]);
    });
    const verifiedItems = [
      { productId: 'P-1', product: 'Panel', verifiedQty: 1, serials: ['SN-300'] },
    ];
    await expect(executeAndVerifyDispatch(dispatch, verifiedItems)).resolves.toBeUndefined();
    expect(mocks.updateDocById).toHaveBeenCalled();
  });

  it('allows verification of items with no serials at all (non-serial-tracked products)', async () => {
    mocks.getAll.mockImplementation((collection: string) => {
      if (collection === 'dispatch') return Promise.resolve([]);
      return Promise.resolve([{ id: 'STOCK-1', productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', availableQty: 10 }]);
    });
    const verifiedItems = [
      { productId: 'P-1', product: 'Cable', verifiedQty: 5 },
    ];
    await expect(executeAndVerifyDispatch(dispatch, verifiedItems)).resolves.toBeUndefined();
    expect(mocks.updateDocById).toHaveBeenCalled();
  });
});
