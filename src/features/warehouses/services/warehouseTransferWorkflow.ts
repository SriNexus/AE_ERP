/**
 * INVENTORY-08 — Warehouse Transfer workflow.
 *
 * A first-class warehouse-to-warehouse transfer within ONE company:
 *
 *   createTransfer   → a `draft` doc; NO stock movement.
 *   shipTransfer     → per item `applyStockMovement('TRANSFER_OUT', { warehouseId: from })`;
 *                      status `in_transit`. ATOMIC — a validation failure on any
 *                      line commits nothing.
 *   receiveTransfer  → per item `applyStockMovement('TRANSFER_IN', { warehouseId: to })`
 *                      for the quantity that ACTUALLY arrived (partial receipt =
 *                      loss in transit, flagged on the doc); status `received`.
 *   cancelTransfer   → `draft`: status `cancelled`, no movement.
 *                      `in_transit`: compensating `TRANSFER_IN` back to the source;
 *                      status `cancelled`.
 *
 * The movement engine (`stockMovementEngine.ts`) stays the SOLE writer of `stock`
 * / `stock_ledger`. This workflow only writes the `stock_transfers` doc — via a
 * `MovementParticipant` so the doc status flip commits ATOMICALLY inside the
 * engine's single `runTransaction` alongside every `TRANSFER_OUT` / `TRANSFER_IN`
 * row. Deterministic idempotency keys make ship / receive / cancel retry-safe
 * (INV-8); a completed transfer's `TRANSFER_OUT + TRANSFER_IN` sum to 0 (INV-11).
 */

import { createDocWithId, getAll, getOne, genId, updateDocById, resolveWriteGroupId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { sanitizeFirestoreData } from '../../../lib/sanitizer';
import { canDo } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { NotificationType } from '../../../types';
import { logActivity, notifyUsers, resolveWorkflowCompanyId, text, usersByRole, type WorkflowRecord } from '../../../lib/workflow';
import { applyStockMovements } from '../../../lib/inventory/stockMovementEngine';
import type { MovementParticipant, StockMovementInput } from '../../../lib/inventory/types';
import type { StockTransferItem, StockTransferRecord, StockTransferStatus } from '../types/stockTransfer';

const EPSILON = 1e-6;

export interface CreateTransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  items: Array<{ productId: string; product?: string; qty: number; unit?: string }>;
  notes?: string;
}

function actor(): string {
  return useAppStore.getState().user?.id || 'system';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Validation (INVENTORY-08 §4) — same-company, both warehouses real, products real
 * ────────────────────────────────────────────────────────────────────────── */

async function assertTransferReferencesValid(
  companyId: string,
  fromWarehouseId: string,
  toWarehouseId: string,
  productIds: string[],
): Promise<{ fromWarehouse: WorkflowRecord & { id: string }; toWarehouse: WorkflowRecord & { id: string } }> {
  if (!fromWarehouseId || !toWarehouseId) throw new Error('A source and a destination warehouse are required');
  if (fromWarehouseId === toWarehouseId) throw new Error('The source and destination warehouse must be different');

  const [fromWarehouse, toWarehouse] = await Promise.all([
    getOne<WorkflowRecord & { id: string }>(COLLECTIONS.WAREHOUSES, fromWarehouseId),
    getOne<WorkflowRecord & { id: string }>(COLLECTIONS.WAREHOUSES, toWarehouseId),
  ]);
  if (!fromWarehouse || fromWarehouse.isDeleted === true) throw new Error(`Source warehouse ${fromWarehouseId} does not exist or has been removed`);
  if (!toWarehouse || toWarehouse.isDeleted === true) throw new Error(`Destination warehouse ${toWarehouseId} does not exist or has been removed`);
  if (companyId && fromWarehouse.companyId && fromWarehouse.companyId !== companyId) throw new Error('Source warehouse belongs to a different company');
  if (companyId && toWarehouse.companyId && toWarehouse.companyId !== companyId) throw new Error('Destination warehouse belongs to a different company — cross-company transfers are not allowed');

  for (const productId of Array.from(new Set(productIds))) {
    if (!productId) throw new Error('Every transfer line must reference a product');
    const product = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PRODUCTS, productId);
    if (!product || product.isDeleted === true) throw new Error(`Product ${productId} does not exist or has been removed`);
    if (companyId && product.companyId && product.companyId !== companyId) throw new Error(`Product ${productId} belongs to a different company`);
  }
  return { fromWarehouse, toWarehouse };
}

