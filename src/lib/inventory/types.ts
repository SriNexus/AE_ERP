/**
 * INVENTORY-05a — Stock Movement Engine types (frozen at Phase 05).
 *
 * Every physical/logical stock change in Neozy is ONE of these movement types.
 * The engine (`stockMovementEngine.ts`) is the single writer; callers are
 * migrated to it in Phases 05b–05d. Until then this module is DORMANT.
 *
 * See INVENTORY_IMPLEMENTATION_PLAN.md §8 (movement types), §4 (architecture),
 * §5 (invariants), §10 (idempotency).
 */

export type MovementType =
  | 'PURCHASE_RECEIPT'   // IN   — GRN against a PO
  | 'OPENING_STOCK'      // IN   — initial balance for a new tenant/product
  | 'ADJUSTMENT_IN'      // IN   — manual correction up (reasonCode required)
  | 'ADJUSTMENT_OUT'     // OUT  — manual correction down (reasonCode required)
  | 'DAMAGE_OUT'         // OUT  — damaged / written off (reasonCode required)
  | 'SALES_RESERVE'      // RESERVE  — earmark for a paid order (no onHand change) — Phase 07
  | 'SALES_RELEASE'      // RELEASE  — un-earmark (no onHand change) — Phase 07
  | 'DISPATCH_OUT'       // OUT  — verified dispatch
  | 'SALES_RETURN_IN'    // IN   — goods returned (cancel-after-dispatch, RMA)
  | 'TRANSFER_OUT'       // OUT  — leg 1 of a warehouse transfer — Phase 08
  | 'TRANSFER_IN'        // IN   — leg 2 of a warehouse transfer — Phase 08
  | 'RECONCILE_ADJUST';  // IN/OUT — reconciliation correction (human-approved) — Phase 06

export type MovementDirection = 'IN' | 'OUT' | 'RESERVE' | 'RELEASE';

/** The direction of every non-signed movement type. RECONCILE_ADJUST is derived
 * from the sign of its (signed) qty at call time. */
export const MOVEMENT_DIRECTION: Record<Exclude<MovementType, 'RECONCILE_ADJUST'>, MovementDirection> = {
  PURCHASE_RECEIPT: 'IN',
  OPENING_STOCK: 'IN',
  ADJUSTMENT_IN: 'IN',
  SALES_RETURN_IN: 'IN',
  TRANSFER_IN: 'IN',
  ADJUSTMENT_OUT: 'OUT',
  DAMAGE_OUT: 'OUT',
  DISPATCH_OUT: 'OUT',
  TRANSFER_OUT: 'OUT',
  SALES_RESERVE: 'RESERVE',
  SALES_RELEASE: 'RELEASE',
};

export const MOVEMENT_TYPES: MovementType[] = [
  'PURCHASE_RECEIPT', 'OPENING_STOCK', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE_OUT',
  'SALES_RESERVE', 'SALES_RELEASE', 'DISPATCH_OUT', 'SALES_RETURN_IN',
  'TRANSFER_OUT', 'TRANSFER_IN', 'RECONCILE_ADJUST',
];

/** Movement types that MUST carry an explicit `reasonCode` (Plan §8). */
export const REASON_CODE_REQUIRED: MovementType[] = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE_OUT', 'RECONCILE_ADJUST'];

export interface StockMovementInput {
  movementType: MovementType;
  productId: string;
  warehouseId: string;
  /** Positive for every type; may be SIGNED only for RECONCILE_ADJUST. */
  qty: number;
  unit: string;
  /** e.g. 'goods_receipt' | 'dispatch' | 'manual' | 'order_cancel' | 'transfer'. */
  sourceType: string;
  sourceId: string;
  /** Per-line disambiguator (poLineIndex, productId, orderLineKey, …). */
  lineKey?: string | number;
  /** Overrides the computed `{movementType}:{sourceType}:{sourceId}[:{lineKey}]`. */
  idempotencyKey?: string;
  /** Resolved from the active tenant when absent. */
  companyId?: string;
  /** Resolved from the signed-in user when absent. */
  actorId?: string;
  /** Required for the ADJUSTMENT / DAMAGE_OUT / RECONCILE_ADJUST movement types. */
  reasonCode?: string;
  notes?: string;
  /**
   * INV-3 / INV-4 gate. FALSE for Phases 05–06 (`availableQty == onHandQty`,
   * reservedQty stays 0). Phase 07 flips this on.
   */
  reservationsEnabled?: boolean;
}

export interface MovementResult {
  /** true = the movement was just applied; false = idempotent no-op (already applied). */
  applied: boolean;
  movementType: MovementType;
  direction: MovementDirection;
  stockId: string;
  ledgerId: string;
  idempotencyKey: string;
  productId: string;
  warehouseId: string;
  companyId: string;
  qty: number;
  onHandBefore: number;
  onHandAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  availableAfter: number;
}
