import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType } from '../../types';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(),
  getState: vi.fn(),
  getNextDocumentNumber: vi.fn(),
  resolveDocumentDefaults: vi.fn(),
  canDo: vi.fn(() => true),
  genId: {
    order: vi.fn(() => 'ORD-001'),
    quotation: vi.fn(() => 'QT-001'),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  genId: mocks.genId,
  resolveWriteCompanyId: () => {
    const s = mocks.getState() as any;
    return s.activeCompanyId || s.company?.id || s.user?.companyId || '';
  },
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
  notifyUsers: mocks.notifyUsers,
  usersByRole: mocks.usersByRole,
}));

vi.mock('../documentNumbering', () => ({
  getNextDocumentNumber: mocks.getNextDocumentNumber,
  resolveDocumentDefaults: mocks.resolveDocumentDefaults,
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
    ORDERS: 'orders',
    QUOTATIONS: 'quotations',
    PROJECTS: 'projects',
    ENGINEERING_DESIGNS: 'engineeringDesigns',
    CUSTOMERS: 'customers',
  },
  firebaseEnv: { isConfigured: false },
}));

import { convertQuotationToOrder, createQuotation, isQuotationLocked, projectOrderPatch, projectQuotationPatch, quotationItemsFromEngineering, updateQuotation } from '../quotationWorkflow';

describe('convertQuotationToOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { orderPrefix: 'ORD-' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
    mocks.usersByRole.mockResolvedValue([{ id: 'acc-1' }]);
    mocks.getNextDocumentNumber.mockResolvedValue({ documentNumber: 'ORD-BIZ-001' });
  });

  it('Phase 3: derives orderType from the linked Customer.type — a B2B customer produces a B2B order (was hardcoded to B2C before this fix)', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'C-1', type: 'B2B' });
    const quote = {
      id: 'Q-1',
      customerId: 'C-1',
      customer: 'Customer A',
      items: [{ qty: 2, price: 100, tax: 18 }],
      subtotal: 200,
      taxAmount: 36,
      total: 236,
      discount: 0,
      companyId: 'comp-1',
    };

    await expect(convertQuotationToOrder(quote)).resolves.toBe('ORD-001');
    expect(mocks.getOne).toHaveBeenCalledWith('customers', 'C-1');

    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'orders',
      'ORD-001',
      expect.objectContaining({
        id: 'ORD-001',
        customerId: 'C-1',
        customer: 'Customer A',
        orderType: 'B2B',
        status: 'Pending',
        paymentStatus: 'Pending',
        subtotal: 200,
        taxAmount: 36,
        total: 236,
        discount: 0,
        sourceQuotationId: 'Q-1',
        totalInvoiced: 0,
        pendingBilling: 236,
        orderNumber: 'ORD-BIZ-001',
        orderNo: 'ORD-BIZ-001',
        items: [
          expect.objectContaining({ qty: 2, price: 100, dispatchedQty: 0, pendingQty: 2 }),
        ],
      })
    );

    expect(mocks.updateDocById).toHaveBeenCalledWith(
      'quotations',
      'Q-1',
      expect.objectContaining({
        status: 'Converted to Order',
        convertedOrderId: 'ORD-001',
      })
    );

    expect(mocks.logActivity).toHaveBeenCalledWith(
      'Quotations',
      'Converted to Order',
      'Q-1',
      expect.objectContaining({
        orderId: 'ORD-001',
        entityName: 'Customer A',
        actionLabel: 'Converted quotation to order',
      })
    );

    expect(mocks.usersByRole).toHaveBeenCalledWith('Accounts');
    expect(mocks.notifyUsers).toHaveBeenCalledWith(
      [{ id: 'acc-1' }],
      NotificationType.ORDER_PLACED,
      'Order placed',
      'Quotation Q-1 was converted to order ORD-BIZ-001.',
      'order',
      'ORD-001',
      'comp-1'
    );
  });

  it('Phase 3: a B2C customer produces a B2C order — B2B must never silently become B2C, and B2C must never silently become B2B', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'C-2', type: 'B2C' });
    const quote = {
      id: 'Q-1B', customerId: 'C-2', customer: 'Customer B',
      items: [{ qty: 1, price: 100, tax: 18 }], subtotal: 100, taxAmount: 18, total: 118, discount: 0,
    };

    await convertQuotationToOrder(quote);

    expect(mocks.createDocWithId).toHaveBeenCalledWith('orders', 'ORD-001', expect.objectContaining({ orderType: 'B2C' }));
  });

  it('preserves project, design, and canonical tax relationships when converting', async () => {
    mocks.getOne
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'Quotation', linkedOrderIds: [], stageHistory: [] })
      .mockResolvedValueOnce({ id: 'C-1', type: 'B2C' });
    const quote = {
      id: 'Q-2', projectId: 'PRJ-1', engineeringDesignId: 'ENG-1', customerId: 'C-1', customer: 'Customer A',
      items: [{ qty: 1, price: 100, tax: 18 }], subtotal: 100, taxTotal: 18, total: 118, discount: 0,
    };

    await convertQuotationToOrder(quote);

    expect(mocks.createDocWithId).toHaveBeenCalledWith('orders', 'ORD-001', expect.objectContaining({
      projectId: 'PRJ-1', engineeringDesignId: 'ENG-1', sourceQuotationId: 'Q-2', quotationId: 'Q-2',
      taxAmount: 18, taxTotal: 18, orderType: 'B2C',
    }));
    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', expect.objectContaining({
      currentStage: 'Order', linkedOrderIds: ['ORD-001'],
    }));
  });

  it('Phase 3: throws a clear error instead of guessing when the quotation has no linked Customer — never silently defaults to B2C', async () => {
    const quote = { id: 'Q-3', customer: 'Walk-in prospect', items: [], subtotal: 0, total: 0, discount: 0 };
    await expect(convertQuotationToOrder(quote)).rejects.toThrow('not linked to a Customer record');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('Phase 3: throws a clear error instead of guessing when the linked Customer cannot be resolved or has no valid type — never silently defaults to B2C', async () => {
    mocks.getOne.mockResolvedValueOnce(null);
    const quote = { id: 'Q-4', customerId: 'C-GHOST', customer: 'Ghost', items: [], subtotal: 0, total: 0, discount: 0 };
    await expect(convertQuotationToOrder(quote)).rejects.toThrow('does not have a valid B2B/B2C classification');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });
});

