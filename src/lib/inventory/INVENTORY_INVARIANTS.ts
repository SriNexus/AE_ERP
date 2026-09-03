/**
 * INVENTORY_INVARIANTS.ts — INVENTORY-00 (Baseline & Safety Lock)
 * ===============================================================
 *
 * Pure predicate functions for the inventory invariants defined in
 * INVENTORY_IMPLEMENTATION_PLAN.md §5.
 *
 * SCOPE (INVENTORY-00): these are BASELINE PREDICATES ONLY.
 *   - NOT wired into any production workflow, hook, service, rule, or engine.
 *   - NO Firestore reads or writes.
 *   - NO behavior change anywhere.
 *   - NO movement engine, NO reconciliation, NO reservation activation.
 *   - `onHandQty` / `reservedQty` are READ from a doc if present; this file
 *     does NOT introduce or populate them.
 *
 * Purpose: give every later remediation phase (INVENTORY-01 … 11) a fixed,
 * executable definition of "correct" to check against, and let the Phase-00
 * baseline test record which invariants hold against the current data model
 * and which do NOT (the audit findings).
 *
 * Each predicate returns an `InvariantResult` — never throws.
 */

// ── Types (local; deliberately not imported from production types) ──────────

/** Minimal shape of a `stock` summary document as it exists today. */
export interface StockSummaryLike {
  id?: string;
  companyId?: string;
  groupId?: string;
  productId?: string;
  warehouseId?: string;
  /**
   * TODAY this field holds the physical on-hand count (it is misnamed — see
   * the audit / Plan §4.2). Phase 07 introduces a separate `onHandQty` and
   * redefines `availableQty` as `onHandQty - reservedQty`.
   */
  availableQty?: number;
  /** Additive field introduced in Plan Phase 05a. Absent on current docs. */
  onHandQty?: number;
  /** Present on current docs but written by ZERO production paths (dead — audit P0-3). */
  reservedQty?: number;
  reserved?: number;
  available?: number;
  unit?: string;
  isDeleted?: boolean;
}

/** Minimal shape of a `stock_ledger` document (both current schemas — A and B). */
export interface StockLedgerRowLike {
  id?: string;
  companyId?: string;
  productId?: string;
  warehouseId?: string;
  /** Schema A + B: 'IN' | 'OUT'. Plan adds 'RESERVE' | 'RELEASE'. */
  type?: string;
  /** Plan Phase 05 field. Absent on current rows. */
  movementType?: string;
  /** Plan Phase 05 field. Absent on current rows. */
  direction?: string;
  qty?: number;
  beforeQty?: number;
  afterQty?: number;
  /** Plan Phase 05 idempotency field. Absent on current rows. */
  idempotencyKey?: string;
  /** Schema A. */
  sourceType?: string;
  sourceId?: string;
  /** Schema B (dispatch OUT). */
  referenceType?: string;
  referenceId?: string;
  isDeleted?: boolean;
}

export interface WarehouseLike {
  id?: string;
  companyId?: string;
  isDeleted?: boolean;
}

export interface OrderLineLike {
  productId?: string;
  qty?: number;
  dispatchedQty?: number;
  pendingQty?: number;
}

export interface OrderLike {
  id?: string;
  status?: string;
  items?: OrderLineLike[];
}

export interface PurchaseOrderLineLike {
  productId?: string;
  qty?: number;
  receivedQty?: number;
}

export interface PurchaseOrderLike {
  id?: string;
  items?: PurchaseOrderLineLike[];
}

