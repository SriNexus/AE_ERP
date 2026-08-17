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
  getState: vi.fn(),
  getNextDocumentNumber: vi.fn(),
  resolveDocumentDefaults: vi.fn(),
  genId: {
    invoice: vi.fn(),
    payment: vi.fn(() => 'PAY-REF-001'),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
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
  text: (value: unknown) => (typeof value === 'string' ? value : ''),
}));

vi.mock('../documentNumbering', () => ({
  getNextDocumentNumber: mocks.getNextDocumentNumber,
  resolveDocumentDefaults: mocks.resolveDocumentDefaults,
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
    PROFORMA_INVOICES: 'proforma_invoices',
    PAYMENTS: 'payments',
  },
  firebaseEnv: { isConfigured: false },
}));

import { generatePIsFromOrder, refundPayment } from '../invoiceWorkflow';

describe('generatePIsFromOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { invoicePrefix: 'PI-' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
    mocks.usersByRole.mockResolvedValue([{ id: 'accounts-1' }]);
    mocks.genId.invoice
      .mockReturnValueOnce('PI-001')
      .mockReturnValueOnce('PI-002');
    mocks.getNextDocumentNumber
      .mockResolvedValueOnce({ documentNumber: 'PI-BIZ-001' })
      .mockResolvedValueOnce({ documentNumber: 'PI-BIZ-002' });
    mocks.resolveDocumentDefaults.mockResolvedValue({
      companyId: 'comp-1',
      settings: {
        piValidityDays: 30,
        defaultTerms: 'Net 30',
        defaultNotes: 'Thank you',
        invoicePrefix: 'INV',
        quotationPrefix: 'QT',
        orderPrefix: 'ORD',
        sequencePadding: 4,
      },
    });
  });

  it('splits an order into template-specific proforma invoices', async () => {
    const order = {
      id: 'ORD-1',
      customerId: 'C-1',
      customer: 'Customer A',
      companyId: 'comp-1',
      projectId: 'PRJ-1',
      quotationId: 'QT-1',
      engineeringDesignId: 'ENG-1',
      total: 400,
      items: [
        { category: 'BOS', qty: 1, price: 100, tax: 18 },
        { category: 'Module', qty: 2, price: 150, tax: 18 },
      ],
    };

    await expect(generatePIsFromOrder(order)).resolves.toEqual(['PI-001', 'PI-002']);

    expect(mocks.createDocWithId).toHaveBeenNthCalledWith(
      1,
      'proforma_invoices',
      'PI-001',
      expect.objectContaining({
        id: 'PI-001',
        orderId: 'ORD-1',
        customerId: 'C-1',
        customer: 'Customer A',
        status: 'Draft',
        paymentStatus: 'Pending',
        templateUsed: 'CSGPL',
        sourceOrderId: 'ORD-1',
        projectId: 'PRJ-1',
        quotationId: 'QT-1',
        engineeringDesignId: 'ENG-1',
        generatedBy: 'user-1',
        approvalStatus: 'Pending',
        invoiceNumber: 'PI-BIZ-001',
        piNumber: 'PI-BIZ-001',
        refNo: 'PI-BIZ-001',
        terms: 'Net 30',
        notes: 'Thank you',
      })
    );

    expect(mocks.createDocWithId).toHaveBeenNthCalledWith(
      2,
      'proforma_invoices',
      'PI-002',
      expect.objectContaining({
        id: 'PI-002',
        templateUsed: 'SANTOSH_VARANASI',
        invoiceNumber: 'PI-BIZ-002',
        piNumber: 'PI-BIZ-002',
        refNo: 'PI-BIZ-002',
      })
    );

    const generatedTotals = mocks.createDocWithId.mock.calls.map((call) => Number(call[2].total));
    expect(generatedTotals.reduce((sum, value) => sum + value, 0)).toBe(400);

    expect(mocks.updateDocById).toHaveBeenCalledWith(
      'orders',
      'ORD-1',
      expect.objectContaining({
        piGenerated: true,
        generatedPIs: ['PI-001', 'PI-002'],
        totalInvoiced: 400,
        pendingBilling: 0,
      })
    );

    expect(mocks.logActivity).toHaveBeenCalledWith(
      'Orders',
      'Generated PI',
      'ORD-1',
      expect.objectContaining({
        entityName: 'Customer A',
        actionLabel: 'Generated proforma invoice',
      })
    );

    expect(mocks.usersByRole).toHaveBeenCalledWith('Accounts');
    expect(mocks.notifyUsers).toHaveBeenCalledWith(
      [{ id: 'accounts-1' }],
      NotificationType.PI_GENERATED,
      'PI generated',
      'Proforma invoice PI-BIZ-001 was generated for order ORD-1.',
      'invoice',
      'PI-001',
      'comp-1'
    );
  });
});

