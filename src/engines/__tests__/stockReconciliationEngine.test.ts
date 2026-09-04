import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * StockReconciliationEngine — INVENTORY-06 unit tests.
 *
 * Detection is exercised against an in-memory Firestore; the CORRECTION path
 * runs the REAL movement engine (demo branch) so RECONCILE_ADJUST is tested
 * end-to-end (audit fields, direction, idempotency, post-correction delta 0).
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({
  canDo: vi.fn(() => true),
  logActivity: vi.fn(),
  getState: vi.fn(() => ({ user: { id: 'U-1' }, activeCompanyId: 'CO-1' })),
  idCounter: 0,
}));

vi.mock('../../lib/firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', STOCK_RESERVATIONS: 'stock_reservations', AUDIT_LOGS: 'audit_logs' },
}));
vi.mock('../../lib/firestore', () => ({
  getAll: vi.fn(async (c: string, constraints: any[] = []) => {
    let rows = Object.values(col(c)).map((d) => ({ ...d }));
    for (const con of constraints) {
      if (con && con.__where) rows = rows.filter((r: any) => r[con.field] === con.value);
    }
    return rows;
  }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  resolveWriteGroupId: () => 'GRP-1',
  genId: { generic: (p = 'GEN') => `${p}-${++mocks.idCounter}` },
}));
vi.mock('../../lib/permissions', () => ({ canDo: mocks.canDo }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState } }));
vi.mock('../../lib/workflow', async () => {
  const actual = await vi.importActual<any>('../../lib/workflow');
  return {
    ...actual,
    logActivity: mocks.logActivity,
    notifyUsers: vi.fn(),
    usersByRole: vi.fn(async () => []),
    resolveWorkflowCompanyId: () => 'CO-1',
    stockSummaryId: (c: string, p: string, w: string) => `SUM-${c}-${p}-${w}`,
  };
});
vi.mock('../../lib/sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('firebase/firestore', () => ({
  where: (field: string, _op: string, value: unknown) => ({ __where: true, field, value }),
  serverTimestamp: () => '2026-09-04T00:00:00.000Z',
  doc: (_db: any, c: string, id: string) => ({ _col: c, _id: id }),
  runTransaction: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  collection: vi.fn(),
  query: vi.fn(),
}));

import {
  reconcileSummary, reconcileWarehouse, generateStockHealthReport,
  applyReconciliationCorrection, computeReconciliation, ledgerRowOnHandDelta,
} from '../StockReconciliationEngine';

const SUM = (p: string, w = 'WH-1') => `SUM-CO-1-${p}-${w}`;

function seedSummary(productId: string, onHandQty: number, opts: { warehouseId?: string; product?: string } = {}) {
  const wid = opts.warehouseId || 'WH-1';
  const id = `SUM-CO-1-${productId}-${wid}`;
  col('stock')[id] = {
    id, companyId: 'CO-1', productId, product: opts.product || productId, warehouseId: wid,
    warehouse: wid, unit: 'PCS', onHandQty, availableQty: onHandQty, reservedQty: 0, isDeleted: false,
  };
  return id;
}
let ledgerSeq = 0;
function seedLedger(productId: string, rows: Array<Partial<{ movementType: string; direction: string; type: string; qty: number; movementAt: string; isDeleted: boolean; auditReconciliation: boolean }>>, warehouseId = 'WH-1') {
  for (const r of rows) {
    const id = `LGR-${++ledgerSeq}`;
    col('stock_ledger')[id] = {
      id, companyId: 'CO-1', productId, warehouseId,
      movementAt: r.movementAt || `2026-08-0${(ledgerSeq % 9) + 1}T00:00:00.000Z`,
      isDeleted: false, ...r,
    };
  }
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.idCounter = 0; ledgerSeq = 0;
  vi.clearAllMocks();
  mocks.canDo.mockReturnValue(true);
});

