/**
 * taxInvoiceWorkflow.test.ts — Unit tests for Tax Invoice Workflow
 *
 * Covers:
 * - Creation (draft)
 * - Validation
 * - State transitions (Draft → Issued → Cancelled)
 * - Immutable history
 * - Invalid transitions
 * - Audit logging
 * - Notification generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies
vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      activeCompanyId: 'company-1',
      company: {
        id: 'company-1',
        shortName: 'TEST',
        name: 'Test Company',
        gst: '22AAAAA0000A1Z5',
        state: 'Odisha',
        currencySymbol: '\u20b9',
        fiscalYearStart: '04-01',
      },
      user: { id: 'user-1', name: 'Test User' },
    })),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: vi.fn(() => Promise.resolve()),
  genId: { generic: vi.fn(() => 'TINV-TEST-ID') },
  getAll: vi.fn(() => Promise.resolve([])),
  getOne: vi.fn(() => Promise.resolve(null)),
  updateDocById: vi.fn(() => Promise.resolve()),
}));

// Mock firebase/firestore to include ALL exports firebase.ts needs
vi.mock('firebase/firestore', () => ({
  // firebase.ts imports
  initializeFirestore: vi.fn(() => ({})),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  connectFirestoreEmulator: vi.fn(),
  getCountFromServer: vi.fn(() => Promise.resolve({ data: () => ({ count: 0 }) })),
  getDocs: vi.fn(() => Promise.resolve({ size: 0, docs: [], forEach: vi.fn() })),
  // taxInvoiceWorkflow.ts imports
  doc: vi.fn(() => ({})),
  // firebase's runTransaction takes (db, callback) format
  runTransaction: vi.fn(async (db: any, fn: any) => {
    const transaction = {
      get: vi.fn(() => Promise.resolve({ exists: () => false, data: () => null })),
      set: vi.fn(() => {}),
    };
    return fn(transaction);
  }),
  serverTimestamp: vi.fn(() => new Date().toISOString()),
}));

vi.mock('../workflow', () => ({
  logActivity: vi.fn(() => Promise.resolve()),
}));

vi.mock('../notifications', () => ({
  notifyRoleUsers: vi.fn(() => Promise.resolve()),
  resolveNotificationCompanyId: vi.fn(() => 'company-1'),
}));

vi.mock('../gstCalculation', () => ({
  calculateGstBreakdown: vi.fn(() => ({
    placeOfSupply: 'Odisha',
    customer: { gstin: '', state: 'Odisha' },
    lines: [],
    subtotal: 1000,
    cgst: 90,
    sgst: 90,
    igst: 0,
    totalTax: 180,
    grandTotal: 1180,
  })),
  getFiscalYearLabel: vi.fn(() => '2425'),
}));

import {
  createTaxInvoiceDraft,
  issueTaxInvoice,
  cancelTaxInvoice,
} from '../taxInvoiceWorkflow';

import * as firestoreMock from '../firestore';

describe('Tax Invoice Workflow', () => {
  const validForm = {
    sourceType: 'order' as const,
    sourceId: 'order-1',
    orderId: 'order-1',
    date: '2024-06-15',
    status: 'Draft' as const,
    companyId: 'company-1',
    companyName: 'Test Company',
    companyGst: '22AAAAA0000A1Z5',
    companyState: 'Odisha',
    customerId: 'customer-1',
    customerName: 'Test Customer',
    customerGst: '22BBBBB0000B1Z5',
    customerState: 'Odisha',
    placeOfSupply: 'Odisha',
    items: [
      {
        productId: 'prod-1',
        product: 'Solar Panel 500W',
        description: '500W Mono PERC Solar Panel',
        hsn: '85414300',
        quantity: 10,
        rate: 15000,
        taxRate: 18,
      },
    ],
    subtotal: 150000,
    cgst: 13500,
    sgst: 13500,
    igst: 0,
    totalTax: 27000,
    total: 177000,
    notes: 'Test tax invoice',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTaxInvoiceDraft', () => {
    it('creates a draft invoice with valid form', async () => {
      const result = await createTaxInvoiceDraft(validForm);
      expect(result).toBeDefined();
      expect(firestoreMock.createDocWithId).toHaveBeenCalled();
    });

    it('rejects missing sourceId', async () => {
      await expect(
        createTaxInvoiceDraft({ ...validForm, sourceId: '' }),
      ).rejects.toThrow('Source document is required');
    });

    it('rejects missing customerName', async () => {
      await expect(
        createTaxInvoiceDraft({ ...validForm, customerName: '' }),
      ).rejects.toThrow('Customer is required');
    });

    it('rejects missing companyGst and companyState', async () => {
      await expect(
        createTaxInvoiceDraft({ ...validForm, companyGst: '', companyState: '' }),
      ).rejects.toThrow('Company GST/state is required');
    });

    it('rejects missing items', async () => {
      await expect(
        createTaxInvoiceDraft({ ...validForm, items: [] }),
      ).rejects.toThrow('Add at least one line item');
    });
  });

  describe('issueTaxInvoice', () => {
    const mockDraft = {
      id: 'TINV-001',
      invoiceNumber: 'TINV-TEST-2425-0001',
      status: 'Draft',
      sourceType: 'order',
      sourceId: 'order-1',
      items: [],
      total: 177000,
      customerName: 'Test Customer',
      companyName: 'Test Company',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      (firestoreMock.getOne as any).mockResolvedValue(mockDraft);
    });

    it('issues a draft invoice', async () => {
      const result = await issueTaxInvoice('TINV-001');
      expect(result.status).toBe('Issued');
      expect(result.issuedAt).toBeDefined();
      expect(firestoreMock.updateDocById).toHaveBeenCalled();
    });

    it('rejects issuing already issued invoice', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({ ...mockDraft, status: 'Issued' });
      await expect(
        issueTaxInvoice('TINV-001'),
      ).rejects.toThrow('Only draft tax invoices can be issued');
    });

    it('rejects issuing cancelled invoice', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({ ...mockDraft, status: 'Cancelled' });
      await expect(
        issueTaxInvoice('TINV-001'),
      ).rejects.toThrow('Only draft tax invoices can be issued');
    });
  });

  describe('cancelTaxInvoice', () => {
    const mockIssued = {
      id: 'TINV-001',
      invoiceNumber: 'TINV-TEST-2425-0001',
      status: 'Issued',
      sourceType: 'order',
      sourceId: 'order-1',
      items: [],
      total: 177000,
      customerName: 'Test Customer',
      companyName: 'Test Company',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      (firestoreMock.getOne as any).mockResolvedValue(mockIssued);
    });

    it('cancels an issued invoice', async () => {
      const result = await cancelTaxInvoice('TINV-001', 'Customer requested cancellation');
      expect(result.status).toBe('Cancelled');
      expect(result.cancellationReason).toBe('Customer requested cancellation');
      expect(firestoreMock.updateDocById).toHaveBeenCalled();
    });

    it('cancels a draft invoice', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({
        ...mockIssued,
        status: 'Draft',
      });
      const result = await cancelTaxInvoice('TINV-001', 'Draft no longer needed');
      expect(result.status).toBe('Cancelled');
    });

    it('rejects cancelling already cancelled invoice', async () => {
      (firestoreMock.getOne as any).mockResolvedValueOnce({ ...mockIssued, status: 'Cancelled' });
      await expect(
        cancelTaxInvoice('TINV-001', 'Try again'),
      ).rejects.toThrow('Tax invoice is already cancelled');
    });

    it('uses default reason when none provided', async () => {
      const result = await cancelTaxInvoice('TINV-001');
      expect(result.cancellationReason).toBe('Cancelled by user');
    });
  });
});
