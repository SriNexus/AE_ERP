import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-10 (§10c) — Bulk stock import / bulk adjust, demo / non-configured
 * engine branch.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../../../../lib/firebase', () => ({
  db: {}, firebaseEnv: { isConfigured: false },
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', PRODUCTS: 'products', WAREHOUSES: 'warehouses' },
}));
vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p: string) => `${p}-${++mocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../../../lib/sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../../../lib/stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ user: { id: 'U-1', role: 'Warehouse' }, activeCompanyId: 'CO-1' }) } }));
vi.mock('../../../../lib/workflow', async () => {
  const actual = await vi.importActual<any>('../../../../lib/workflow');
  return { ...actual, logActivity: vi.fn(), notifyUsers: vi.fn(), usersByRole: vi.fn(async () => []), resolveWorkflowCompanyId: () => 'CO-1' };
});

import { applyStockMovement } from '../../../../lib/inventory/stockMovementEngine';
import { previewBulkAdjust, applyBulkAdjust, type BulkAdjustRow } from '../bulkStockImportWorkflow';

const summary = () => Object.values(col('stock'))[0] as any;

function row(overrides: Partial<BulkAdjustRow>): BulkAdjustRow {
  return { rowNumber: 1, productId: 'P-1', warehouseId: 'WH-1', qty: 5, unit: 'PCS', reasonCode: 'Cycle count', ...overrides };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
  col('products')['P-1'] = { id: 'P-1', companyId: 'CO-1', name: 'Panel', isDeleted: false };
  col('warehouses')['WH-1'] = { id: 'WH-1', companyId: 'CO-1', name: 'Main WH', isDeleted: false };
});

describe('INVENTORY-10 (§10c) — dry-run preview', () => {
  it('a preview WITHOUT any prior stock reports onHandBefore 0 and does not write anything', async () => {
    const report = await previewBulkAdjust([row({ rowNumber: 1, qty: 10 })], 'RUN-1');
    expect(report).toMatchObject({ importRunId: 'RUN-1', totalRows: 1, validRows: 1, invalidRows: 0 });
    expect(report.rows[0]).toMatchObject({ ok: true, alreadyApplied: false, onHandBefore: 0, onHandAfter: 10 });
    expect(Object.keys(col('stock'))).toHaveLength(0); // dry run — no write
  });

  it('two rows for the SAME product+warehouse preview cumulatively', async () => {
    await applyStockMovement({ movementType: 'OPENING_STOCK', productId: 'P-1', warehouseId: 'WH-1', qty: 20, unit: 'PCS', sourceType: 'opening', sourceId: 'S-1', companyId: 'CO-1' });
    const report = await previewBulkAdjust([
      row({ rowNumber: 1, qty: 5 }),
      row({ rowNumber: 2, qty: -8 }),
    ], 'RUN-2');
    expect(report.rows[0]).toMatchObject({ onHandBefore: 20, onHandAfter: 25 });
    expect(report.rows[1]).toMatchObject({ onHandBefore: 25, onHandAfter: 17 });
  });

  it('flags a row that would drive on-hand negative, without touching later independent rows', async () => {
    await applyStockMovement({ movementType: 'OPENING_STOCK', productId: 'P-1', warehouseId: 'WH-1', qty: 3, unit: 'PCS', sourceType: 'opening', sourceId: 'S-1', companyId: 'CO-1' });
    const report = await previewBulkAdjust([row({ rowNumber: 1, qty: -10 })], 'RUN-3');
    expect(report.rows[0]).toMatchObject({ ok: false, error: expect.stringMatching(/insufficient stock/i) });
    expect(report.invalidRows).toBe(1);
  });

  it('rejects a row missing a reason code', async () => {
    const report = await previewBulkAdjust([row({ rowNumber: 1, reasonCode: '' })], 'RUN-4');
    expect(report.rows[0]).toMatchObject({ ok: false, error: expect.stringMatching(/reason is required/i) });
  });

  it('rejects a row referencing an unknown / cross-company product', async () => {
    col('products')['P-2'] = { id: 'P-2', companyId: 'CO-OTHER', name: 'Foreign', isDeleted: false };
    const report = await previewBulkAdjust([row({ rowNumber: 1, productId: 'P-2' })], 'RUN-5');
    expect(report.rows[0]).toMatchObject({ ok: false, error: expect.stringMatching(/different company/i) });
  });

  it('a row already applied by a PRIOR attempt of the SAME run is flagged alreadyApplied and not double-counted', async () => {
    await applyBulkAdjust([row({ rowNumber: 1, qty: 10 })], 'RUN-6');
    expect(summary().onHandQty).toBe(10);
    const report = await previewBulkAdjust([row({ rowNumber: 1, qty: 10 })], 'RUN-6');
    expect(report.rows[0]).toMatchObject({ ok: true, alreadyApplied: true, onHandBefore: 10, onHandAfter: 10 });
  });
});

describe('INVENTORY-10 (§10c) — apply', () => {
  it('applies a batch of independent rows, one movement per row', async () => {
    const report = await applyBulkAdjust([
      row({ rowNumber: 1, productId: 'P-1', qty: 10 }),
      row({ rowNumber: 2, productId: 'P-1', qty: -3 }),
    ], 'RUN-10');
    expect(report).toMatchObject({ validRows: 2, invalidRows: 0 });
    expect(report.rows.every((r) => r.ok && r.applied)).toBe(true);
    expect(summary().onHandQty).toBe(7);
  });

  it('re-applying the SAME importRunId is idempotent — no double effect, rows report alreadyApplied', async () => {
    await applyBulkAdjust([row({ rowNumber: 1, qty: 10 })], 'RUN-11');
    expect(summary().onHandQty).toBe(10);
    const second = await applyBulkAdjust([row({ rowNumber: 1, qty: 10 })], 'RUN-11');
    expect(summary().onHandQty).toBe(10); // unchanged
    expect(second.rows[0]).toMatchObject({ ok: true, applied: false, alreadyApplied: true });
  });

  it('an invalid row is skipped and reported; valid rows in the same batch still apply', async () => {
    const report = await applyBulkAdjust([
      row({ rowNumber: 1, productId: 'P-1', qty: 10 }),
      row({ rowNumber: 2, productId: 'P-NOPE', qty: 5 }),
    ], 'RUN-12');
    expect(report.validRows).toBe(1);
    expect(report.invalidRows).toBe(1);
    expect(report.rows[1]).toMatchObject({ ok: false, error: expect.stringMatching(/does not exist/i) });
    expect(summary().onHandQty).toBe(10); // row 1 still applied
  });

  it('a row that would drive on-hand negative is rejected by the engine and reported, not silently clamped', async () => {
    await applyStockMovement({ movementType: 'OPENING_STOCK', productId: 'P-1', warehouseId: 'WH-1', qty: 2, unit: 'PCS', sourceType: 'opening', sourceId: 'S-1', companyId: 'CO-1' });
    const report = await applyBulkAdjust([row({ rowNumber: 1, qty: -5 })], 'RUN-13');
    expect(report.rows[0]).toMatchObject({ ok: false, error: expect.stringMatching(/insufficient stock/i) });
    expect(summary().onHandQty).toBe(2); // unchanged
  });
});
