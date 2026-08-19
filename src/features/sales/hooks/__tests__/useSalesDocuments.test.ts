import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  genId: {
    quotation: vi.fn(() => 'QT-TECH-1'),
    invoice: vi.fn(() => 'PI-TECH-1'),
  },
  getState: vi.fn(),
  getNextDocumentNumber: vi.fn(),
  resolveDocumentDefaults: vi.fn(),
}));

vi.mock('../../../../lib/firestore', () => ({
  getAll: vi.fn(),
  deleteDocById: vi.fn(),
  genId: mocks.genId,
  fmtDate: vi.fn(),
  createDocWithId: mocks.createDocWithId,
  resolveWriteCompanyCode: (companyId?: string) => {
    const s = mocks.getState() as any;
    const targetId = companyId || s.activeCompanyId || s.company?.id || s.user?.companyId || '';
    return s.company?.id === targetId ? (s.company?.companyCode || '') : '';
  },
}));

vi.mock('../../../../lib/documentNumbering', () => ({
  getNextDocumentNumber: mocks.getNextDocumentNumber,
  resolveDocumentDefaults: mocks.resolveDocumentDefaults,
}));

vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: {
    getState: mocks.getState,
  },
  useCurrentUser: vi.fn(() => ({ id: 'user-1', companyId: 'company-1' })),
}));

import { createPI, createQuotation, paymentLinkageFromOrder } from '../useSales';

describe('sales document creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1', companyCode: 'AE-01' },
      user: { id: 'user-1', companyId: 'company-1' },
    });
    mocks.resolveDocumentDefaults.mockResolvedValue({
      companyId: 'company-1',
      settings: {
        piValidityDays: 15,
        defaultTerms: 'Net 15',
        defaultNotes: 'Default notes',
        invoicePrefix: 'INV',
        quotationPrefix: 'QT',
        orderPrefix: 'ORD',
        sequencePadding: 4,
      },
    });
  });

  it('assigns a transactional quotation number and defaults', async () => {
    mocks.getNextDocumentNumber.mockResolvedValue({ documentNumber: 'QT-0001' });

    await createQuotation({ customer: 'Customer A', date: '2026-07-12', companyId: 'company-1' });
    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        companyId: 'company-1',
        quotationNumber: 'QT-0001',
        quoteNumber: 'QT-0001',
        refNo: 'QT-0001',
        validUntil: '2026-07-27',
        terms: 'Net 15',
        notes: 'Default notes',
      }),
    );
  });

  it('assigns a transactional PI number and defaults', async () => {
    mocks.getNextDocumentNumber.mockResolvedValue({ documentNumber: 'PI-0001' });

    await createPI({ customer: 'Customer A', date: '2026-07-12', companyId: 'company-1', dueDate: '' });
    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        companyId: 'company-1',
        invoiceNumber: 'PI-0001',
        piNumber: 'PI-0001',
        refNo: 'PI-0001',
        dueDate: '2026-07-27',
        terms: 'Net 15',
        notes: 'Default notes',
        // Data-driven: the resolved company's own companyCode (see
        // resolveWriteCompanyCode()), never a hardcoded company-name literal.
        templateUsed: 'AE-01',
      }),
    );
  });

  it('preserves the commercial relationship chain on order-linked payments', () => {
    expect(paymentLinkageFromOrder({
      projectId: 'project-1',
      sourceQuotationId: 'quote-1',
      engineeringDesignId: 'design-1',
      generatedPIs: ['pi-1', 'pi-2'],
    })).toEqual({
      projectId: 'project-1',
      quotationId: 'quote-1',
      engineeringDesignId: 'design-1',
      invoiceId: 'pi-1',
      invoiceIds: ['pi-1', 'pi-2'],
    });
  });
});
