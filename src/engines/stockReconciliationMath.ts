/**
 * stockReconciliationMath — INVENTORY-06
 *
 * PURE reconciliation math. NO imports (no Firestore, no store, no engine) so it
 * can be reused by both `StockReconciliationEngine.ts` (browser / app) and
 * `scripts/inventory/reconcile.ts` (node) — one reconciliation implementation
 * (Plan section 26). Data-source-agnostic: the caller supplies the stored
 * on-hand + the ledger rows.
 */

export const RECON_EPSILON = 1e-6;

/** Movement types (or legacy `type`) that ADD to physical on-hand. */
export const IN_MOVEMENT_TYPES = new Set([
  'PURCHASE_RECEIPT', 'OPENING_STOCK', 'ADJUSTMENT_IN', 'SALES_RETURN_IN', 'TRANSFER_IN',
]);
/** Movement types (or legacy `type`) that REMOVE from physical on-hand. */
export const OUT_MOVEMENT_TYPES = new Set([
  'DISPATCH_OUT', 'ADJUSTMENT_OUT', 'DAMAGE_OUT', 'TRANSFER_OUT',
]);
/** Movement types that DO NOT touch physical on-hand (Phase 07 reservation). */
export const NEUTRAL_MOVEMENT_TYPES = new Set(['SALES_RESERVE', 'SALES_RELEASE']);

export interface StockLedgerRowLike {
  id?: string;
  qty?: number;
  /** Phase-05 unified field — authoritative on engine rows. */
  direction?: string;
  /** Phase-05 unified field. */
  movementType?: string;
  /** Legacy compat field ('IN' | 'OUT'). */
  type?: string;
  /** INVENTORY-06 flag on a reconciliation-correction row. */
  auditReconciliation?: boolean;
  movementAt?: unknown;
  createdAt?: unknown;
  date?: unknown;
  isDeleted?: boolean;
}

export interface SummaryReconciliation {
  summaryId: string;
  companyId: string;
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  unit: string;
  /** stock.onHandQty (falls back to availableQty for pre-05a summaries). */
  stored: number;
  /**
   * Sum(OPERATIONAL IN) - Sum(OPERATIONAL OUT) from the ledger. Reservation
   * rows are ignored; RECONCILE_ADJUST rows are EXCLUDED (they patch `stored`,
   * they are not part of "what the operational movement history says"), so a
   * correction that brings `stored` to `computed` actually reconciles.
   * LEDGER-DERIVED — may be incomplete for a pre-engine opening balance.
   */
  computed: number;
  /** Signed sum of RECONCILE_ADJUST rows already applied to this summary (audit). */
  reconcileAdjustTotal: number;
  /** computed - stored. `+` = operational ledger higher than stored. */
  delta: number;
  /** |delta| <= EPSILON. */
  reconciled: boolean;
  ledgerRowCount: number;
  /** rows the classifier could not resolve to IN/OUT/neutral (bad legacy data). */
  unclassifiedRowCount: number;
  firstMovementAt: string | null;
  lastMovementAt: string | null;
  /**
   * FALSE when `computed` cannot be fully trusted: no operational ledger rows
   * at all while stored != 0, or an unclassifiable row exists. A mismatch on a
   * `ledgerComplete === false` summary is very likely a pre-engine opening
   * balance, not real drift.
   */
  ledgerComplete: boolean;
  note?: string;

  /* ── INVENTORY-07 — reservation reconciliation (ADDITIVE; does not affect the
   *    physical `reconciled` verdict above). `reservedQty` on the summary must
   *    equal Σ(active reservation remainders) for that product+warehouse. ── */
  /** stock.reservedQty as stored on the summary. */
  storedReserved: number;
  /** Σ(qtyReserved − qtyConsumed − qtyReleased) over active stock_reservations. */
  expectedReserved: number;
  /** expectedReserved − storedReserved. */
  reservedDelta: number;
  /** |reservedDelta| <= EPSILON. */
  reservedReconciled: boolean;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number') return new Date(v).toISOString();
  const anyV = v as { toDate?: () => Date; seconds?: number };
  if (typeof anyV?.toDate === 'function') return anyV.toDate().toISOString();
  if (typeof anyV?.seconds === 'number') return new Date(anyV.seconds * 1000).toISOString();
  return null;
}

