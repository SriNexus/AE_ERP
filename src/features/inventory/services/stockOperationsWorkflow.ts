/**
 * INVENTORY-10 (§10a Opening Stock, §10b Damage/Write-off) — inventory
 * operational flows built on the Phase-05 movement engine. Every physical
 * change goes through `applyStockMovement` — this module NEVER writes
 * `stock` / `stock_ledger` directly (the engine remains the sole writer).
 */
import { getOne } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { logActivity, resolveWorkflowCompanyId, type WorkflowRecord } from '../../../lib/workflow';
import { applyStockMovement } from '../../../lib/inventory/stockMovementEngine';
import { movementLedgerId, buildIdempotencyKey } from '../../../lib/inventory/idempotency';
import type { MovementResult } from '../../../lib/inventory/types';

/* ─────────────────────────────────────────────────────────────────────────────
 * §10a — Opening Stock
 * ────────────────────────────────────────────────────────────────────────── */

/** Deterministic — one opening-stock movement per (company, product, warehouse),
 *  ever. This IS the guard against a second opening entry (INV-8: the engine's
 *  own idempotency check makes a retry / race a benign no-op), not just an
 *  advisory pre-check. */
function openingStockIdempotencyKey(companyId: string, productId: string, warehouseId: string): string {
  return buildIdempotencyKey('OPENING_STOCK', 'opening', `${companyId}:${productId}:${warehouseId}`);
}

async function assertProductWarehouseValid(companyId: string, productId: string, warehouseId: string) {
  const [product, warehouse] = await Promise.all([
    getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PRODUCTS, productId),
    getOne<WorkflowRecord & { id: string }>(COLLECTIONS.WAREHOUSES, warehouseId),
  ]);
  if (!product || product.isDeleted === true) throw new Error(`Product ${productId} does not exist or has been removed`);
  if (companyId && product.companyId && product.companyId !== companyId) throw new Error(`Product ${productId} belongs to a different company`);
  if (!warehouse || warehouse.isDeleted === true) throw new Error(`Warehouse ${warehouseId} does not exist or has been removed`);
  if (companyId && warehouse.companyId && warehouse.companyId !== companyId) throw new Error(`Warehouse ${warehouseId} belongs to a different company`);
  return { product, warehouse };
}

export interface OpeningStockInput {
  productId: string;
  warehouseId: string;
  qty: number;
  unit: string;
  notes?: string;
}

/**
 * §10a — a dedicated "Opening Stock" entry: `OPENING_STOCK`, ONE per
 * (product, warehouse), ever. A second attempt — whether a genuine repeat
 * click or a real concurrent race — is REJECTED with a clear message; use
 * Adjust Stock (§05d ADJUSTMENT_IN/OUT) or a reconciliation RECONCILE_ADJUST
 * (Phase 06) for any correction after go-live.
 */