describe('quotation project integration', () => {
  it('prepopulates editable zero-priced commercial lines from approved engineering data', () => {
    const items = quotationItemsFromEngineering({
      id: 'DES-1', designId: 'DES-1', projectId: 'PRJ-1', surveyId: 'SUR-1',
      panelCount: 20, panelWattage: 550, inverterSpec: '10 kW string inverter', systemCapacityKw: 11,
      singleLineDiagramUrl: '', structuralDrawingUrl: '', documents: [], designerId: 'ENG-1',
      status: 'Approved', revisionNumber: 1, revisionHistory: [], companyId: 'COMP-1', createdAt: '', updatedAt: '',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ product: 'Solar PV Modules', qty: 20, price: 0 });
    expect(items[1]).toMatchObject({ product: 'Solar Inverter', description: '10 kW string inverter', price: 0 });
  });

  it('links a quotation and advances only pre-quotation projects', () => {
    const project: any = { currentStage: 'Engineering', linkedQuotationIds: ['QT-OLD'], stageHistory: [] };
    expect(projectQuotationPatch(project, 'QT-1', 'USER-1')).toMatchObject({
      currentStage: 'Quotation', linkedQuotationIds: ['QT-OLD', 'QT-1'],
      stageHistory: [expect.objectContaining({ stage: 'Quotation', changedBy: 'USER-1' })],
    });
    expect(projectQuotationPatch({ ...project, currentStage: 'Order' }, 'QT-1', 'USER-1')).not.toHaveProperty('currentStage');
  });

  it('advances a quotation-stage project to Order without regressing later stages', () => {
    const project: any = { currentStage: 'Quotation', linkedOrderIds: [], stageHistory: [] };
    expect(projectOrderPatch(project, 'ORD-1', 'USER-1')).toMatchObject({
      currentStage: 'Order', linkedOrderIds: ['ORD-1'],
      stageHistory: [expect.objectContaining({ stage: 'Order', changedBy: 'USER-1' })],
    });
    expect(projectOrderPatch({ ...project, currentStage: 'Procurement' }, 'ORD-1', 'USER-1')).not.toHaveProperty('currentStage');
  });
});

describe('updateQuotation — post-Order lock enforced on the update path itself', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { orderPrefix: 'ORD-' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
    mocks.canDo.mockReturnValue(true);
  });

  it('isQuotationLocked treats status "Converted to Order" or a convertedOrderId as locked — and nothing else', () => {
    expect(isQuotationLocked({ status: 'Converted to Order' })).toBe(true);
    expect(isQuotationLocked({ status: 'Sent', convertedOrderId: 'ORD-1' })).toBe(true);
    for (const status of ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired']) {
      expect(isQuotationLocked({ status })).toBe(false);
    }
    expect(isQuotationLocked(undefined)).toBe(false);
  });

  it('throws and does not write when the quotation has been converted to an Order (status-based lock)', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'Q-1', status: 'Converted to Order', convertedOrderId: 'ORD-1' });
    await expect(updateQuotation('Q-1', { items: [] })).rejects.toThrow('can no longer be edited');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('throws and does not write when the quotation carries a convertedOrderId regardless of its status', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'Q-2', status: 'Sent', convertedOrderId: 'ORD-2' });
    await expect(updateQuotation('Q-2', { total: 0 })).rejects.toThrow('can no longer be edited');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('writes normally while the quotation is still editable under the existing rules', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'Q-3', status: 'Draft', customerId: 'C-1' });
    const result = await updateQuotation('Q-3', { total: 118, items: [{ qty: 1, price: 100, tax: 18 }] });
    expect(mocks.updateDocById).toHaveBeenCalledWith('quotations', 'Q-3', { total: 118, items: [{ qty: 1, price: 100, tax: 18 }] });
    expect(result).toMatchObject({ id: 'Q-3', total: 118 });
  });

  it('throws when the quotation does not exist — no blind write to a missing record', async () => {
    mocks.getOne.mockResolvedValueOnce(null);
    await expect(updateQuotation('Q-GHOST', { total: 0 })).rejects.toThrow('Quotation not found');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });
});