function rowInstant(row: StockLedgerRowLike): number {
  const iso = toIso(row.movementAt) ?? toIso(row.date) ?? toIso(row.createdAt);
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Signed physical-on-hand delta of ONE ledger row.
 * `direction` (engine rows) -> `movementType` -> legacy `type`. Reservation
 * movements return 0. An unclassifiable row returns `{ classified: false }`.
 *
 * Note: this deliberately differs from `INVENTORY_INVARIANTS.classifyLedgerRow`
 * for `RECONCILE_ADJUST` — the engine writes that row with an ABSOLUTE `qty`
 * and a signed `direction`, so its sign must come from `direction`, not `qty`.
 */
export function ledgerRowOnHandDelta(row: StockLedgerRowLike): { delta: number; classified: boolean; isReconcile: boolean } {
  if (row.isDeleted === true) return { delta: 0, classified: true, isReconcile: false };
  const qty = Math.abs(num(row.qty));
  const mt = String(row.movementType || '').toUpperCase();
  const dir = String(row.direction || '').toUpperCase();
  const isReconcile = mt === 'RECONCILE_ADJUST' || row.auditReconciliation === true;

  if (isReconcile) {
    if (dir === 'OUT') return { delta: -qty, classified: true, isReconcile: true };
    return { delta: qty, classified: true, isReconcile: true };
  }

  if (dir === 'IN') return { delta: qty, classified: true, isReconcile: false };
  if (dir === 'OUT') return { delta: -qty, classified: true, isReconcile: false };
  if (dir === 'RESERVE' || dir === 'RELEASE') return { delta: 0, classified: true, isReconcile: false };

  if (IN_MOVEMENT_TYPES.has(mt)) return { delta: qty, classified: true, isReconcile: false };
  if (OUT_MOVEMENT_TYPES.has(mt)) return { delta: -qty, classified: true, isReconcile: false };
  if (NEUTRAL_MOVEMENT_TYPES.has(mt)) return { delta: 0, classified: true, isReconcile: false };

  const t = String(row.type || '').toUpperCase();
  if (t === 'IN') return { delta: qty, classified: true, isReconcile: false };
  if (t === 'OUT') return { delta: -qty, classified: true, isReconcile: false };
  if (t === 'RESERVE' || t === 'RELEASE') return { delta: 0, classified: true, isReconcile: false };

  return { delta: 0, classified: false, isReconcile: false };
}

/**
 * PURE — compare a stored on-hand against its ledger history. No Firestore.
 */
export function computeReconciliation(input: {
  summaryId: string;
  companyId: string;
  productId: string;
  warehouseId: string;
  productName?: string;
  warehouseName?: string;
  unit?: string;
  storedOnHand: number;
  ledgerRows: StockLedgerRowLike[];
  /** INVENTORY-07 — stock.reservedQty (defaults 0 for a pre-07 summary). */
  storedReserved?: number;
  /** INVENTORY-07 — Σ(active reservation remainders) for this product+warehouse. */
  activeReservationRemainder?: number;
}): SummaryReconciliation {
  const rows = (input.ledgerRows || []).filter((r) => r.isDeleted !== true);
  let computed = 0;                 // operational movements only (RECONCILE_ADJUST excluded)
  let reconcileAdjustTotal = 0;     // signed sum of RECONCILE_ADJUST rows already applied
  let unclassified = 0;
  let operationalRowCount = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = 0;

  for (const row of rows) {
    const { delta, classified, isReconcile } = ledgerRowOnHandDelta(row);
    if (!classified) { unclassified += 1; continue; }
    if (isReconcile) { reconcileAdjustTotal += delta; }
    else { computed += delta; operationalRowCount += 1; }
    const t = rowInstant(row);
    if (t > 0) { if (t < first) first = t; if (t > last) last = t; }
  }

  const stored = num(input.storedOnHand);
  const delta = computed - stored;
  const reconciled = Math.abs(delta) <= RECON_EPSILON;

  // INVENTORY-07 — additive reservation reconciliation.
  const storedReserved = num(input.storedReserved);
  const expectedReserved = num(input.activeReservationRemainder);
  const reservedDelta = expectedReserved - storedReserved;
  const reservedReconciled = Math.abs(reservedDelta) <= RECON_EPSILON;
  const ledgerComplete = unclassified === 0 && !(operationalRowCount === 0 && Math.abs(stored) > RECON_EPSILON);

  let note: string | undefined;
  if (!reconciled) {
    if (operationalRowCount === 0) note = 'No operational ledger movements — stored on-hand has no movement history (pre-engine opening balance).';
    else if (unclassified > 0) note = `${unclassified} ledger row(s) could not be classified — computed is unreliable.`;
    else if (!ledgerComplete) note = 'Ledger may not include the opening balance recorded before the movement engine.';
    else note = 'All operational ledger rows classified — this is post-engine drift and should be investigated.';
  }

  return {
    summaryId: input.summaryId,
    companyId: input.companyId,
    productId: input.productId,
    productName: input.productName || input.productId,
    warehouseId: input.warehouseId,
    warehouseName: input.warehouseName || input.warehouseId,
    unit: input.unit || 'unit',
    stored,
    computed,
    reconcileAdjustTotal,
    delta,
    reconciled,
    ledgerRowCount: rows.length,
    unclassifiedRowCount: unclassified,
    firstMovementAt: Number.isFinite(first) && first !== Number.POSITIVE_INFINITY ? new Date(first).toISOString() : null,
    lastMovementAt: last > 0 ? new Date(last).toISOString() : null,
    ledgerComplete,
    note,
    storedReserved,
    expectedReserved,
    reservedDelta,
    reservedReconciled,
  };
}