export async function applyOpeningStock(input: OpeningStockInput): Promise<MovementResult> {
  const qty = Number(input.qty);
  if (!input.productId) throw new Error('Product is required');
  if (!input.warehouseId) throw new Error('Warehouse is required');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Opening quantity must be greater than zero');

  const state = useAppStore.getState();
  const companyId = resolveWorkflowCompanyId();
  const actorId = state.user?.id || 'system';
  const { product, warehouse } = await assertProductWarehouseValid(companyId, input.productId, input.warehouseId);

  const idempotencyKey = openingStockIdempotencyKey(companyId, input.productId, input.warehouseId);
  // Friendly upfront check — the REAL guard is the deterministic idempotency
  // key below (a race lands here too, just after the engine call instead).
  const existingLedgerId = movementLedgerId(idempotencyKey);
  const existing = await getOne<WorkflowRecord>(COLLECTIONS.STOCK_LEDGER, existingLedgerId).catch(() => null);
  if (existing) {
    throw new Error(`Opening stock has already been recorded for ${product.name || input.productId} at ${warehouse.name || input.warehouseId}. Use Adjust Stock or a reconciliation correction instead.`);
  }

  const result = await applyStockMovement({
    movementType: 'OPENING_STOCK',
    productId: input.productId,
    warehouseId: input.warehouseId,
    qty,
    unit: input.unit,
    sourceType: 'opening',
    sourceId: `${companyId}:${input.productId}:${input.warehouseId}`,
    idempotencyKey,
    companyId,
    actorId,
    notes: input.notes || 'Opening stock',
    ledgerExtra: { referenceType: 'OpeningStock', product: product.name, warehouse: warehouse.name },
  });

  if (!result.applied) {
    // Lost the race to a concurrent opening-stock entry for the same pair.
    throw new Error(`Opening stock has already been recorded for ${product.name || input.productId} at ${warehouse.name || input.warehouseId}. Use Adjust Stock or a reconciliation correction instead.`);
  }

  await logActivity('Stock', 'Opening Stock', result.ledgerId, {
    productId: input.productId, warehouseId: input.warehouseId, entityName: product.name || input.productId,
    actionLabel: `Recorded opening stock ${qty} ${input.unit}`,
  });
  return result;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * §10b — Damage / Write-off
 * ────────────────────────────────────────────────────────────────────────── */

/** The fixed reason taxonomy (Plan §10b) — the engine's own `REASON_CODE_REQUIRED`
 *  already forces SOME non-blank reasonCode on DAMAGE_OUT; this workflow layer
 *  restricts it to these known categories instead of free text. */
export const DAMAGE_REASON_CODES = ['damaged', 'expired', 'lost', 'theft', 'sample'] as const;
export type DamageReasonCode = typeof DAMAGE_REASON_CODES[number];

export const DAMAGE_REASON_LABELS: Record<DamageReasonCode, string> = {
  damaged: 'Physically damaged',
  expired: 'Expired / past shelf life',
  lost: 'Lost / missing',
  theft: 'Theft',
  sample: 'Given away as a sample',
};

/** Above either threshold, only an Admin/GroupAdmin may record the write-off. */
export const DAMAGE_APPROVAL_THRESHOLD_QTY = 50;
export const DAMAGE_APPROVAL_THRESHOLD_VALUE = 50_000;

function actorRole(): string {
  return String(useAppStore.getState().user?.role || '');
}
function isApprovalRole(role: string): boolean {
  return /Admin|GroupAdmin/i.test(role);
}

export interface DamageWriteOffInput {
  productId: string;
  warehouseId: string;
  qty: number;
  unit: string;
  reasonCode: DamageReasonCode;
  notes?: string;
}

/**
 * §10b — `DAMAGE_OUT` with a fixed reason taxonomy and an Admin-approval
 * threshold: a write-off above `DAMAGE_APPROVAL_THRESHOLD_QTY` units OR whose
 * estimated value (`qty * product.price`) exceeds
 * `DAMAGE_APPROVAL_THRESHOLD_VALUE` is REJECTED unless the acting user's role
 * is Admin/GroupAdmin. Enforced here (the authoritative workflow layer), not
 * only as a UI hint.
 */
export async function applyDamageWriteOff(input: DamageWriteOffInput): Promise<MovementResult> {
  const qty = Number(input.qty);
  if (!input.productId) throw new Error('Product is required');
  if (!input.warehouseId) throw new Error('Warehouse is required');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be greater than zero');
  if (!DAMAGE_REASON_CODES.includes(input.reasonCode)) {
    throw new Error(`Reason must be one of: ${DAMAGE_REASON_CODES.join(', ')}`);
  }

  const state = useAppStore.getState();
  const companyId = resolveWorkflowCompanyId();
  const actorId = state.user?.id || 'system';
  const { product, warehouse } = await assertProductWarehouseValid(companyId, input.productId, input.warehouseId);

  const estimatedValue = qty * (Number(product.price) || 0);
  const needsApproval = qty > DAMAGE_APPROVAL_THRESHOLD_QTY || estimatedValue > DAMAGE_APPROVAL_THRESHOLD_VALUE;
  if (needsApproval && !isApprovalRole(actorRole())) {
    throw new Error(`Damage write-offs above ${DAMAGE_APPROVAL_THRESHOLD_QTY} units or an estimated value of ${DAMAGE_APPROVAL_THRESHOLD_VALUE} require Admin approval.`);
  }

  const result = await applyStockMovement({
    movementType: 'DAMAGE_OUT',
    productId: input.productId,
    warehouseId: input.warehouseId,
    qty,
    unit: input.unit,
    sourceType: 'damage',
    sourceId: `${input.productId}:${input.warehouseId}:${Date.now()}`,
    companyId,
    actorId,
    reasonCode: input.reasonCode,
    notes: input.notes || DAMAGE_REASON_LABELS[input.reasonCode],
    ledgerExtra: {
      referenceType: 'DamageWriteOff', product: product.name, warehouse: warehouse.name,
      damageReasonCode: input.reasonCode, estimatedValue, requiredApproval: needsApproval,
    },
  });

  await logActivity('Stock', 'Damage Write-off', result.ledgerId, {
    productId: input.productId, warehouseId: input.warehouseId, entityName: product.name || input.productId,
    actionLabel: `Wrote off ${qty} ${input.unit} (${input.reasonCode})`,
    reasonCode: input.reasonCode, needsApproval,
  });
  return result;
}
