/**
 * INVENTORY-07 — Sales reservation / allocation configuration.
 *
 * The `reservationsEnabled` feature flag (Plan §07 "Rollback strategy"). It is
 * the ONE switch that turns the whole reservation lifecycle on/off:
 *
 *   ON  → `markPIAsPaid` reserves stock, dispatch consumes it, cancel releases
 *         it, and the movement engine maintains
 *         `availableQty = onHandQty − reservedQty` after EVERY movement.
 *   OFF → the engine skips RESERVE / RELEASE entirely, `reservedQty` stays inert,
 *         `availableQty == onHandQty`, and `markPIAsPaid` only sets the legacy
 *         `order.stockBlocked` flag — byte-for-byte the pre-07 behaviour.
 *
 * Phase 07 ACTIVATES the flag (default `true`) — it is the single phase in the
 * roadmap that changes `availableQty` semantics, and it does so behind the
 * single stock writer with Phase-06 reconciliation already in place. Instant
 * rollback = set `RESERVATIONS_ENABLED_DEFAULT` to `false` (or call
 * `setReservationsEnabled(false)` at runtime) and redeploy — the
 * `stock_reservations` docs become inert, no data migration required.
 *
 * A single per-call `StockMovementInput.reservationsEnabled` still overrides
 * this global (used by tests to exercise both states).
 */

/** Phase-07 default. Flip to `false` for an instant, code-only rollback. */
export const RESERVATIONS_ENABLED_DEFAULT = true;

let runtimeOverride: boolean | null = null;

/** The effective global reservation flag. */
export function isReservationsEnabled(): boolean {
  return runtimeOverride === null ? RESERVATIONS_ENABLED_DEFAULT : runtimeOverride;
}

/**
 * Runtime override — primarily for tests that need to assert both the ON and
 * OFF behaviour of the same code path. `null` restores the compile-time default.
 */
export function setReservationsEnabled(value: boolean | null): void {
  runtimeOverride = value;
}

/** `stock_reservations` document id — deterministic + injective, so a retried
 *  reserve resolves to the SAME doc and is a no-op (mirrors `movementLedgerId`).
 *  `key` is the SALES_RESERVE idempotency key
 *  (`SALES_RESERVE:proforma_invoice:{piId}:{orderLineKey}`). */
export function reservationDocId(key: string): string {
  return `RSV-${encodeURIComponent(key)}`;
}

export type ReservationStatus = 'active' | 'partial' | 'consumed' | 'released';

/** One `stock_reservations` document (Plan §07 "Target behavior"). */
export interface StockReservationRecord {
  id: string;
  companyId: string;
  groupId?: string;
  orderId: string;
  orderLineKey: string;
  productId: string;
  warehouseId: string;
  unit: string;
  qtyRequested: number;
  qtyReserved: number;
  qtyConsumed: number;
  qtyReleased: number;
  status: ReservationStatus;
  piId: string;
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
  lastMovementAt?: string;
  lastMovementLedgerId?: string;
  isDeleted?: boolean;
}

/** The unconsumed, unreleased remainder still held by a reservation. */
export function reservationRemainder(r: Partial<StockReservationRecord> | null | undefined): number {
  if (!r) return 0;
  const reserved = Number(r.qtyReserved) || 0;
  const consumed = Number(r.qtyConsumed) || 0;
  const released = Number(r.qtyReleased) || 0;
  return Math.max(0, reserved - consumed - released);
}

/** Derive the reservation status from its quantities. */
export function reservationStatusFor(r: Pick<StockReservationRecord, 'qtyRequested' | 'qtyReserved' | 'qtyConsumed' | 'qtyReleased'>): ReservationStatus {
  const reserved = Number(r.qtyReserved) || 0;
  const consumed = Number(r.qtyConsumed) || 0;
  const released = Number(r.qtyReleased) || 0;
  const remainder = Math.max(0, reserved - consumed - released);
  if (remainder > 1e-6) return consumed > 1e-6 ? 'partial' : 'active';
  if (consumed > 1e-6 && released <= 1e-6) return 'consumed';
  if (released > 1e-6 && consumed <= 1e-6) return 'released';
  // fully accounted for by a mix of consume + release
  return consumed >= released ? 'consumed' : 'released';
}
