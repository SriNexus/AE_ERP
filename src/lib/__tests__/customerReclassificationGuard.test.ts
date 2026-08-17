import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 4: defense-in-depth guard in updateCustomerProjectionWithPhoneLock() —
// "B2B customers must NEVER have a Project" is a locked business rule, so a
// B2C customer that already has a linked Project cannot be reclassified as
// B2B. This is the true lowest-level enforcement (the Customer Workspace
// editor only removes the option from the UI for immediate feedback).
const mocks = vi.hoisted(() => ({
  getOne: vi.fn(),
  getAll: vi.fn(),
  createDocWithId: vi.fn(),
  genId: { customer: vi.fn(() => 'CUS-NEW') },
  update: vi.fn(async (_id: string, payload: Record<string, unknown>) => payload),
}));

vi.mock('../firestore', () => ({
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  createDocWithId: mocks.createDocWithId,
  genId: mocks.genId,
  // resolveCompanyId (useCustomers.ts) now delegates to the canonical
  // resolveWriteCompanyId() instead of a local duplicate — matches this
  // file's mocked useAppStore.getState() (activeCompanyId: 'comp-1').
  resolveWriteCompanyId: vi.fn(() => 'comp-1'),
}));

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: { CUSTOMERS: 'customers', PROJECTS: 'projects' },
  firebaseEnv: { isConfigured: false },
}));

vi.mock('../sanitizer', () => ({
  sanitizeFirestoreData: (data: unknown) => data,
}));

vi.mock('../userIdentity', () => ({
  normalizePhone: (phone: string) => phone,
  resolveOrCreateMasterUser: vi.fn(),
  resolveOrCreateMasterUserInTransaction: vi.fn(),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ activeCompanyId: 'comp-1', company: { id: 'comp-1' }, user: { id: 'user-1' } }) },
  useCurrentUser: () => ({ id: 'user-1' }),
}));

vi.mock('../../services/CustomerDomainService', () => ({
  CustomerDomainService: { update: mocks.update },
}));

vi.mock('../../lib/companyBusinessMode', () => ({
  resolveBusinessMode: () => 'Both',
}));

vi.mock('../../lib/customerClassification', () => ({
  isCustomerTypeAllowedForBusinessMode: () => true,
}));

import { updateCustomerProjectionWithPhoneLock } from '../../features/customers/hooks/useCustomers';

describe('updateCustomerProjectionWithPhoneLock — Phase 4 reclassification guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks reclassifying a B2C customer with a linked Project to B2B', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'CUS-1', type: 'B2C', phone: '9876543210' });
    mocks.getAll.mockResolvedValueOnce([{ customerId: 'CUS-1', isDeleted: false }]);

    await expect(updateCustomerProjectionWithPhoneLock('CUS-1', { type: 'B2B' })).rejects.toThrow('cannot be reclassified as B2B');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('allows reclassifying a B2C customer with no linked Project to B2B', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'CUS-2', type: 'B2C', phone: '9876543211' });
    mocks.getAll.mockResolvedValueOnce([{ customerId: 'SOME-OTHER-CUSTOMER', isDeleted: false }]);

    await expect(updateCustomerProjectionWithPhoneLock('CUS-2', { type: 'B2B' })).resolves.toBeDefined();
    expect(mocks.update).toHaveBeenCalled();
  });

  it('ignores soft-deleted Projects when checking for a linked Project', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'CUS-3', type: 'B2C', phone: '9876543212' });
    mocks.getAll.mockResolvedValueOnce([{ customerId: 'CUS-3', isDeleted: true }]);

    await expect(updateCustomerProjectionWithPhoneLock('CUS-3', { type: 'B2B' })).resolves.toBeDefined();
  });

  it('does not run the Project check when the type is not changing to B2B (e.g. editing other fields, or B2B -> B2C)', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'CUS-4', type: 'B2B', phone: '9876543213' });

    await expect(updateCustomerProjectionWithPhoneLock('CUS-4', { type: 'B2C' })).resolves.toBeDefined();
    expect(mocks.getAll).not.toHaveBeenCalled();
  });
});