describe('INVENTORY-06 — ledgerRowOnHandDelta (classification)', () => {
  it('classifies by direction, movementType, then legacy type; reservation rows are neutral', () => {
    expect(ledgerRowOnHandDelta({ direction: 'IN', qty: 5 })).toMatchObject({ delta: 5, classified: true });
    expect(ledgerRowOnHandDelta({ direction: 'OUT', qty: 4 })).toMatchObject({ delta: -4, classified: true });
    expect(ledgerRowOnHandDelta({ movementType: 'PURCHASE_RECEIPT', qty: 7 })).toMatchObject({ delta: 7, classified: true });
    expect(ledgerRowOnHandDelta({ movementType: 'DISPATCH_OUT', qty: 3 })).toMatchObject({ delta: -3, classified: true });
    expect(ledgerRowOnHandDelta({ type: 'IN', qty: 2 })).toMatchObject({ delta: 2, classified: true });
    expect(ledgerRowOnHandDelta({ type: 'OUT', qty: 2 })).toMatchObject({ delta: -2, classified: true });
    expect(ledgerRowOnHandDelta({ movementType: 'SALES_RESERVE', qty: 9 })).toMatchObject({ delta: 0, classified: true });
    expect(ledgerRowOnHandDelta({ direction: 'RELEASE', qty: 9 })).toMatchObject({ delta: 0, classified: true });
    // RECONCILE_ADJUST: sign from direction, NOT from qty (engine writes qty absolute)
    expect(ledgerRowOnHandDelta({ movementType: 'RECONCILE_ADJUST', direction: 'OUT', qty: 3 })).toMatchObject({ delta: -3, classified: true });
    // unclassifiable
    expect(ledgerRowOnHandDelta({ qty: 1 })).toMatchObject({ delta: 0, classified: false });
  });
});

describe('INVENTORY-07 — reservation reconciliation (additive)', () => {
  function seedReservation(productId: string, qtyReserved: number, opts: { qtyConsumed?: number; qtyReleased?: number; warehouseId?: string; id?: string } = {}) {
    const wid = opts.warehouseId || 'WH-1';
    const id = opts.id || `RSV-${productId}-${Math.random().toString(36).slice(2, 8)}`;
    col('stock_reservations')[id] = {
      id, companyId: 'CO-1', productId, warehouseId: wid, orderId: 'ORD-1', piId: 'PI-1',
      qtyRequested: qtyReserved, qtyReserved, qtyConsumed: opts.qtyConsumed || 0, qtyReleased: opts.qtyReleased || 0,
      status: 'active', isDeleted: false,
    };
  }

  it('reservedQty matches Σ active reservation remainders → reservedReconciled', async () => {
    const id = seedSummary('P-R', 10);
    col('stock')[id].reservedQty = 6;
    seedLedger('P-R', [{ movementType: 'OPENING_STOCK', direction: 'IN', qty: 10 }]);
    seedReservation('P-R', 4);
    seedReservation('P-R', 2);
    const r = await reconcileSummary(SUM('P-R'));
    expect(r).toMatchObject({ storedReserved: 6, expectedReserved: 6, reservedDelta: 0, reservedReconciled: true, reconciled: true });
  });

  it('reservedQty drifts from Σ remainders → reservedReconciled false, physical `reconciled` untouched', async () => {
    const id = seedSummary('P-R2', 10);
    col('stock')[id].reservedQty = 6;
    seedLedger('P-R2', [{ movementType: 'OPENING_STOCK', direction: 'IN', qty: 10 }]);
    seedReservation('P-R2', 3);   // remainder 3, but stored says 6
    const r = await reconcileSummary(SUM('P-R2'));
    expect(r.reservedReconciled).toBe(false);
    expect(r.reservedDelta).toBe(-3);
    expect(r.reconciled).toBe(true);   // physical on-hand still reconciles
  });

  it('a consumed reservation contributes 0 remainder', async () => {
    const id = seedSummary('P-R3', 10);
    col('stock')[id].reservedQty = 0;
    seedLedger('P-R3', [{ movementType: 'OPENING_STOCK', direction: 'IN', qty: 10 }]);
    seedReservation('P-R3', 5, { qtyConsumed: 5 });
    const r = await reconcileSummary(SUM('P-R3'));
    expect(r).toMatchObject({ storedReserved: 0, expectedReserved: 0, reservedReconciled: true });
  });

  it('generateStockHealthReport surfaces reservedMismatchCount', async () => {
    const id = seedSummary('P-R4', 8);
    col('stock')[id].reservedQty = 5;
    seedLedger('P-R4', [{ movementType: 'OPENING_STOCK', direction: 'IN', qty: 8 }]);
    seedReservation('P-R4', 1);
    const rep = await generateStockHealthReport();
    expect(rep.reservedMismatchCount).toBe(1);
    expect(rep.reservedMismatches[0].productId).toBe('P-R4');
  });
});

