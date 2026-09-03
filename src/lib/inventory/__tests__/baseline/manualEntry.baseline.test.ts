/**
 * manualEntry.baseline.test.ts — INVENTORY-00 (Baseline & Safety Lock)
 * ===================================================================
 *
 * Freezes the CURRENT behavior of the manual "Add Stock" / "Adjust Stock"
 * write path — src/features/inventory/hooks/useInventory.ts `useSaveStockEntry`.
 *
 * The hook returns a react-query mutation; this test drives its `mutationFn`
 * directly (react-query + firebase are mocked). A fake Firestore transaction
 * object stands in for `runTransaction`.
 *
 * Characterization only. DO NOT fix anything here.
 *
 * Known-defect / structure coverage:
 *   - P1-4 : this is a SECOND, parallel stock-write implementation, distinct
 *            from stockWorkflow.stockIn, with its own `stockSummaryId` copy
 *            and its own ledger field set (spreads the raw form `data`).
 *   - P0-3 : `reservedQty` is carried forward (currentReserved), never changed.
 *   - idempotency: each call mints a fresh STK id; nothing dedups a repeat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  notifyRoleUsers: vi.fn(),
  resolveWriteGroupId: vi.fn(() => 'grp-1'),
  idCounter: 0,
  txSet: vi.fn(),
  stockExists: true,
  stockData: { availableQty: 10, reservedQty: 4, createdAt: 'orig' } as Record<string, unknown>,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts: any) => opts, // expose mutationFn / onError directly
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('../../../firestore', () => ({
  getAll: vi.fn(async () => []),
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  deleteDocById: vi.fn(),
  fmtDate: (v: unknown) => String(v ?? ''),
  resolveWriteGroupId: mocks.resolveWriteGroupId,
  genId: { generic: (p = 'GEN') => `${p}-${++mocks.idCounter}` },
}));
vi.mock('../../../firebase', () => ({
  db: {},
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', PRODUCTS: 'products' },
}));
vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (sel: (s: any) => unknown) => sel({ activeCompanyId: 'comp-1' }),
  useCurrentUser: () => ({ id: 'user-1' }),
}));
vi.mock('../../../queryKeys', () => ({
  queryKeys: { forCompany: () => ({ stock: ['stock'], stockLedger: ['stock_ledger'], productsRoot: ['p'], productsAll: ['pa'], categories: ['c'], warehouses: ['w'] }) },
}));
vi.mock('../../../../config/company', () => ({ UNITS: ['PCS', 'Nos'] }));
vi.mock('react-hot-toast', () => ({ default: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('../../../notifications', () => ({ notifyRoleUsers: mocks.notifyRoleUsers }));
vi.mock('../../../sanitizer', () => ({ sanitizePayload: (x: unknown) => x }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ _col: col, _id: id }),
  serverTimestamp: () => 'TS',
  runTransaction: async (_db: unknown, cb: (tx: any) => Promise<void>) => {
    const tx = {
      get: async () => ({ exists: () => mocks.stockExists, data: () => mocks.stockData }),
      set: mocks.txSet,
    };
    return cb(tx);
  },
}));

import { useSaveStockEntry } from '../../../../features/inventory/hooks/useInventory';

/**
 * The mocked `useMutation` (above) returns the options object verbatim, so the
 * hook result carries `.mutationFn` at runtime. The production return type does
 * not expose it — hence this cast, isolated to one helper.
 */
type MutationLike = { mutationFn: (data: Record<string, unknown>) => Promise<void> };
const saveEntry = (): MutationLike => useSaveStockEntry(() => {}) as unknown as MutationLike;

const FORM = {
  productId: 'P-1', product: 'Panel', warehouseId: 'W-1', warehouse: 'Main',
  type: 'IN' as const, qty: '5', unit: 'PCS', reference: 'REF-1', notes: 'note',
  date: '2026-09-03',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.idCounter = 0;
  mocks.stockExists = true;
  mocks.stockData = { availableQty: 10, reservedQty: 4, createdAt: 'orig' };
});