describe('createQuotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { orderPrefix: 'ORD-' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
    mocks.canDo.mockReturnValue(true);
    mocks.getNextDocumentNumber.mockResolvedValue({ documentNumber: 'QT-BIZ-001' });
    mocks.resolveDocumentDefaults.mockResolvedValue({
      companyId: 'comp-1',
      settings: { piValidityDays: 30, defaultTerms: 'Standard terms', defaultNotes: 'Standard notes', sequencePadding: 3 },
    });
    // synchronizeQuotationProjectLink (called unconditionally at the end of
    // createQuotation, exactly as the pre-extraction inline code did) reads the
    // just-created quotation back before it can proceed.
    mocks.getOne.mockResolvedValue({ id: 'QT-001', customerId: 'C-1', customer: 'Customer A' });
  });

  it('creates a quotation with computed totals, numbering, and defaults applied', async () => {
    const result = await createQuotation({
      form: { customer: 'Customer A', customerId: 'C-1', date: '2026-01-01' },
      items: [{ productId: 'P-1', qty: 2, price: 500, tax: 18 }],
      subtotal: 1000,
      taxTotal: 180,
      totalDiscount: 0,
      grandTotal: 1180,
      companyId: 'comp-1',
      quotationPrefix: 'QT-',
      createdBy: 'user-1',
    });

    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'quotations',
      'QT-001',
      expect.objectContaining({
        id: 'QT-001',
        customer: 'Customer A',
        customerId: 'C-1',
        items: [{ productId: 'P-1', qty: 2, price: 500, tax: 18 }],
        subtotal: 1000,
        taxTotal: 180,
        discount: 0,
        total: 1180,
        createdBy: 'user-1',
        quotationNumber: 'QT-BIZ-001',
        quoteNumber: 'QT-BIZ-001',
        refNo: 'QT-BIZ-001',
        terms: 'Standard terms',
        notes: 'Standard notes',
      })
    );
    expect(result).toMatchObject({ id: 'QT-001', quotationNumber: 'QT-BIZ-001' });
  });

  it('separates projectId out of the Firestore payload and forwards it to the project-link sync', async () => {
    // No engineeringDesignId here — that branch of synchronizeQuotationProjectLink
    // (approved-design validation) is its own concern, not what this test covers.
    await createQuotation({
      form: { customer: 'Customer A', customerId: 'C-1', projectId: 'PRJ-1' },
      items: [], subtotal: 0, taxTotal: 0, totalDiscount: 0, grandTotal: 0,
      companyId: 'comp-1', createdBy: 'user-1',
    });

    const [, , payload] = mocks.createDocWithId.mock.calls[0];
    expect(payload).not.toHaveProperty('projectId');
    expect(payload).not.toHaveProperty('engineeringDesignId');
    // synchronizeQuotationProjectLink's own final write carries the link instead.
    expect(mocks.updateDocById).toHaveBeenCalledWith(
      'quotations', 'QT-001',
      expect.objectContaining({ projectId: 'PRJ-1', engineeringDesignId: '' })
    );
  });

  it('falls back to a computed validUntil when the form does not supply one', async () => {
    await createQuotation({
      form: { customer: 'Customer A', customerId: 'C-1' },
      items: [], subtotal: 0, taxTotal: 0, totalDiscount: 0, grandTotal: 0,
      companyId: 'comp-1', createdBy: 'user-1',
    });
    const [, , payload] = mocks.createDocWithId.mock.calls[0];
    expect(typeof payload.validUntil).toBe('string');
    expect(payload.validUntil.length).toBeGreaterThan(0);
  });

  it('uses an explicit validUntil from the form when supplied', async () => {
    await createQuotation({
      form: { customer: 'Customer A', customerId: 'C-1', validUntil: '2026-06-01' },
      items: [], subtotal: 0, taxTotal: 0, totalDiscount: 0, grandTotal: 0,
      companyId: 'comp-1', createdBy: 'user-1',
    });
    const [, , payload] = mocks.createDocWithId.mock.calls[0];
    expect(payload.validUntil).toBe('2026-06-01');
  });
});
