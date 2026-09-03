/**
 * invariants.baseline.test.ts — INVENTORY-00 (Baseline & Safety Lock)
 * ==================================================================
 *
 * Two jobs:
 *   1. Prove each INVENTORY_INVARIANTS predicate behaves correctly (positive +
 *      negative crafted inputs).
 *   2. Run the full predicate set over data shaped like TODAY's system
 *      (production `stock`/`stock_ledger` schema A/B, and the demo-seed shape)
 *      and RECORD which invariants currently hold and which do not — the
 *      Phase-00 baseline. Assertions capture current reality, not an ideal.
 *
 * NO production code is touched. The invariants module has no callers.
 */
import { describe, expect, it } from 'vitest';
import {
  checkInv1_onHandNonNegative,
  checkInv2_reservedNonNegative,
  checkInv3_reservedWithinOnHand,
  checkInv4_availableDerivation,
  checkInv5_ledgerReconciles,
  checkInv7_movementMatchesLedgerDelta,
  checkInv8_idempotencyKeyUnique,
  checkInv10_warehouseBelongsToCompany,
  checkInv11_transferPairBalances,
  checkInv12_orderLineFrozenAfterDispatch,
  checkInv13_purchaseOrderNotOverReceived,
  classifyLedgerRow,
  evaluateInventoryInvariants,
  RULES_AND_DESIGN_INVARIANTS,
  type StockLedgerRowLike,
  type StockSummaryLike,
} from '../../INVENTORY_INVARIANTS';

// ─────────────────────────────────────────────────────────────────────────────
// 1. PREDICATE UNIT COVERAGE
// ─────────────────────────────────────────────────────────────────────────────