export interface InvariantResult {
  /** Stable id, e.g. 'INV-1'. */
  invariant: string;
  /** true = the invariant holds for the given input. */
  holds: boolean;
  /** Human-readable explanation (always populated). */
  detail: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Physical on-hand for a summary: `onHandQty` if present (Phase 05+), else `availableQty` (today's semantics). */
export function resolveOnHand(s: StockSummaryLike): number {
  if (s.onHandQty !== undefined && s.onHandQty !== null) return num(s.onHandQty);
  return num(s.availableQty ?? s.available);
}

export function resolveReserved(s: StockSummaryLike): number {
  return num(s.reservedQty ?? s.reserved);
}

export function resolveAvailable(s: StockSummaryLike): number {
  return num(s.availableQty ?? s.available);
}

const IN_TYPES = new Set([
  'IN',
  'PURCHASE_RECEIPT',
  'OPENING_STOCK',
  'ADJUSTMENT_IN',
  'SALES_RETURN_IN',
  'TRANSFER_IN',
]);
const OUT_TYPES = new Set([
  'OUT',
  'DISPATCH_OUT',
  'ADJUSTMENT_OUT',
  'DAMAGE_OUT',
  'TRANSFER_OUT',
]);

/**
 * Classify a ledger row as IN / OUT / RESERVE / RELEASE / RECONCILE / UNKNOWN.
 *
 * Handles all THREE current shapes: production schema A (`type: 'IN'|'OUT'`),
 * production schema B (dispatch OUT, also `type`), and the demo seed shape
 * (`movementType: 'Opening'` + `direction: 'IN'`). Each candidate field is
 * tried in turn; the first that yields a decisive classification wins.
 */
export function classifyLedgerRow(row: StockLedgerRowLike): 'IN' | 'OUT' | 'RESERVE' | 'RELEASE' | 'RECONCILE' | 'UNKNOWN' {
  const candidates = [row.movementType, row.direction, row.type]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.toUpperCase());
  for (const key of candidates) {
    if (key === 'RESERVE' || key === 'SALES_RESERVE') return 'RESERVE';
    if (key === 'RELEASE' || key === 'SALES_RELEASE') return 'RELEASE';
    if (key === 'RECONCILE_ADJUST') return 'RECONCILE';
    if (IN_TYPES.has(key)) return 'IN';
    if (OUT_TYPES.has(key)) return 'OUT';
  }
  return 'UNKNOWN';
}

// ── Invariant predicates (Plan §5) ─────────────────────────────────────────

/** INV-1: on-hand may never be negative (Neozy prohibits negative stock). */
export function checkInv1_onHandNonNegative(s: StockSummaryLike): InvariantResult {
  const onHand = resolveOnHand(s);
  return {
    invariant: 'INV-1',
    holds: onHand >= 0,
    detail: `onHand(${onHand}) >= 0 for stock/${s.id ?? '?'}`,
  };
}

/** INV-2: reserved may never be negative. */
export function checkInv2_reservedNonNegative(s: StockSummaryLike): InvariantResult {
  const reserved = resolveReserved(s);
  return {
    invariant: 'INV-2',
    holds: reserved >= 0,
    detail: `reserved(${reserved}) >= 0 for stock/${s.id ?? '?'}`,
  };
}

/**
 * INV-3: cannot reserve more than physically held (default policy — no backorder).
 * NOTE: `reservedQty` is dead in the current system, so this trivially holds today
 * (reserved is always 0). It becomes meaningful in Plan Phase 07.
 */
export function checkInv3_reservedWithinOnHand(s: StockSummaryLike): InvariantResult {
  const onHand = resolveOnHand(s);
  const reserved = resolveReserved(s);
  return {
    invariant: 'INV-3',
    holds: reserved <= onHand,
    detail: `reserved(${reserved}) <= onHand(${onHand}) for stock/${s.id ?? '?'}`,
  };
}

/**
 * INV-4: availableQty == onHandQty - reservedQty.
 *
 * TODAY: `availableQty` IS the on-hand count and `reservedQty` is 0, so this
 * holds trivially (available == onHand - 0). Plan Phases 05a–06 keep
 * `availableQty == onHandQty`. Phase 07 makes the subtraction real.
 */
export function checkInv4_availableDerivation(s: StockSummaryLike): InvariantResult {
  const onHand = resolveOnHand(s);
  const reserved = resolveReserved(s);
  const available = resolveAvailable(s);
  const expected = onHand - reserved;
  return {
    invariant: 'INV-4',
    holds: available === expected,
    detail: `available(${available}) == onHand(${onHand}) - reserved(${reserved}) = ${expected} for stock/${s.id ?? '?'}`,
  };
}

/**
 * INV-5: onHandQty == Σ(ledger IN qty) − Σ(ledger OUT qty) for one (company, product, warehouse).
 *
 * `ledgerRows` MUST be the complete, ordered set of ledger rows for the same
 * (companyId, productId, warehouseId) as `summary`. RESERVE / RELEASE rows do
 * NOT move on-hand and are ignored. RECONCILE rows count by their signed qty.
 *
 * Optional `openingQty` for a tenant/product that had a non-zero opening
 * balance not represented as an OPENING_STOCK ledger row (legacy data).
 */
export function checkInv5_ledgerReconciles(
  summary: StockSummaryLike,
  ledgerRows: StockLedgerRowLike[],
  openingQty = 0,
): InvariantResult {
  let inSum = 0;
  let outSum = 0;
  let reconcileSum = 0;
  let unknown = 0;
  for (const row of ledgerRows) {
    if (row.isDeleted === true) continue;
    const cls = classifyLedgerRow(row);
    const qty = num(row.qty);
    if (cls === 'IN') inSum += qty;
    else if (cls === 'OUT') outSum += qty;
    else if (cls === 'RECONCILE') reconcileSum += qty; // signed
    else if (cls === 'RESERVE' || cls === 'RELEASE') { /* no on-hand effect */ }
    else unknown += 1;
  }
  const computed = openingQty + inSum - outSum + reconcileSum;
  const onHand = resolveOnHand(summary);
  return {
    invariant: 'INV-5',
    holds: unknown === 0 && computed === onHand,
    detail:
      `computed(opening ${openingQty} + IN ${inSum} - OUT ${outSum} + reconcile ${reconcileSum} = ${computed}) ` +
      `== onHand(${onHand}) for stock/${summary.id ?? '?'}` +
      (unknown > 0 ? ` — ${unknown} unclassifiable ledger row(s)` : ''),
  };
}

/**
 * INV-7: every physical movement has exactly one ledger row of equal magnitude.
 *
 * Checked structurally: each row that moves on-hand (IN/OUT/RECONCILE) must
 * have `afterQty - beforeQty` (signed) equal to its signed `qty`.
 */
export function checkInv7_movementMatchesLedgerDelta(row: StockLedgerRowLike): InvariantResult {
  const cls = classifyLedgerRow(row);
  if (cls === 'RESERVE' || cls === 'RELEASE') {
    return { invariant: 'INV-7', holds: true, detail: `stock_ledger/${row.id ?? '?'} is ${cls} — no on-hand delta expected` };
  }
  if (row.beforeQty === undefined || row.afterQty === undefined) {
    return {
      invariant: 'INV-7',
      holds: false,
      detail: `stock_ledger/${row.id ?? '?'} missing beforeQty/afterQty — cannot verify movement:ledger 1:1`,
    };
  }
  const delta = num(row.afterQty) - num(row.beforeQty);
  const signedQty = cls === 'OUT' ? -num(row.qty) : cls === 'RECONCILE' ? num(row.qty) : num(row.qty);
  return {
    invariant: 'INV-7',
    holds: delta === signedQty,
    detail: `stock_ledger/${row.id ?? '?'}: afterQty(${row.afterQty}) - beforeQty(${row.beforeQty}) = ${delta} == signed qty ${signedQty} (${cls})`,
  };
}

/** INV-8: no two ledger rows share an idempotencyKey. */
export function checkInv8_idempotencyKeyUnique(ledgerRows: StockLedgerRowLike[]): InvariantResult {
  const seen = new Map<string, string[]>();
  for (const row of ledgerRows) {
    const key = row.idempotencyKey;
    if (!key) continue;
    const ids = seen.get(key) ?? [];
    ids.push(row.id ?? '?');
    seen.set(key, ids);
  }
  const dupes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  const withKey = ledgerRows.filter((r) => !!r.idempotencyKey).length;
  return {
    invariant: 'INV-8',
    holds: dupes.length === 0,
    detail:
      withKey === 0
        ? `no ledger rows carry an idempotencyKey yet (introduced in Plan Phase 05) — vacuously holds`
        : dupes.length === 0
          ? `${withKey} keyed rows, all unique`
          : `duplicate idempotencyKey(s): ${dupes.map(([k, ids]) => `${k} -> [${ids.join(', ')}]`).join('; ')}`,
  };
}

/** INV-10: a stock summary's warehouseId references a warehouse in the same company. */
export function checkInv10_warehouseBelongsToCompany(
  summary: StockSummaryLike,
  warehouse: WarehouseLike | null | undefined,
): InvariantResult {
  if (!warehouse) {
    return {
      invariant: 'INV-10',
      holds: false,
      detail: `stock/${summary.id ?? '?'} references warehouseId ${summary.warehouseId ?? '?'} which was not found`,
    };
  }
  const holds =
    !!summary.companyId &&
    warehouse.companyId === summary.companyId &&
    warehouse.isDeleted !== true;
  return {
    invariant: 'INV-10',
    holds,
    detail: `stock/${summary.id ?? '?'}.companyId(${summary.companyId ?? '?'}) == warehouse ${warehouse.id ?? '?'}.companyId(${warehouse.companyId ?? '?'}), not deleted (${warehouse.isDeleted !== true})`,
  };
}

/** INV-11: a warehouse transfer produces two rows sharing a transferId; the pair's signed qty sums to 0. */
export function checkInv11_transferPairBalances(
  transferId: string,
  transferLedgerRows: StockLedgerRowLike[],
): InvariantResult {
  const rows = transferLedgerRows.filter(
    (r) => (r.sourceId === transferId || r.referenceId === transferId) && r.isDeleted !== true,
  );
  let signedSum = 0;
  for (const r of rows) {
    const cls = classifyLedgerRow(r);
    if (cls === 'IN') signedSum += num(r.qty);
    else if (cls === 'OUT') signedSum -= num(r.qty);
  }
  return {
    invariant: 'INV-11',
    holds: rows.length === 2 && signedSum === 0,
    detail: `transfer ${transferId}: ${rows.length} ledger row(s), signed qty sum ${signedSum} (expect exactly 2 rows summing to 0)`,
  };
}

/** INV-12: an order's line quantities are frozen once any dispatch has been verified against it. */
export function checkInv12_orderLineFrozenAfterDispatch(
  before: OrderLike,
  after: OrderLike,
): InvariantResult {
  const dispatchedAny = (before.items ?? []).some((it) => num(it.dispatchedQty) > 0);
  const lockedStatus = ['Partial Dispatch', 'Dispatched', 'Closed', 'Cancelled'].includes(
    String(before.status ?? ''),
  );
  const isLocked = dispatchedAny || lockedStatus;
  if (!isLocked) {
    return { invariant: 'INV-12', holds: true, detail: `order ${before.id ?? '?'} not dispatch-locked — line edits permitted` };
  }
  const beforeLines = JSON.stringify(
    (before.items ?? []).map((it) => ({ p: it.productId, q: num(it.qty) })),
  );
  const afterLines = JSON.stringify(
    (after.items ?? []).map((it) => ({ p: it.productId, q: num(it.qty) })),
  );
  return {
    invariant: 'INV-12',
    holds: beforeLines === afterLines,
    detail: `order ${before.id ?? '?'} is dispatch-locked; line set/qty must be unchanged. before=${beforeLines} after=${afterLines}`,
  };
}

/** INV-13: for every PO line, Σ receivedQty <= ordered qty. */
export function checkInv13_purchaseOrderNotOverReceived(po: PurchaseOrderLike): InvariantResult {
  const offenders: string[] = [];
  for (const line of po.items ?? []) {
    if (num(line.receivedQty) > num(line.qty)) {
      offenders.push(`${line.productId ?? '?'} (received ${num(line.receivedQty)} > ordered ${num(line.qty)})`);
    }
  }
  return {
    invariant: 'INV-13',
    holds: offenders.length === 0,
    detail:
      offenders.length === 0
        ? `PO ${po.id ?? '?'}: no line over-received`
        : `PO ${po.id ?? '?'} over-received: ${offenders.join('; ')}`,
  };
}

// ── Non-predicate invariants (rules / design — documented, not runtime-checkable here) ──

/**
 * Invariants enforced by firestore.rules or by design review, not by a
 * doc-snapshot predicate. Listed so the Plan §5 numbering stays complete.
 */
export const RULES_AND_DESIGN_INVARIANTS = {
  'INV-6': 'stock_ledger rows are immutable after creation — firestore.rules `allow update, delete: if false`.',
  'INV-9': 'stock.companyId and stock.warehouseId are immutable on update — firestore.rules companyIdUnchanged() / warehouseIdUnchanged().',
  'INV-14': 'A commission / PI / tax-invoice is never the trigger for a physical stock movement — design rule, enforced by review.',
  'INV-15': 'No stock / stock_ledger read or write where data.companyId != actor.companyId — firestore.rules sameCompany() (owner/superadmin/GroupAdmin-in-group excepted). Emulator-tested.',
} as const;

// ── Convenience: run every predicate over a data bundle ────────────────────

export interface InventoryDataBundle {
  summaries: StockSummaryLike[];
  /** All ledger rows, keyed lookup done internally by (companyId|productId|warehouseId). */
  ledgerRows: StockLedgerRowLike[];
  warehousesById?: Record<string, WarehouseLike>;
  purchaseOrders?: PurchaseOrderLike[];
  openingQtyBySummaryId?: Record<string, number>;
}

function summaryKey(s: { companyId?: string; productId?: string; warehouseId?: string }): string {
  return `${s.companyId ?? ''}|${s.productId ?? ''}|${s.warehouseId ?? ''}`;
}

/**
 * Runs INV-1/2/3/4/5/7/8/10/13 across a bundle and returns every result.
 * INV-11/12 are pairwise/before-after and are not run here.
 */
export function evaluateInventoryInvariants(bundle: InventoryDataBundle): InvariantResult[] {
  const results: InvariantResult[] = [];
  const ledgerByKey = new Map<string, StockLedgerRowLike[]>();
  for (const row of bundle.ledgerRows) {
    const k = summaryKey(row);
    const arr = ledgerByKey.get(k) ?? [];
    arr.push(row);
    ledgerByKey.set(k, arr);
  }

  for (const s of bundle.summaries) {
    if (s.isDeleted === true) continue;
    results.push(checkInv1_onHandNonNegative(s));
    results.push(checkInv2_reservedNonNegative(s));
    results.push(checkInv3_reservedWithinOnHand(s));
    results.push(checkInv4_availableDerivation(s));
    const rows = ledgerByKey.get(summaryKey(s)) ?? [];
    results.push(
      checkInv5_ledgerReconciles(s, rows, bundle.openingQtyBySummaryId?.[s.id ?? ''] ?? 0),
    );
    if (bundle.warehousesById) {
      results.push(checkInv10_warehouseBelongsToCompany(s, bundle.warehousesById[s.warehouseId ?? '']));
    }
  }

  for (const row of bundle.ledgerRows) {
    if (row.isDeleted === true) continue;
    results.push(checkInv7_movementMatchesLedgerDelta(row));
  }
  results.push(checkInv8_idempotencyKeyUnique(bundle.ledgerRows));

  for (const po of bundle.purchaseOrders ?? []) {
    results.push(checkInv13_purchaseOrderNotOverReceived(po));
  }

  return results;
}