describe('INVENTORY-00 BASELINE — useInventory.useSaveStockEntry (manual stock adjust)', () => {
  it('IN: nextAvailable = currentAvailable + qty; writes ledger + summary in the transaction', async () => {
    const m = saveEntry();
    await m.mutationFn({ ...FORM, type: 'IN', qty: '5' });

    const [ledgerCall, summaryCall] = mocks.txSet.mock.calls;
    // ledger row: spreads the raw form data + before/after
    expect(ledgerCall[1]).toMatchObject({ type: 'IN', qty: 5, beforeQty: 10, afterQty: 15, reference: 'REF-1', companyId: 'comp-1', createdBy: 'user-1' });
    // summary
    expect(summaryCall[0]).toMatchObject({ _col: 'stock' });
    expect(summaryCall[1]).toMatchObject({ availableQty: 15, reservedQty: 4, productId: 'P-1', warehouseId: 'W-1', companyId: 'comp-1', isDeleted: false });
  });

  it('OUT: nextAvailable = currentAvailable - qty', async () => {
    const m = saveEntry();
    await m.mutationFn({ ...FORM, type: 'OUT', qty: '3' });
    const summaryCall = mocks.txSet.mock.calls[1];
    expect(summaryCall[1]).toMatchObject({ availableQty: 7, reservedQty: 4 });
  });

  it('OUT below zero throws "Insufficient stock" and nothing is written', async () => {
    const m = saveEntry();
    await expect(m.mutationFn({ ...FORM, type: 'OUT', qty: '99' })).rejects.toThrow('Insufficient stock');
    expect(mocks.txSet).not.toHaveBeenCalled();
  });

  it('BASELINE (P0-3): reservedQty (currentReserved) is carried forward unchanged', async () => {
    mocks.stockData = { availableQty: 10, reservedQty: 7, createdAt: 'orig' };
    const m = saveEntry();
    await m.mutationFn({ ...FORM, type: 'IN', qty: '1' });
    expect(mocks.txSet.mock.calls[1][1]).toMatchObject({ reservedQty: 7, availableQty: 11 });
  });

  it('throws "Stock summary is inconsistent" when the existing summary has negative qty', async () => {
    mocks.stockData = { availableQty: -1, reservedQty: 0, createdAt: 'orig' };
    const m = saveEntry();
    await expect(m.mutationFn({ ...FORM, type: 'IN', qty: '1' })).rejects.toThrow('inconsistent');
  });

  it('validates inputs before opening the transaction', async () => {
    const m = saveEntry();
    await expect(m.mutationFn({ ...FORM, productId: '' })).rejects.toThrow('Product is required');
    await expect(m.mutationFn({ ...FORM, warehouseId: '' })).rejects.toThrow('Warehouse is required');
    await expect(m.mutationFn({ ...FORM, qty: '0' })).rejects.toThrow('greater than zero');
    await expect(m.mutationFn({ ...FORM, qty: '-2' })).rejects.toThrow('greater than zero');
    expect(mocks.txSet).not.toHaveBeenCalled();
  });

  it('BASELINE (P1-4): uses its OWN stockSummaryId (SUM-{enc}-{enc}-{enc}) — a local copy, not stockWorkflow\'s import', async () => {
    const m = saveEntry();
    await m.mutationFn({ ...FORM, productId: 'P/1', warehouseId: 'W 1' }); // chars that get URL-encoded
    const summaryRef = mocks.txSet.mock.calls[1][0];
    expect(summaryRef._id).toBe('SUM-comp-1-P%2F1-W%201');
  });

  it('BASELINE: no idempotency — a fresh STK id is generated on every call, nothing dedups a repeat', async () => {
    const m = saveEntry();
    await m.mutationFn({ ...FORM, type: 'IN', qty: '2' });
    mocks.stockData = { availableQty: 12, reservedQty: 4, createdAt: 'orig' };
    await m.mutationFn({ ...FORM, type: 'IN', qty: '2' });

    const ledgerIds = mocks.txSet.mock.calls.filter((c) => c[0]._col === 'stock_ledger').map((c) => c[0]._id);
    expect(new Set(ledgerIds).size).toBe(2); // two distinct ledger rows for two identical submissions
  });
});
