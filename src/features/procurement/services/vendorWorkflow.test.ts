import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/firebase', () => ({ COLLECTIONS: { VENDORS: 'vendors' }, db: {} }));
vi.mock('../../../lib/firestore', () => ({ createDocWithId: vi.fn(), deleteDocById: vi.fn(), genId: { generic: vi.fn() }, getAll: vi.fn(), getOne: vi.fn(), updateDocById: vi.fn() }));
vi.mock('../../../lib/permissions', () => ({ canDo: vi.fn(() => true) }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: vi.fn(() => ({ user: { id: 'U-1' } })) } }));
vi.mock('../../../lib/workflow', () => ({ logActivity: vi.fn() }));

import { normalizeVendorInput } from './vendorWorkflow';

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