describe('INVENTORY-06 — detection', () => {
  it('1: a perfectly reconciled summary', async () => {
    seedSummary('P-1', 10);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 15 }, { movementType: 'DISPATCH_OUT', direction: 'OUT', qty: 5 }]);
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ stored: 10, computed: 10, delta: 0, reconciled: true, ledgerRowCount: 2, ledgerComplete: true });
  });

  it('2: positive mismatch (ledger says more than stored)', async () => {
    seedSummary('P-1', 10);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ stored: 10, computed: 13, delta: 3, reconciled: false });
  });

  it('3: negative mismatch (ledger says less than stored)', async () => {
    seedSummary('P-1', 13);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 10 }]);
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ stored: 13, computed: 10, delta: -3, reconciled: false });
  });

  it('4: zero quantity, no ledger — reconciled', async () => {
    seedSummary('P-1', 0);
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ stored: 0, computed: 0, delta: 0, reconciled: true, ledgerRowCount: 0 });
  });

  it('5 + 6: multiple ledger movements of multiple types; RECONCILE_ADJUST is excluded from computed', async () => {
    // operational total = 20 + 10 - 5 + 2 - 5 - 3 = 19; a prior +3 reconcile brought stored to 19.
    seedSummary('P-1', 19);
    seedLedger('P-1', [
      { movementType: 'OPENING_STOCK', direction: 'IN', qty: 20 },
      { movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 10 },
      { movementType: 'DISPATCH_OUT', direction: 'OUT', qty: 5 },
      { movementType: 'SALES_RETURN_IN', direction: 'IN', qty: 2 },
      { movementType: 'ADJUSTMENT_OUT', direction: 'OUT', qty: 5 },
      { movementType: 'DAMAGE_OUT', direction: 'OUT', qty: 3 },
      { movementType: 'RECONCILE_ADJUST', direction: 'IN', qty: 3, auditReconciliation: true },
    ]);
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ stored: 19, computed: 19, reconcileAdjustTotal: 3, reconciled: true });
  });

  it('7: legacy ledger rows (only `type`, `date`) still reconcile', async () => {
    seedSummary('P-1', 8);
    col('stock_ledger')['LGR-legacy-1'] = { id: 'LGR-legacy-1', companyId: 'CO-1', productId: 'P-1', warehouseId: 'WH-1', type: 'IN', qty: 12, date: '2025-01-01T00:00:00Z', isDeleted: false };
    col('stock_ledger')['LGR-legacy-2'] = { id: 'LGR-legacy-2', companyId: 'CO-1', productId: 'P-1', warehouseId: 'WH-1', type: 'OUT', qty: 4, date: '2025-02-01T00:00:00Z', isDeleted: false };
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ stored: 8, computed: 8, reconciled: true, ledgerComplete: true });
    expect(r.firstMovementAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('8: reservation movements are ignored for physical on-hand', async () => {
    seedSummary('P-1', 10);
    seedLedger('P-1', [
      { movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 10 },
      { movementType: 'SALES_RESERVE', direction: 'RESERVE', qty: 6 },
      { movementType: 'SALES_RELEASE', direction: 'RELEASE', qty: 2 },
    ]);
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ computed: 10, reconciled: true });
  });

  it('9: an unclassifiable ledger row is counted and flagged — computed unreliable', async () => {
    seedSummary('P-1', 5);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 5 }, { qty: 99 } as any]);
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ computed: 5, reconciled: true, unclassifiedRowCount: 1, ledgerComplete: false });
  });

  it('9b: a summary with NO ledger but non-zero stored is a likely opening balance (ledgerComplete false)', async () => {
    seedSummary('P-1', 40);
    const r = await reconcileSummary(SUM('P-1'));
    expect(r).toMatchObject({ stored: 40, computed: 0, delta: -40, reconciled: false, ledgerComplete: false });
    expect(r.note).toMatch(/opening balance/i);
  });

  it('10 + 11: reconcileWarehouse scopes to one warehouse and groups ledger by product', async () => {
    seedSummary('P-1', 10, { warehouseId: 'WH-1' });
    seedSummary('P-2', 7, { warehouseId: 'WH-1' });
    seedSummary('P-1', 3, { warehouseId: 'WH-2' });   // different warehouse — must not leak in
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 10 }], 'WH-1');
    seedLedger('P-2', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 9 }], 'WH-1');
    const r = await reconcileWarehouse('WH-1');
    expect(r.totalSummaries).toBe(2);
    expect(r.results.map((x) => x.summaryId).sort()).toEqual([SUM('P-1'), SUM('P-2')]);
    expect(r.reconciledCount).toBe(1);            // P-1 reconciles (10==10), P-2 does not (7 vs 9)
    expect(r.mismatchCount).toBe(1);
    expect(r.totalAbsoluteDrift).toBe(2);
  });

  it('generateStockHealthReport separates likely-opening-balance from real drift', async () => {
    seedSummary('P-1', 10); seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 10 }]); // reconciled
    seedSummary('P-2', 5);  seedLedger('P-2', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 8 }]);  // real drift (all classified)
    seedSummary('P-3', 30);                                                                                      // no ledger -> opening balance
    const rep = await generateStockHealthReport();
    expect(rep).toMatchObject({ totalSummariesChecked: 3, reconciledCount: 1, mismatchCount: 2, realDriftCount: 1, likelyOpeningBalanceCount: 1 });
  });
});