describe('INVENTORY_INVARIANTS — predicate behavior', () => {
  it('INV-1: onHand >= 0', () => {
    expect(checkInv1_onHandNonNegative({ id: 'A', availableQty: 5 }).holds).toBe(true);
    expect(checkInv1_onHandNonNegative({ id: 'A', availableQty: 0 }).holds).toBe(true);
    expect(checkInv1_onHandNonNegative({ id: 'A', availableQty: -1 }).holds).toBe(false);
    expect(checkInv1_onHandNonNegative({ id: 'A', onHandQty: -3, availableQty: 10 }).holds).toBe(false);
  });

  it('INV-2: reserved >= 0', () => {
    expect(checkInv2_reservedNonNegative({ id: 'A', reservedQty: 0 }).holds).toBe(true);
    expect(checkInv2_reservedNonNegative({ id: 'A', reservedQty: -2 }).holds).toBe(false);
  });

  it('INV-3: reserved <= onHand', () => {
    expect(checkInv3_reservedWithinOnHand({ id: 'A', onHandQty: 10, reservedQty: 4 }).holds).toBe(true);
    expect(checkInv3_reservedWithinOnHand({ id: 'A', onHandQty: 10, reservedQty: 11 }).holds).toBe(false);
    // Current production reality: reservedQty is 0 everywhere -> always holds.
    expect(checkInv3_reservedWithinOnHand({ id: 'A', availableQty: 3 }).holds).toBe(true);
  });

  it('INV-4: available == onHand - reserved', () => {
    // Demo shape: onHandQty = available + reserved -> derivation holds.
    expect(
      checkInv4_availableDerivation({ id: 'A', availableQty: 90, reservedQty: 22, onHandQty: 112 }).holds,
    ).toBe(true);
    // Production shape today: no onHandQty, reserved 0 -> available == available - 0.
    expect(checkInv4_availableDerivation({ id: 'A', availableQty: 90, reservedQty: 0 }).holds).toBe(true);
    // Broken: onHand present but not equal to available + reserved.
    expect(
      checkInv4_availableDerivation({ id: 'A', availableQty: 90, reservedQty: 22, onHandQty: 100 }).holds,
    ).toBe(false);
  });

  it('classifyLedgerRow handles production schema A/B and demo shape', () => {
    expect(classifyLedgerRow({ type: 'IN' })).toBe('IN');
    expect(classifyLedgerRow({ type: 'OUT', referenceType: 'Dispatch' })).toBe('OUT');
    expect(classifyLedgerRow({ movementType: 'Opening', direction: 'IN' })).toBe('IN'); // demo seed
    expect(classifyLedgerRow({ movementType: 'PURCHASE_RECEIPT' })).toBe('IN'); // future engine
    expect(classifyLedgerRow({ movementType: 'DISPATCH_OUT' })).toBe('OUT');
    expect(classifyLedgerRow({ movementType: 'SALES_RESERVE' })).toBe('RESERVE');
    expect(classifyLedgerRow({ type: 'WEIRD' })).toBe('UNKNOWN');
  });

  it('INV-5: onHand == opening + Σ IN - Σ OUT', () => {
    const summary: StockSummaryLike = { id: 'S', companyId: 'C', productId: 'P', warehouseId: 'W', availableQty: 12 };
    const rows: StockLedgerRowLike[] = [
      { type: 'IN', qty: 20, companyId: 'C', productId: 'P', warehouseId: 'W' },
      { type: 'OUT', qty: 8, companyId: 'C', productId: 'P', warehouseId: 'W' },
    ];
    expect(checkInv5_ledgerReconciles(summary, rows).holds).toBe(true);
    // Mismatch:
    expect(checkInv5_ledgerReconciles({ ...summary, availableQty: 99 }, rows).holds).toBe(false);
    // Unknown row -> does not hold.
    expect(
      checkInv5_ledgerReconciles(summary, [...rows, { type: 'MYSTERY', qty: 1 }]).holds,
    ).toBe(false);
  });

  it('INV-7: ledger delta matches signed qty', () => {
    expect(checkInv7_movementMatchesLedgerDelta({ id: 'L', type: 'IN', qty: 7, beforeQty: 5, afterQty: 12 }).holds).toBe(true);
    expect(checkInv7_movementMatchesLedgerDelta({ id: 'L', type: 'OUT', qty: 3, beforeQty: 12, afterQty: 9 }).holds).toBe(true);
    expect(checkInv7_movementMatchesLedgerDelta({ id: 'L', type: 'OUT', qty: 3, beforeQty: 12, afterQty: 12 }).holds).toBe(false);
    // Demo-shape row without before/after -> cannot verify -> does not hold.
    expect(checkInv7_movementMatchesLedgerDelta({ id: 'L', movementType: 'Opening', direction: 'IN', qty: 10 }).holds).toBe(false);
  });

  it('INV-8: idempotencyKey uniqueness (vacuous today)', () => {
    expect(checkInv8_idempotencyKeyUnique([{ id: 'a' }, { id: 'b' }]).holds).toBe(true); // no keys yet
    expect(
      checkInv8_idempotencyKeyUnique([
        { id: 'a', idempotencyKey: 'K1' },
        { id: 'b', idempotencyKey: 'K1' },
      ]).holds,
    ).toBe(false);
  });

  it('INV-10: warehouse belongs to the summary company', () => {
    expect(
      checkInv10_warehouseBelongsToCompany({ id: 'S', companyId: 'C', warehouseId: 'W' }, { id: 'W', companyId: 'C' }).holds,
    ).toBe(true);
    expect(
      checkInv10_warehouseBelongsToCompany({ id: 'S', companyId: 'C', warehouseId: 'W' }, { id: 'W', companyId: 'OTHER' }).holds,
    ).toBe(false);
    expect(
      checkInv10_warehouseBelongsToCompany({ id: 'S', companyId: 'C', warehouseId: 'W' }, null).holds,
    ).toBe(false);
    expect(
      checkInv10_warehouseBelongsToCompany({ id: 'S', companyId: 'C', warehouseId: 'W' }, { id: 'W', companyId: 'C', isDeleted: true }).holds,
    ).toBe(false);
  });

  it('INV-11: transfer pair balances to zero', () => {
    const rows: StockLedgerRowLike[] = [
      { id: 'o', type: 'OUT', qty: 5, sourceId: 'TRF-1' },
      { id: 'i', type: 'IN', qty: 5, sourceId: 'TRF-1' },
    ];
    expect(checkInv11_transferPairBalances('TRF-1', rows).holds).toBe(true);
    expect(checkInv11_transferPairBalances('TRF-1', [rows[0]]).holds).toBe(false); // only one leg
  });

  it('INV-12: order lines frozen after dispatch', () => {
    const before = { id: 'O', status: 'Partial Dispatch', items: [{ productId: 'P', qty: 10, dispatchedQty: 4 }] };
    const same = { ...before, items: [{ productId: 'P', qty: 10, dispatchedQty: 4 }] };
    const changed = { ...before, items: [{ productId: 'P', qty: 99, dispatchedQty: 4 }] };
    expect(checkInv12_orderLineFrozenAfterDispatch(before, same).holds).toBe(true);
    expect(checkInv12_orderLineFrozenAfterDispatch(before, changed).holds).toBe(false);
    // Not locked yet -> any edit permitted.
    const draft = { id: 'O', status: 'Pending', items: [{ productId: 'P', qty: 10, dispatchedQty: 0 }] };
    expect(checkInv12_orderLineFrozenAfterDispatch(draft, changed).holds).toBe(true);
  });

  it('INV-13: PO not over-received', () => {
    expect(checkInv13_purchaseOrderNotOverReceived({ id: 'PO', items: [{ productId: 'P', qty: 10, receivedQty: 10 }] }).holds).toBe(true);
    expect(checkInv13_purchaseOrderNotOverReceived({ id: 'PO', items: [{ productId: 'P', qty: 10, receivedQty: 11 }] }).holds).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. BASELINE: which invariants hold against TODAY's data shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Production `stock` summary shape as written by stockWorkflow.stockIn / useSaveStockEntry. */
const PROD_SUMMARY: StockSummaryLike = {
  id: 'SUM-COMP1-PRD1-WH1',
  companyId: 'COMP1',
  groupId: 'GRP1',
  productId: 'PRD1',
  warehouseId: 'WH1',
  availableQty: 12,
  reservedQty: 0, // BASELINE: production reservedQty is always 0 — nothing writes it (audit P0-3)
  unit: 'PCS',
  isDeleted: false,
};

/** Production `stock_ledger` schema A (stockIn / useSaveStockEntry) + schema B (dispatch OUT). */
const PROD_LEDGER: StockLedgerRowLike[] = [
  { id: 'STK-1', companyId: 'COMP1', productId: 'PRD1', warehouseId: 'WH1', type: 'IN', qty: 20, beforeQty: 0, afterQty: 20, sourceType: 'purchase', sourceId: 'purchase_order:PO1:goods_receipt:GRN1:line:0' },
  { id: 'STK-2', companyId: 'COMP1', productId: 'PRD1', warehouseId: 'WH1', type: 'OUT', qty: 8, beforeQty: 20, afterQty: 12, referenceType: 'Dispatch', referenceId: 'DSP1' },
];

/** Demo seed shape (scripts/demo/datasets/businessGraph.ts). */
const DEMO_SUMMARY: StockSummaryLike = {
  id: 'DEMO-V1-STK-1',
  companyId: 'DEMO-COMP',
  productId: 'DEMO-PANEL',
  warehouseId: 'DEMO-WH-1',
  availableQty: 90,
  reservedQty: 22, // demo: 25% of available for the first 8 items
  onHandQty: 112, // demo: available + reserved
};
const DEMO_LEDGER: StockLedgerRowLike[] = [
  { id: 'DEMO-V1-LED-1', companyId: 'DEMO-COMP', productId: 'DEMO-PANEL', warehouseId: 'DEMO-WH-1', movementType: 'Opening', direction: 'IN', qty: 112, referenceType: 'DemoOpening', referenceId: 'DEMO-SEED' },
];

describe('INVENTORY-00 BASELINE — invariant status against current data shapes', () => {
  it('records the production-shape baseline (defects included)', () => {
    const results = evaluateInventoryInvariants({
      summaries: [PROD_SUMMARY],
      ledgerRows: PROD_LEDGER,
      warehousesById: { WH1: { id: 'WH1', companyId: 'COMP1' } },
      purchaseOrders: [{ id: 'PO1', items: [{ productId: 'PRD1', qty: 20, receivedQty: 20 }] }],
    });
    const byInv = Object.fromEntries(results.map((r) => [r.invariant + ':' + r.detail.slice(0, 30), r.holds]));
    // eslint-disable-next-line no-console
    console.log('[INVENTORY-00 BASELINE — production shape]', JSON.stringify(results, null, 1));

    const held = (inv: string) => results.filter((r) => r.invariant === inv).every((r) => r.holds);

    // Currently HOLD for well-formed production data:
    expect(held('INV-1')).toBe(true); // onHand >= 0
    expect(held('INV-2')).toBe(true); // reserved >= 0
    expect(held('INV-3')).toBe(true); // reserved(0) <= onHand
    expect(held('INV-4')).toBe(true); // available == available - 0  (trivial today)
    expect(held('INV-5')).toBe(true); // 20 IN - 8 OUT == 12 on-hand (this sample is internally consistent)
    expect(held('INV-7')).toBe(true); // schema A/B rows carry before/after
    expect(held('INV-8')).toBe(true); // no idempotencyKeys yet -> vacuous
    expect(held('INV-10')).toBe(true); // warehouse FK ok
    expect(held('INV-13')).toBe(true); // PO not over-received

    void byInv;
  });

  it('records the demo-seed-shape baseline', () => {
    const results = evaluateInventoryInvariants({
      summaries: [DEMO_SUMMARY],
      ledgerRows: DEMO_LEDGER,
    });
    // eslint-disable-next-line no-console
    console.log('[INVENTORY-00 BASELINE — demo seed shape]', JSON.stringify(results, null, 1));
    const held = (inv: string) => results.filter((r) => r.invariant === inv).every((r) => r.holds);

    expect(held('INV-1')).toBe(true);
    expect(held('INV-2')).toBe(true);
    expect(held('INV-3')).toBe(true); // reserved 22 <= onHand 112
    expect(held('INV-4')).toBe(true); // available 90 == onHand 112 - reserved 22
    expect(held('INV-5')).toBe(true); // single Opening IN row of 112 == onHand 112 (classified via `direction:'IN'`)

    // BASELINE DEFECT: demo ledger rows carry NO beforeQty/afterQty, so the
    // movement:ledger 1:1 magnitude check (INV-7) cannot be verified.
    // Do NOT fix in INVENTORY-00 — the unified ledger schema arrives in Plan Phase 05a.
    expect(held('INV-7')).toBe(false);
  });

  it('production `stock` summary has NO onHandQty field today (Plan Phase 05a introduces it)', () => {
    // BASELINE: onHandQty is absent -> resolveOnHand falls back to availableQty.
    expect(PROD_SUMMARY.onHandQty).toBeUndefined();
  });

  it('production stock_ledger rows carry NO idempotencyKey today (Plan Phase 05 introduces it)', () => {
    // BASELINE: idempotency is absent — retry/double-submit duplicates movements (audit P1-1).
    expect(PROD_LEDGER.every((r) => r.idempotencyKey === undefined)).toBe(true);
  });

  it('rules/design invariants are documented, not runtime-checked here', () => {
    expect(Object.keys(RULES_AND_DESIGN_INVARIANTS).sort()).toEqual(['INV-14', 'INV-15', 'INV-6', 'INV-9']);
  });
});
