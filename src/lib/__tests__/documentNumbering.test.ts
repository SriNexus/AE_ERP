import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  doc: vi.fn(),
  collection: vi.fn((_db, collectionId) => ({ collectionId })),
  query: vi.fn((ref) => ref),
  where: vi.fn(() => ({})),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  getState: vi.fn(),
  resolveDocumentSettings: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  getDocs: mocks.getDocs,
  query: mocks.query,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
  where: mocks.where,
}));

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: {
    DOCUMENT_COUNTERS: 'document_counters',
    QUOTATIONS: 'quotations',
    ORDERS: 'orders',
    PROFORMA_INVOICES: 'proforma_invoices',
  },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: mocks.getState,
  },
}));

vi.mock('../../features/settings/documentRuntime', async () => {
  const actual = await vi.importActual<typeof import('../../features/settings/documentRuntime')>('../../features/settings/documentRuntime');
  return {
    ...actual,
    resolveDocumentSettings: mocks.resolveDocumentSettings,
  };
});

import { getNextDocumentNumber, resolveDocumentDefaults } from '../documentNumbering';

describe('document numbering runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: {
        id: 'company-1',
        invoicePrefix: 'INV',
        quotationPrefix: 'QT',
        orderPrefix: 'ORD',
      },
      globalCompany: null,
    });
    mocks.resolveDocumentSettings.mockResolvedValue({
      piValidityDays: 30,
      defaultTerms: 'Net 30',
      defaultNotes: 'Thank you',
      invoicePrefix: 'INV',
      quotationPrefix: 'QT',
      orderPrefix: 'ORD',
      sequencePadding: 4,
    });
    mocks.doc.mockImplementation((_db: unknown, collectionId: string, counterId: string) => ({ collectionId, counterId }));
    mocks.getDocs.mockResolvedValue({ docs: [] });
    mocks.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: any) => Promise<number> | number) => {
      const transaction = {
        get: vi.fn(async () => ({ exists: () => false, data: () => null })),
        set: vi.fn(),
      };
      return callback(transaction);
    });
  });

  it('allocates sequence numbers inside a Firestore transaction', async () => {
    const result = await getNextDocumentNumber('company-1', 'invoice');

    expect(mocks.doc).toHaveBeenCalledWith({}, 'document_counters', 'company-1_invoice');
    expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      companyId: 'company-1',
      docType: 'invoice',
      sequenceNumber: 1,
      documentNumber: 'INV-0001',
      counterId: 'company-1_invoice',
    });
  });

  it('exposes company defaults for save/reset flows', async () => {
    await expect(resolveDocumentDefaults('company-1')).resolves.toMatchObject({
      companyId: 'company-1',
      settings: expect.objectContaining({
        invoicePrefix: 'INV',
        quotationPrefix: 'QT',
        orderPrefix: 'ORD',
        sequencePadding: 4,
      }),
    });
  });

  it('starts after the highest existing company document number when a counter is absent', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [
      { data: () => ({ orderNumber: 'ORD-0007' }) },
      { data: () => ({ orderNo: 'ORD-0003' }) },
    ] });

    await expect(getNextDocumentNumber('company-1', 'order')).resolves.toMatchObject({
      sequenceNumber: 8,
      documentNumber: 'ORD-0008',
    });
  });
});
