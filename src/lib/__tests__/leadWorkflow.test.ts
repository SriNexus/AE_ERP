import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType } from '../../types';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  logActivity: vi.fn(),
  sendNotification: vi.fn(),
  attachUserRole: vi.fn(),
  linkMasterIdentityBestEffort: vi.fn(async () => ''),
  createCustomerProjectionInTransaction: vi.fn(),
  updateCustomerProjection: vi.fn(),
  getState: vi.fn(),
  genId: {
    customer: vi.fn(() => 'CUS-001'),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  genId: mocks.genId,
  resolveWriteGroupId: vi.fn(() => ''),
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
  text: (value: unknown) => (typeof value === 'string' ? value : ''),
}));

vi.mock('../notifications', () => ({
  sendNotification: mocks.sendNotification,
}));

vi.mock('../userIdentity', () => ({
  attachUserRole: mocks.attachUserRole,
  linkMasterIdentityBestEffort: mocks.linkMasterIdentityBestEffort,
}));

vi.mock('../../features/customers/hooks/useCustomers', () => ({
  createCustomerProjectionInTransaction: mocks.createCustomerProjectionInTransaction,
  updateCustomerProjection: mocks.updateCustomerProjection,
}));

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: {
    CUSTOMERS: 'customers',
    LEADS: 'leads',
  },
  firebaseEnv: { isConfigured: false },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: mocks.getState,
  },
}));

import { convertLeadToCustomer } from '../leadWorkflow';

describe('convertLeadToCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
  });

  it('propagates partner ownership through conversion (§9.2 rule 2)', async () => {
    const lead = {
      id: 'lead-1',
      name: 'Partner Solar Lead',
      phone: '9999999999',
      partnerId: 'partner-1',
      partnerName: 'GreenLeaf Solar',
    };

    await expect(convertLeadToCustomer(lead, 'B2C')).resolves.toBe('CUS-001');

    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'customers',
      'CUS-001',
      expect.objectContaining({
        sourceLeadId: 'lead-1',
        // Phase 3: ownership survives conversion — never re-derived from the
        // current user, URL, or UI state.
        partnerId: 'partner-1',
        partnerName: 'GreenLeaf Solar',
      })
    );
  });

  it('creates a customer and marks the lead converted in demo mode', async () => {
    const lead = {
      id: 'lead-1',
      name: 'Solar Lead',
      phone: '9999999999',
      email: 'lead@example.com',
      company: 'Lead Co',
      city: 'Indore',
      gst: 'GSTIN',
      assignedToId: 'rep-9',
    };

    await expect(convertLeadToCustomer(lead, 'B2B')).resolves.toBe('CUS-001');

    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'customers',
      'CUS-001',
      expect.objectContaining({
        id: 'CUS-001',
        name: 'Solar Lead',
        phone: '9999999999',
        email: 'lead@example.com',
        company: 'Lead Co',
        city: 'Indore',
        gst: 'GSTIN',
        type: 'B2B',
        sourceLeadId: 'lead-1',
        convertedBy: 'user-1',
        companyId: 'comp-1',
        createdBy: 'user-1',
        updatedBy: 'user-1',
        isDeleted: false,
      })
    );

    expect(mocks.updateDocById).toHaveBeenCalledWith(
      'leads',
      'lead-1',
      expect.objectContaining({
        status: 'Converted',
        convertedCustomerId: 'CUS-001',
        conversionStatus: 'Completed',
        updatedBy: 'user-1',
      })
    );

    expect(mocks.logActivity).toHaveBeenCalledWith(
      'Leads',
      'Converted to Customer',
      'lead-1',
      expect.objectContaining({
        customerId: 'CUS-001',
        customerType: 'B2B',
        entityName: 'Solar Lead',
        actionLabel: 'Converted lead to customer',
      })
    );

    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'rep-9',
      NotificationType.LEAD_ASSIGNED,
      'Lead converted to customer',
      'Solar Lead was converted to a customer.',
      'lead',
      'lead-1',
      'comp-1'
    );
  });

  // Product change — optional B2C Consumer Number.
  describe('consumerNumber (optional B2C field)', () => {
    it('carries an entered Consumer Number from the lead through to the created Customer on a B2C conversion', async () => {
      const lead = {
        id: 'lead-2',
        name: 'Residential Lead',
        phone: '9888888888',
        assignedToId: 'rep-9',
        consumerNumber: 'CN-123456',
      };

      await expect(convertLeadToCustomer(lead, 'B2C')).resolves.toBe('CUS-001');

      expect(mocks.createDocWithId).toHaveBeenCalledWith(
        'customers',
        'CUS-001',
        expect.objectContaining({ consumerNumber: 'CN-123456', type: 'B2C' })
      );
    });

    it('a B2C conversion with no Consumer Number entered still succeeds — the field is genuinely optional, never required', async () => {
      const lead = {
        id: 'lead-3',
        name: 'Residential Lead 2',
        phone: '9777777777',
        assignedToId: 'rep-9',
        // consumerNumber intentionally omitted
      };

      await expect(convertLeadToCustomer(lead, 'B2C')).resolves.toBe('CUS-001');

      expect(mocks.createDocWithId).toHaveBeenCalledWith(
        'customers',
        'CUS-001',
        expect.objectContaining({ consumerNumber: '', type: 'B2C' })
      );
    });

    it('a B2B conversion is completely unaffected — consumerNumber is simply empty, B2B flow otherwise identical', async () => {
      const lead = {
        id: 'lead-4',
        name: 'Business Lead',
        phone: '9666666666',
        company: 'Biz Co',
        assignedToId: 'rep-9',
      };

      await expect(convertLeadToCustomer(lead, 'B2B')).resolves.toBe('CUS-001');

      expect(mocks.createDocWithId).toHaveBeenCalledWith(
        'customers',
        'CUS-001',
        expect.objectContaining({ consumerNumber: '', type: 'B2B', company: 'Biz Co' })
      );
    });
  });
});