function normalizeItems(items: CreateTransferInput['items']): StockTransferItem[] {
  const out: StockTransferItem[] = [];
  for (const raw of items || []) {
    const productId = String(raw.productId || '').trim();
    const qty = Number(raw.qty);
    if (!productId) throw new Error('Every transfer line must reference a product');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Transfer quantity for ${raw.product || productId} must be greater than zero`);
    out.push({ productId, product: raw.product ? String(raw.product) : undefined, qty, unit: String(raw.unit || 'PCS') });
  }
  if (!out.length) throw new Error('A transfer needs at least one line');
  // one line per product
  const seen = new Set<string>();
  for (const it of out) {
    if (seen.has(it.productId)) throw new Error(`Product ${it.product || it.productId} appears more than once — combine it into one line`);
    seen.add(it.productId);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * A. Create transfer — draft, no stock effect
 * ────────────────────────────────────────────────────────────────────────── */

export async function createTransfer(input: CreateTransferInput): Promise<StockTransferRecord> {
  if (!canDo('create', 'stock')) throw new Error('You do not have permission to create a stock transfer');
  const companyId = String(resolveWorkflowCompanyId() || '');
  const groupId = resolveWriteGroupId(companyId);
  const items = normalizeItems(input.items);
  const { fromWarehouse, toWarehouse } = await assertTransferReferencesValid(
    companyId, String(input.fromWarehouseId), String(input.toWarehouseId), items.map((i) => i.productId),
  );

  const id = genId.generic('TRF');
  const nowIso = new Date().toISOString();
  const doc: StockTransferRecord = {
    id,
    companyId,
    ...(groupId ? { groupId } : {}),
    fromWarehouseId: String(input.fromWarehouseId),
    fromWarehouseName: text(fromWarehouse.name) || String(input.fromWarehouseId),
    toWarehouseId: String(input.toWarehouseId),
    toWarehouseName: text(toWarehouse.name) || String(input.toWarehouseId),
    warehouseIds: [String(input.fromWarehouseId), String(input.toWarehouseId)],
    items,
    status: 'draft',
    notes: input.notes ? String(input.notes) : undefined,
    createdBy: actor(),
    createdAt: nowIso,
    updatedBy: actor(),
    updatedAt: nowIso,
    isDeleted: false,
  };
  await createDocWithId(COLLECTIONS.STOCK_TRANSFERS, id, sanitizeFirestoreData(doc as unknown as Record<string, unknown>));

  await logActivity('Warehouses', 'Created Transfer', id, {
    entityName: `${doc.fromWarehouseName} → ${doc.toWarehouseName}`,
    actionLabel: 'Created stock transfer',
    fromWarehouseId: doc.fromWarehouseId, toWarehouseId: doc.toWarehouseId,
  });
  return doc;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Participant — the `stock_transfers` doc status flip, atomic with the movements
 * ────────────────────────────────────────────────────────────────────────── */

function transferParticipant(opts: {
  transferId: string;
  requiredStatus: StockTransferStatus;
  patch: Record<string, unknown>;
  /** already in the target status → benign skip (double ship/receive/cancel). */
  targetStatus: StockTransferStatus;
}): MovementParticipant<WorkflowRecord | null> {
  return {
    async read(rc) {
      return rc.get<WorkflowRecord>(COLLECTIONS.STOCK_TRANSFERS, opts.transferId);
    },
    validate(t) {
      if (!t) throw new Error(`Transfer ${opts.transferId} not found`);
      const status = String(t.status || '');
      if (status === opts.targetStatus) return false;           // idempotent no-op
      if (status !== opts.requiredStatus) {
        throw new Error(`Transfer ${opts.transferId} is '${status}' — expected '${opts.requiredStatus}'`);
      }
    },
    commit(_t, _plan, writer) {
      writer.set(COLLECTIONS.STOCK_TRANSFERS, opts.transferId, opts.patch, { merge: true });
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * B. Ship transfer — TRANSFER_OUT at source, status in_transit
 * ────────────────────────────────────────────────────────────────────────── */

function outInputs(t: StockTransferRecord, companyId: string): StockMovementInput[] {
  return t.items.map((line) => ({
    movementType: 'TRANSFER_OUT' as const,
    productId: line.productId,
    warehouseId: t.fromWarehouseId,
    qty: Number(line.qty),
    unit: String(line.unit || 'PCS'),
    sourceType: 'transfer',
    sourceId: t.id,
    lineKey: line.productId,
    companyId,
    actorId: actor(),
    notes: `Warehouse transfer ${t.id}: ${t.fromWarehouseName} → ${t.toWarehouseName}`,
    ledgerExtra: {
      referenceType: 'StockTransfer', referenceId: t.id, transferId: t.id,
      product: line.product, warehouse: t.fromWarehouseName,
      transferFromWarehouseId: t.fromWarehouseId, transferToWarehouseId: t.toWarehouseId,
    },
  }));
}

export async function shipTransfer(transferId: string) {
  if (!canDo('edit', 'stock')) throw new Error('You do not have permission to ship a stock transfer');
  const t = await getOne<StockTransferRecord>(COLLECTIONS.STOCK_TRANSFERS, transferId);
  if (!t) throw new Error(`Transfer ${transferId} not found`);
  if (t.status === 'in_transit') return { transferId, alreadyShipped: true as const };
  if (t.status !== 'draft') throw new Error(`Only a draft transfer can be shipped (this one is '${t.status}')`);

  const companyId = String(t.companyId || resolveWorkflowCompanyId() || '');
  await assertTransferReferencesValid(companyId, t.fromWarehouseId, t.toWarehouseId, t.items.map((i) => i.productId));

  const nowIso = new Date().toISOString();
  const actorId = actor();
  const shippedItems = t.items.map((it) => ({ ...it, shippedQty: Number(it.qty) }));
  const patch = { status: 'in_transit', shippedBy: actorId, shippedAt: nowIso, items: shippedItems, updatedBy: actorId, updatedAt: nowIso };

  let batch;
  try {
    batch = await applyStockMovements(
      outInputs(t, companyId),
      transferParticipant({ transferId, requiredStatus: 'draft', targetStatus: 'in_transit', patch }),
    );
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (/Insufficient stock|onHandQty|Over-reservation/i.test(msg)) {
      throw new Error(`Cannot ship transfer ${transferId} — ${msg}`);
    }
    throw err;
  }

  if (batch.skipped) return { transferId, alreadyShipped: true as const };
  if (!batch.applied) {
    // every TRANSFER_OUT was an idempotent ledger no-op but the doc never flipped
    // (a prior partial failure) — recover the status. Idempotent.
    await updateDocById(COLLECTIONS.STOCK_TRANSFERS, transferId, sanitizeFirestoreData(patch));
  }

  await logActivity('Warehouses', 'Shipped Transfer', transferId, {
    entityName: `${t.fromWarehouseName} → ${t.toWarehouseName}`, actionLabel: 'Shipped stock transfer',
  });
  notifyUsers(await usersByRole('Warehouse'), NotificationType.INVENTORY_UPDATED, 'Stock transfer shipped',
    `Transfer ${transferId} shipped from ${t.fromWarehouseName} to ${t.toWarehouseName}.`, 'stock', transferId, companyId);

  return { transferId, alreadyShipped: false as const, applied: batch.applied };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * C. Receive transfer — TRANSFER_IN at destination for the qty that ARRIVED
 * ────────────────────────────────────────────────────────────────────────── */

function inInputs(
  t: StockTransferRecord,
  companyId: string,
  receivedByProduct: Map<string, number>,
): StockMovementInput[] {
  const inputs: StockMovementInput[] = [];
  for (const line of t.items) {
    const received = receivedByProduct.get(line.productId) ?? Number(line.shippedQty ?? line.qty);
    if (received <= EPSILON) continue; // nothing arrived for this line
    inputs.push({
      movementType: 'TRANSFER_IN' as const,
      productId: line.productId,
      warehouseId: t.toWarehouseId,
      qty: received,
      unit: String(line.unit || 'PCS'),
      sourceType: 'transfer',
      sourceId: t.id,
      lineKey: line.productId,
      companyId,
      actorId: actor(),
      notes: `Warehouse transfer ${t.id} received at ${t.toWarehouseName}`,
      ledgerExtra: {
        referenceType: 'StockTransfer', referenceId: t.id, transferId: t.id,
        product: line.product, warehouse: t.toWarehouseName,
        transferFromWarehouseId: t.fromWarehouseId, transferToWarehouseId: t.toWarehouseId,
      },
    });
  }
  return inputs;
}

export async function receiveTransfer(
  transferId: string,
  receivedQuantities?: Record<string, number>,
) {
  if (!canDo('edit', 'stock')) throw new Error('You do not have permission to receive a stock transfer');
  const t = await getOne<StockTransferRecord>(COLLECTIONS.STOCK_TRANSFERS, transferId);
  if (!t) throw new Error(`Transfer ${transferId} not found`);
  if (t.status === 'received') return { transferId, alreadyReceived: true as const };
  if (t.status !== 'in_transit') throw new Error(`Only an in-transit transfer can be received (this one is '${t.status}')`);

  const companyId = String(t.companyId || resolveWorkflowCompanyId() || '');
  const nowIso = new Date().toISOString();
  const actorId = actor();

  // Per-line received qty: explicit override, else the full shipped qty.
  const receivedByProduct = new Map<string, number>();
  for (const line of t.items) {
    const shipped = Number(line.shippedQty ?? line.qty) || 0;
    const raw = receivedQuantities?.[line.productId];
    const received = raw === undefined ? shipped : Number(raw);
    if (!Number.isFinite(received) || received < 0) throw new Error(`Invalid received quantity for ${line.product || line.productId}`);
    if (received > shipped + EPSILON) throw new Error(`Received quantity for ${line.product || line.productId} (${received}) exceeds the shipped quantity (${shipped})`);
    receivedByProduct.set(line.productId, received);
  }

  const receivedItems = t.items.map((it) => {
    const shipped = Number(it.shippedQty ?? it.qty) || 0;
    return { ...it, shippedQty: shipped, receivedQty: receivedByProduct.get(it.productId) ?? shipped };
  });
  const shortfallQty = receivedItems.reduce((n, it) => n + Math.max(0, Number(it.shippedQty) - Number(it.receivedQty)), 0);
  const patch = {
    status: 'received', receivedBy: actorId, receivedAt: nowIso, items: receivedItems,
    hasShortfall: shortfallQty > EPSILON, shortfallQty,
    updatedBy: actorId, updatedAt: nowIso,
  };

  const inputs = inInputs(t, companyId, receivedByProduct);
  let batch;
  if (inputs.length) {
    batch = await applyStockMovements(
      inputs,
      transferParticipant({ transferId, requiredStatus: 'in_transit', targetStatus: 'received', patch }),
    );
    if (batch.skipped) return { transferId, alreadyReceived: true as const };
    if (!batch.applied) {
      await updateDocById(COLLECTIONS.STOCK_TRANSFERS, transferId, sanitizeFirestoreData(patch));
    }
  } else {
    // Nothing arrived at all — no TRANSFER_IN, still finalise the doc.
    await updateDocById(COLLECTIONS.STOCK_TRANSFERS, transferId, sanitizeFirestoreData(patch));
  }

  await logActivity('Warehouses', 'Received Transfer', transferId, {
    entityName: `${t.fromWarehouseName} → ${t.toWarehouseName}`,
    actionLabel: shortfallQty > EPSILON ? `Received stock transfer (short ${shortfallQty})` : 'Received stock transfer',
    shortfallQty,
  });
  notifyUsers(await usersByRole('Warehouse'), NotificationType.INVENTORY_UPDATED, 'Stock transfer received',
    `Transfer ${transferId} received at ${t.toWarehouseName}${shortfallQty > EPSILON ? ` (short ${shortfallQty} — reconcile the loss)` : ''}.`,
    'stock', transferId, companyId);

  return { transferId, alreadyReceived: false as const, shortfallQty };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * D. Cancel transfer
 * ────────────────────────────────────────────────────────────────────────── */

export async function cancelTransfer(transferId: string, reason = '') {
  if (!canDo('edit', 'stock')) throw new Error('You do not have permission to cancel a stock transfer');
  const t = await getOne<StockTransferRecord>(COLLECTIONS.STOCK_TRANSFERS, transferId);
  if (!t) throw new Error(`Transfer ${transferId} not found`);
  if (t.status === 'cancelled') return { transferId, alreadyCancelled: true as const };
  if (t.status === 'received') throw new Error('A received transfer cannot be cancelled');

  const companyId = String(t.companyId || resolveWorkflowCompanyId() || '');
  const nowIso = new Date().toISOString();
  const actorId = actor();
  const patch = { status: 'cancelled', cancelledBy: actorId, cancelledAt: nowIso, cancellationReason: reason || '', updatedBy: actorId, updatedAt: nowIso };

  if (t.status === 'draft') {
    // No stock ever moved — just flip the doc.
    await updateDocById(COLLECTIONS.STOCK_TRANSFERS, transferId, sanitizeFirestoreData(patch));
  } else {
    // in_transit → compensating TRANSFER_IN back to the SOURCE warehouse
    // (INVENTORY-08 §8). Deterministic key `TRANSFER_IN:transfer_cancel:{id}:{pid}`
    // → a retried cancel restores the stock at most once.
    const reverseInputs: StockMovementInput[] = t.items.map((line) => ({
      movementType: 'TRANSFER_IN' as const,
      productId: line.productId,
      warehouseId: t.fromWarehouseId,
      qty: Number(line.shippedQty ?? line.qty),
      unit: String(line.unit || 'PCS'),
      sourceType: 'transfer_cancel',
      sourceId: t.id,
      lineKey: line.productId,
      companyId,
      actorId,
      notes: reason || `Cancelled warehouse transfer ${t.id} — stock returned to ${t.fromWarehouseName}`,
      ledgerExtra: {
        referenceType: 'StockTransferCancel', referenceId: t.id, transferId: t.id,
        product: line.product, warehouse: t.fromWarehouseName,
        transferFromWarehouseId: t.fromWarehouseId, transferToWarehouseId: t.toWarehouseId,
      },
    }));
    const batch = await applyStockMovements(
      reverseInputs,
      transferParticipant({ transferId, requiredStatus: 'in_transit', targetStatus: 'cancelled', patch }),
    );
    if (batch.skipped) return { transferId, alreadyCancelled: true as const };
    if (!batch.applied) {
      await updateDocById(COLLECTIONS.STOCK_TRANSFERS, transferId, sanitizeFirestoreData(patch));
    }
  }

  await logActivity('Warehouses', 'Cancelled Transfer', transferId, {
    entityName: `${t.fromWarehouseName} → ${t.toWarehouseName}`, actionLabel: 'Cancelled stock transfer', reason,
  });
  notifyUsers(await usersByRole('Warehouse'), NotificationType.INVENTORY_UPDATED, 'Stock transfer cancelled',
    `Transfer ${transferId} was cancelled${t.status === 'in_transit' ? ' and shipped stock was returned to the source warehouse' : ''}.`,
    'stock', transferId, companyId);

  return { transferId, alreadyCancelled: false as const, reversed: t.status === 'in_transit' };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Read helpers
 * ────────────────────────────────────────────────────────────────────────── */

export async function listTransfers(): Promise<StockTransferRecord[]> {
  const rows = await getAll<StockTransferRecord>(COLLECTIONS.STOCK_TRANSFERS).catch(() => []);
  return rows
    .filter((r) => r.isDeleted !== true)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
