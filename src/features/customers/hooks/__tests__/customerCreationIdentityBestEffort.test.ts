/**
 * Customer creation — the master-identity link is OPTIONAL enrichment, resolved
 * OUTSIDE the phone-lock transaction and BEST-EFFORT, exactly like Lead
 * creation (entityProjection.attachUserId). This is the Customer half of the
 * cross-role authorization fix: a Group Admin (or any actor the staff-account
 * `users` rules deny a contact write) must still be able to create a Customer;
 * the canonical customer + its phone-lock are the only REQUIRED writes.
 *
 * Root cause it regression-guards: useSaveCustomer used to call
 * resolveOrCreateMasterUser unwrapped BEFORE createCustomerProjection, and
 * createCustomerProjectionInTransaction called resolveOrCreateMasterUserInTransaction
 * INSIDE runTransaction — either one's permission-denied aborted the whole
 * Customer creation before the canonical write was reached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  linkMasterIdentityBestEffort: vi.fn(),
  createDocWithId: vi.fn(),
  getOne: vi.fn(),
  updateDocById: vi.fn(),
  runTransaction: vi.fn(),
  resolveWriteGroupId: vi.fn(() => 'group-1'),
  resolveWriteCompanyId: vi.fn(() => 'company-1'),
  update: vi.fn(async (_id: string, p: Record<string, unknown>) => p),
}));

vi.mock('../../../../lib/userIdentity', () => ({
  linkMasterIdentityBestEffort: mocks.linkMasterIdentityBestEffort,
  normalizePhone: (p: string) => String(p).replace(/\D/g, '').slice(-10),
}));

vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  getOne: mocks.getOne,
  getAll: vi.fn(),
  genId: { customer: vi.fn(() => 'CUS-NEW') },
  resolveWriteCompanyId: mocks.resolveWriteCompanyId,
  resolveWriteGroupId: mocks.resolveWriteGroupId,
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}`, id }),
  runTransaction: (_db: unknown, fn: (t: unknown) => unknown) => mocks.runTransaction(fn),
  serverTimestamp: () => '__ts__',
  // Transaction type is a compile-time-only import in the source.
}));

vi.mock('../../../../lib/firebase', () => ({
  db: {},
  COLLECTIONS: { CUSTOMERS: 'customers', PROJECTS: 'projects', CHANNEL_PARTNERS: 'channel_partners' },
  firebaseEnv: { isConfigured: true },
}));

vi.mock('../../../../lib/sanitizer', () => ({ sanitizeFirestoreData: (d: unknown) => d }));
vi.mock('../../../../lib/partnerOwnership', () => ({
  resolveCurrentPartnerDocId: vi.fn(async () => ''),
  getCachedPartnerDocId: () => '',
  resolveCurrentPartnerDocId2: vi.fn(),
}));
vi.mock('../../../../lib/companyBusinessMode', () => ({ resolveBusinessMode: () => 'Both' }));
vi.mock('../../../../lib/customerClassification', () => ({ isCustomerTypeAllowedForBusinessMode: () => true }));
vi.mock('../../../../services/CustomerDomainService', () => ({ CustomerDomainService: { update: mocks.update } }));
vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ activeCompanyId: 'company-1', company: { id: 'company-1' }, user: { id: 'user-1' } }) },
  useCurrentUser: () => ({ id: 'user-1' }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(), useMutation: vi.fn(), useQueryClient: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../hooks/usePaginatedCollection', () => ({ usePaginatedCollection: vi.fn() }));
vi.mock('../../../../lib/queryKeys', () => ({ queryKeys: { forCompany: () => ({}) } }));

type TxnSet = { ref: { path: string; id: string }; data: Record<string, unknown> };

function fakeTransaction() {
  const sets: TxnSet[] = [];
  return {
    sets,
    get: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
    set: vi.fn((ref: { path: string; id: string }, data: Record<string, unknown>) => { sets.push({ ref, data }); }),
  };
}

let createCustomerProjection: typeof import('../useCustomers')['createCustomerProjection'];

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.resolveWriteGroupId.mockReturnValue('group-1');
  const txn = fakeTransaction();
  mocks.runTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(txn));
  (globalThis as Record<string, unknown>).__txn = txn;
  ({ createCustomerProjection } = await import('../useCustomers'));
});

function customerSetFrom(): Record<string, unknown> {
  const txn = (globalThis as Record<string, unknown>).__txn as ReturnType<typeof fakeTransaction>;
  const hit = txn.sets.find((s) => s.ref.path === 'customers/CUS-1');
  if (!hit) throw new Error('canonical customer write never happened');
  return hit.data;
}

describe('createCustomerProjection — best-effort master-identity link', () => {
  it('resolves the identity link BEFORE the transaction (never inside it)', async () => {
    mocks.linkMasterIdentityBestEffort.mockResolvedValue('MUSR-company-1-9990002222');
    const order: string[] = [];
    mocks.linkMasterIdentityBestEffort.mockImplementation(async () => { order.push('link'); return 'MUSR-x'; });
    mocks.runTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => { order.push('txn'); return fn(fakeTransaction()); });

    await createCustomerProjection('CUS-1', { name: 'Meera', phone: '9990002222', type: 'B2B', companyId: 'company-1' });

    expect(order).toEqual(['link', 'txn']);
  });

  it('when the link resolves, the canonical Customer carries userId + masterUserId', async () => {
    mocks.linkMasterIdentityBestEffort.mockResolvedValue('MUSR-company-1-9990002222');
    await createCustomerProjection('CUS-1', { name: 'Meera', phone: '9990002222', type: 'B2B', companyId: 'company-1' });
    const written = customerSetFrom();
    expect(written.userId).toBe('MUSR-company-1-9990002222');
    expect(written.masterUserId).toBe('MUSR-company-1-9990002222');
  });

  it('when the link is DENIED/skipped ("" returned), the canonical Customer is still created UNLINKED', async () => {
    mocks.linkMasterIdentityBestEffort.mockResolvedValue('');
    await expect(
      createCustomerProjection('CUS-1', { name: 'Meera', phone: '9990002222', type: 'B2B', companyId: 'company-1' }),
    ).resolves.toMatchObject({ id: 'CUS-1', userId: '', masterUserId: '' });
    const written = customerSetFrom();
    expect('userId' in written).toBe(false);
    expect('masterUserId' in written).toBe(false);
    expect(written.name).toBe('Meera');
    expect(written.companyId).toBe('company-1');
    expect(written.groupId).toBe('group-1');
  });

  it('the phone-lock is always written with the derived groupId (required write, unaffected by the link)', async () => {
    mocks.linkMasterIdentityBestEffort.mockResolvedValue('');
    await createCustomerProjection('CUS-1', { name: 'Meera', phone: '9990002222', type: 'B2B', companyId: 'company-1' });
    const txn = (globalThis as Record<string, unknown>).__txn as ReturnType<typeof fakeTransaction>;
    const lock = txn.sets.find((s) => s.ref.path.startsWith('customer_phone_locks/'));
    expect(lock?.data.customerId).toBe('CUS-1');
    expect(lock?.data.groupId).toBe('group-1');
  });
});
