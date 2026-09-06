/**
 * manualEntry.baseline.test.ts — INVENTORY-00 baseline, REWRITTEN for INVENTORY-05d
 * ==============================================================================
 *
 * INVENTORY-00 froze the pre-engine behaviour of `useInventory.useSaveStockEntry`
 * (its own runTransaction, its own `stockSummaryId` copy, spread-the-raw-form
 * ledger). INVENTORY-05d routes manual Add / Adjust Stock through the movement
 * engine — the single stock writer (P1-4). This file now characterizes the
 * migrated behaviour.
 *
 *   - IN  → ADJUSTMENT_IN  movement (onHand += qty)
 *   - OUT → ADJUSTMENT_OUT movement (onHand -= qty; below zero → aborts, INV-1)
 *   - `reservedQty` still only carried forward (P0-3 — Phase 07)
 *   - each submission mints a fresh idempotency key (no dedupe — Phase-00 parity)
 *   - the form `reference` is preserved on the ledger row (via ledgerExtra)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  notifyRoleUsers: vi.fn(),
  idCounter: 0,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts: any) => opts,
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('../../../firestore', () => ({
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  deleteDocById: vi.fn(),
  fmtDate: (v: unknown) => String(v ?? ''),
  resolveWriteGroupId: () => 'grp-1',
  resolveWriteCompanyId: () => 'comp-1',
  genId: { generic: (p = 'GEN') => `${p}-${++mocks.idCounter}` },
}));
vi.mock('../../../workflow', () => ({
  resolveWorkflowCompanyId: () => 'comp-1',
  stockSummaryId: (c: string, p: string, w: string) => `SUM-${c}-${p}-${w}`,
}));
vi.mock('../../../firebase', () => ({
  db: {},
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', PRODUCTS: 'products' },
  firebaseEnv: { isConfigured: false },
}));
vi.mock('../../../../store/useAppStore', () => {
  const useAppStore: any = (sel: (s: any) => unknown) => sel({ activeCompanyId: 'comp-1' });
  useAppStore.getState = () => ({ user: { id: 'user-1' }, activeCompanyId: 'comp-1' });
  return { useAppStore, useCurrentUser: () => ({ id: 'user-1' }) };
});
vi.mock('../../../queryKeys', () => ({
  queryKeys: { forCompany: () => ({ stock: ['stock'], stockLedger: ['stock_ledger'], productsRoot: ['p'], productsAll: ['pa'], categories: ['c'], warehouses: ['w'] }) },
}));
vi.mock('../../../../config/company', () => ({ UNITS: ['PCS', 'Nos'] }));
vi.mock('react-hot-toast', () => ({ default: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('../../../notifications', () => ({ notifyRoleUsers: mocks.notifyRoleUsers }));
vi.mock('../../../sanitizer', () => ({ sanitizeFirestoreData: (x: unknown) => x, sanitizePayload: (x: unknown) => x }));

import { useSaveStockEntry } from '../../../../features/inventory/hooks/useInventory';

type MutationLike = { mutationFn: (data: Record<string, unknown>) => Promise<void> };
const saveEntry = (): MutationLike => useSaveStockEntry(() => {}) as unknown as MutationLike;

const FORM = {
  productId: 'P-1', product: 'Panel', warehouseId: 'W-1', warehouse: 'Main',
  type: 'IN' as const, qty: '5', unit: 'PCS', reference: 'REF-1', notes: 'note',
  date: '2026-09-03',
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.idCounter = 0;
  vi.clearAllMocks();
});

function seed(availableQty: number, reservedQty = 0) {
  col('stock')['SUM-comp-1-P-1-W-1'] = {
    id: 'SUM-comp-1-P-1-W-1', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1',
    availableQty, reservedQty, createdAt: 'orig', isDeleted: false,
  };
}

describe('INVENTORY-05d — useInventory.useSaveStockEntry (manual stock adjust via the engine)', () => {
  it('IN: ADJUSTMENT_IN movement, onHand += qty; ledger + summary written', async () => {
    seed(10, 4);
    await saveEntry().mutationFn({ ...FORM, type: 'IN', qty: '5' });
    // INVENTORY-07: availableQty = onHandQty − reservedQty (15 − 4).
    expect(col('stock')['SUM-comp-1-P-1-W-1']).toMatchObject({ onHandQty: 15, availableQty: 11, reservedQty: 4 });
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({
      movementType: 'ADJUSTMENT_IN', direction: 'IN', type: 'IN', qty: 5,
      onHandBefore: 10, onHandAfter: 15, beforeQty: 10, afterQty: 15,
      reference: 'REF-1', reasonCode: 'REF-1', companyId: 'comp-1', createdBy: 'user-1',
    });
  });

  it('OUT: ADJUSTMENT_OUT movement, onHand -= qty', async () => {
    seed(10, 4);
    await saveEntry().mutationFn({ ...FORM, type: 'OUT', qty: '3' });
    // INVENTORY-07: availableQty = onHandQty − reservedQty (7 − 4).
    expect(col('stock')['SUM-comp-1-P-1-W-1']).toMatchObject({ onHandQty: 7, availableQty: 3, reservedQty: 4 });
    expect((Object.values(col('stock_ledger'))[0] as any).movementType).toBe('ADJUSTMENT_OUT');
  });

  it('OUT below zero throws "Insufficient stock" and nothing is written (INV-1)', async () => {
    seed(2);
    await expect(saveEntry().mutationFn({ ...FORM, type: 'OUT', qty: '99' })).rejects.toThrow(/Insufficient stock/);
    expect(col('stock_ledger')).toEqual({});
    expect(col('stock')['SUM-comp-1-P-1-W-1'].availableQty).toBe(2);   // unchanged
  });

  it('BASELINE (P0-3): reservedQty is carried forward unchanged', async () => {
    seed(10, 7);
    await saveEntry().mutationFn({ ...FORM, type: 'IN', qty: '1' });
    expect(col('stock')['SUM-comp-1-P-1-W-1']).toMatchObject({ onHandQty: 11, reservedQty: 7 });
  });

  it('validates inputs before touching the engine', async () => {
    const m = saveEntry();
    await expect(m.mutationFn({ ...FORM, productId: '' })).rejects.toThrow('Product is required');
    await expect(m.mutationFn({ ...FORM, warehouseId: '' })).rejects.toThrow('Warehouse is required');
    await expect(m.mutationFn({ ...FORM, qty: '0' })).rejects.toThrow('greater than zero');
    await expect(m.mutationFn({ ...FORM, qty: '-2' })).rejects.toThrow('greater than zero');
    expect(col('stock_ledger')).toEqual({});
  });

  it('writes the summary at the canonical stockSummaryId (no local copy)', async () => {
    await saveEntry().mutationFn({ ...FORM, productId: 'P/1', warehouseId: 'W 1' });
    // the shared stockSummaryId (mocked here as SUM-{c}-{p}-{w}) — NOT a local encodeURIComponent copy
    expect(col('stock')['SUM-comp-1-P/1-W 1']).toBeTruthy();
  });

  it('BASELINE: no idempotency — a fresh key per submission, two identical submissions → two ledger rows', async () => {
    seed(10);
    await saveEntry().mutationFn({ ...FORM, type: 'IN', qty: '2' });
    await saveEntry().mutationFn({ ...FORM, type: 'IN', qty: '2' });
    expect(Object.values(col('stock_ledger'))).toHaveLength(2);
    expect(col('stock')['SUM-comp-1-P-1-W-1'].onHandQty).toBe(14);
  });
});
