import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ createDocWithId: vi.fn(), deleteDocById: vi.fn() }));

vi.mock('../../../lib/firebase', () => ({ COLLECTIONS: { VENDORS: 'vendors', PURCHASE_ORDERS: 'purchase_orders' }, db: {} }));
vi.mock('../../../lib/firestore', () => ({
  createDocWithId: mocks.createDocWithId.mockImplementation(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  deleteDocById: mocks.deleteDocById.mockImplementation(async (c: string, id: string) => { col(c)[id] = { ...(col(c)[id] || { id }), isDeleted: true }; }),
  genId: { generic: (p = 'ID') => `${p}-GEN` },
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  updateDocById: vi.fn(),
}));
vi.mock('../../../lib/permissions', () => ({ canDo: vi.fn(() => true) }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: vi.fn(() => ({ user: { id: 'U-1' } })) } }));
vi.mock('../../../lib/workflow', () => ({ logActivity: vi.fn() }));

import { normalizeVendorInput, createVendor, deleteVendor } from './vendorWorkflow';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.clearAllMocks();
});

describe('vendorWorkflow validation', () => {
  it('normalizes GSTIN, contact details, and unique category tags', () => {
    expect(normalizeVendorInput({ name: '  Solar Supply Co ', gstin: '27abcde1234f1z5', contactPerson: '  Asha ', phone: ' 9999999999 ', email: ' SALES@EXAMPLE.COM ', address: ' Pune ', paymentTerms: ' Net 30 ', categoryTags: 'Panels, Inverters, Panels' })).toEqual({
      name: 'Solar Supply Co', gstin: '27ABCDE1234F1Z5', contactInfo: { contactPerson: 'Asha', phone: '9999999999', email: 'sales@example.com', address: 'Pune' }, paymentTerms: 'Net 30', categoryTags: ['Panels', 'Inverters'],
    });
  });

  it('rejects malformed GSTIN and email values', () => {
    const base = { name: 'Vendor', gstin: '', contactPerson: '', phone: '', email: '', address: '', paymentTerms: '', categoryTags: '' };
    expect(() => normalizeVendorInput({ ...base, gstin: 'invalid' })).toThrow('valid 15-character GSTIN');
    expect(() => normalizeVendorInput({ ...base, email: 'invalid' })).toThrow('valid email');
  });
});

const VENDOR_INPUT = { name: 'Solar Supply Co', gstin: '', contactPerson: '', phone: '', email: '', address: '', paymentTerms: '', categoryTags: '' };

describe('INVENTORY-09 — vendor delete guard (§14)', () => {
  it('a vendor with no purchase orders can be deleted', async () => {
    const v = await createVendor(VENDOR_INPUT);
    await deleteVendor(v.id);
    expect(col('vendors')[v.id].isDeleted).toBe(true);
  });

  it('a vendor with a non-cancelled purchase order is blocked', async () => {
    const v = await createVendor(VENDOR_INPUT);
    col('purchase_orders')['PO-1'] = { id: 'PO-1', vendorId: v.id, status: 'Sent', isDeleted: false };
    await expect(deleteVendor(v.id)).rejects.toThrow(/non-cancelled purchase order/i);
    expect(col('vendors')[v.id].isDeleted).not.toBe(true);
  });

  it('a vendor whose only PO is Cancelled is deletable — the PO itself is preserved, not deleted', async () => {
    const v = await createVendor(VENDOR_INPUT);
    col('purchase_orders')['PO-2'] = { id: 'PO-2', vendorId: v.id, status: 'Cancelled', isDeleted: false };
    await deleteVendor(v.id);
    expect(col('vendors')[v.id].isDeleted).toBe(true);
    expect(col('purchase_orders')['PO-2'].isDeleted).toBe(false); // untouched, never cascade-deleted
  });
});