describe('INVENTORY-06 — correction (RECONCILE_ADJUST via the movement engine)', () => {
  it('12: positive correction — RECONCILE_ADJUST +delta, post-correction delta 0', async () => {
    seedSummary('P-1', 10);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    const runId = 'RUN-A';
    const res = await applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: 'physical count', reconciliationRunId: runId });
    expect(res).toMatchObject({ applied: true, correctionQty: 3, storedBefore: 10, targetOnHand: 13 });
    const row = Object.values(col('stock_ledger')).find((r: any) => r.movementType === 'RECONCILE_ADJUST') as any;
    expect(row).toMatchObject({ movementType: 'RECONCILE_ADJUST', direction: 'IN', qty: 3, reasonCode: 'physical count', auditReconciliation: true, reconciliationRunId: runId, approvedBy: 'U-1', reconciledFromOnHand: 10, reconciledToOnHand: 13 });
    // 16: post-correction reconciliation is CLEAN (RECONCILE_ADJUST excluded from computed;
    //     the correction row is still in the ledger — audit trail intact).
    const after = await reconcileSummary(SUM('P-1'));
    expect(after).toMatchObject({ stored: 13, computed: 13, reconcileAdjustTotal: 3, delta: 0, reconciled: true });
  });

  it('13: negative correction — RECONCILE_ADJUST OUT, sign not reversed', async () => {
    seedSummary('P-1', 13);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 10 }]);
    const res = await applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: 'count', reconciliationRunId: 'RUN-B' });
    expect(res.correctionQty).toBe(-3);
    const row = Object.values(col('stock_ledger')).find((r: any) => r.movementType === 'RECONCILE_ADJUST') as any;
    expect(row).toMatchObject({ direction: 'OUT', qty: 3 });
    expect(col('stock')[SUM('P-1')].onHandQty).toBe(10);   // 13 - 3
  });

  it('14 + 15: idempotent per (runId x summary) — a retry does not double-correct', async () => {
    seedSummary('P-1', 10);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 15 }]);
    const runId = 'RUN-C';
    const first = await applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: 'x', reconciliationRunId: runId });
    expect(first.applied).toBe(true);
    expect(col('stock')[SUM('P-1')].onHandQty).toBe(15);
    // retry with the SAME runId
    const second = await applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: 'x', reconciliationRunId: runId });
    expect(second.applied).toBe(false);
    expect(Object.values(col('stock_ledger')).filter((r: any) => r.movementType === 'RECONCILE_ADJUST')).toHaveLength(1);
    expect(col('stock')[SUM('P-1')].onHandQty).toBe(15);   // NOT 20
  });

  it('an already-reconciled summary needs no correction', async () => {
    seedSummary('P-1', 10);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 10 }]);
    const res = await applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: 'x', reconciliationRunId: 'RUN-D' });
    expect(res).toMatchObject({ applied: false, alreadyReconciled: true, correctionQty: 0 });
    expect(Object.values(col('stock_ledger')).filter((r: any) => r.movementType === 'RECONCILE_ADJUST')).toHaveLength(0);
  });

  it('17: correction requires canDo(edit, stock)', async () => {
    seedSummary('P-1', 10);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    mocks.canDo.mockReturnValue(false);
    await expect(applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: 'x', reconciliationRunId: 'RUN-E' }))
      .rejects.toThrow(/permission/i);
    expect(Object.values(col('stock_ledger')).filter((r: any) => r.movementType === 'RECONCILE_ADJUST')).toHaveLength(0);
  });

  it('correction requires a reason and a run id', async () => {
    seedSummary('P-1', 10); seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    await expect(applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: '', reconciliationRunId: 'R' })).rejects.toThrow(/reason/i);
    await expect(applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: 'x', reconciliationRunId: '' })).rejects.toThrow(/reconciliationRunId/i);
  });

  it('a caller-supplied targetOnHand (physical count) overrides the ledger-computed value', async () => {
    seedSummary('P-1', 10);
    seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]); // computed 13
    const res = await applyReconciliationCorrection({ summaryId: SUM('P-1'), targetOnHand: 12, reasonCode: 'counted 12 on the shelf', reconciliationRunId: 'RUN-F' });
    expect(res).toMatchObject({ correctionQty: 2, targetOnHand: 12 });
    expect(col('stock')[SUM('P-1')].onHandQty).toBe(12);
  });

  it('18: correction is audit-logged', async () => {
    seedSummary('P-1', 10); seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    await applyReconciliationCorrection({ summaryId: SUM('P-1'), reasonCode: 'x', reconciliationRunId: 'RUN-G' });
    expect(mocks.logActivity).toHaveBeenCalledWith('Stock', 'Reconciliation Correction', SUM('P-1'), expect.objectContaining({ reconciliationRunId: 'RUN-G', correctionQty: 3 }));
  });
});

describe('INVENTORY-06 — F4: reconciliation is read-only', () => {
  it('20: reconcileSummary / reconcileWarehouse / generateStockHealthReport write NOTHING', async () => {
    const fs = await import('../../lib/firestore');
    seedSummary('P-1', 10); seedLedger('P-1', [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    seedSummary('P-2', 5, { warehouseId: 'WH-1' });

    await reconcileSummary(SUM('P-1'));
    await reconcileWarehouse('WH-1');
    await generateStockHealthReport();
    computeReconciliation({ summaryId: 'x', companyId: 'CO-1', productId: 'P-1', warehouseId: 'WH-1', storedOnHand: 5, ledgerRows: [] });

    expect(fs.createDocWithId).not.toHaveBeenCalled();
    expect(fs.updateDocById).not.toHaveBeenCalled();
  });
});