describe('refundPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
    mocks.usersByRole.mockResolvedValue([{ id: 'accounts-1' }]);
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'payments' && id === 'PAY-1') {
        return {
          id: 'PAY-1',
          amount: 500,
          customer: 'Customer A',
          orderId: 'ORD-1',
          companyId: 'comp-1',
          status: 'Recorded',
        };
      }
      if (collection === 'orders' && id === 'ORD-1') {
        return {
          id: 'ORD-1',
          total: 1000,
          status: 'Pending',
          paidAmount: 500,
          generatedPIs: ['PI-1'],
        };
      }
      return null;
    });
    mocks.getAll.mockImplementation(async (collection: string) => {
      if (collection === 'proforma_invoices') {
        return [
          {
            id: 'PI-1',
            orderId: 'ORD-1',
            total: 1000,
            paidAmount: 500,
          },
        ];
      }
      return [];
    });
  });

  it('creates a refund entry and updates linked order and invoices', async () => {
    await expect(refundPayment('PAY-1', 'Customer cancelled')).resolves.toEqual(
      expect.objectContaining({
        paymentId: 'PAY-1',
        refundPaymentId: 'PAY-REF-001',
        orderId: 'ORD-1',
        amount: 500,
      })
    );

    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'payments',
      'PAY-REF-001',
      expect.objectContaining({
        id: 'PAY-REF-001',
        amount: -500,
        status: 'Refunded',
        refundOfPaymentId: 'PAY-1',
        originalPaymentId: 'PAY-1',
        refundReason: 'Customer cancelled',
        createdBy: 'user-1',
        updatedBy: 'user-1',
        isDeleted: false,
      })
    );

    expect(mocks.updateDocById).toHaveBeenCalledWith(
      'payments',
      'PAY-1',
      expect.objectContaining({
        status: 'Refunded',
        refundPaymentId: 'PAY-REF-001',
        refundReason: 'Customer cancelled',
        refundedBy: 'user-1',
      })
    );

    expect(mocks.updateDocById).toHaveBeenCalledWith(
      'orders',
      'ORD-1',
      expect.objectContaining({
        paidAmount: 0,
        amountPaid: 0,
        balanceAmount: 1000,
        paymentStatus: 'Pending',
        lastRefundPaymentId: 'PAY-REF-001',
        paymentReconciliationPending: false,
      })
    );

    expect(mocks.logActivity).toHaveBeenCalledWith(
      'Payments',
      'Refunded Payment',
      'PAY-1',
      expect.objectContaining({
        refundPaymentId: 'PAY-REF-001',
        orderId: 'ORD-1',
        entityName: 'Customer A',
        actionLabel: 'Refunded payment',
        reason: 'Customer cancelled',
      })
    );

    expect(mocks.usersByRole).toHaveBeenCalledWith('Accounts');
    expect(mocks.notifyUsers).toHaveBeenCalledWith(
      [{ id: 'accounts-1' }],
      NotificationType.PAYMENT_RECORDED,
      'Payment refunded',
      'Payment PAY-1 was refunded with reversal entry PAY-REF-001.',
      'payment',
      'PAY-REF-001',
      'comp-1'
    );
  });
});
