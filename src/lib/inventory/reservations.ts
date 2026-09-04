/**
 * INVENTORY-07 — Sales reservation participants + helpers.
 *
 * The `stock_reservations` collection is written ONLY as a `MovementParticipant`
 * inside `applyStockMovements`' single Firestore transaction — never by a
 * hand-rolled client write. That is the atomicity guarantee (Plan §07 D): a
 * reservation doc can never become active without its `SALES_RESERVE` stock
 * movement committing, and vice-versa. The engine stays the sole writer of
 * `stock` / `stock_ledger`; the participant's `MovementWriter` may touch only
 * `stock_reservations` (+ the order / dispatch doc for their own flows).
 */

import { getAll } from '../firestore';
import { COLLECTIONS } from '../firebase';
import type { MovementParticipant, MovementPlanEntry, MovementWriter, StockMovementInput } from './types';
import {
  reservationDocId, reservationRemainder, reservationStatusFor,
  type StockReservationRecord,
} from './reservationConfig';

export { reservationDocId, reservationRemainder, reservationStatusFor };
export type { StockReservationRecord };

export const RESERVATIONS = COLLECTIONS.STOCK_RESERVATIONS;

/** Per-line context needed to build a `stock_reservations` doc for a reserve. */
export interface ReserveLineMeta {
  orderLineKey: string;
  productId: string;
  warehouseId: string;
  unit: string;
  qtyRequested: number;
}

export interface ReserveParticipantContext {
  companyId: string;
  groupId: string;
  orderId: string;
  piId: string;
  actorId: string;
  nowIso: string;
  /** keyed by the SALES_RESERVE idempotency key. */
  metaByKey: Map<string, ReserveLineMeta>;
}

type RsvSnapshot = Record<string, unknown> | null;

/**
 * Build the `SALES_RESERVE` movement inputs for one paid PI — one per order
 * line that still needs a reservation. `clampToStock` makes each line reserve
 * only what its summary can support (partial reservation, Plan §07 decision 4);
 * the caller reads the granted amount back from `result.reservedAfter −
 * result.reservedBefore` and records any shortfall on the order.
 */
export function buildReserveInputs(opts: {
  companyId: string;
  actorId: string;
  orderId: string;
  piId: string;
  warehouseId: string;
  lines: Array<{ orderLineKey: string; productId: string; unit: string; qty: number; productName?: string }>;
  reservationsEnabled?: boolean;
}): { inputs: StockMovementInput[]; metaByKey: Map<string, ReserveLineMeta> } {
  const inputs: StockMovementInput[] = [];
  const metaByKey = new Map<string, ReserveLineMeta>();
  for (const line of opts.lines) {
    const productId = String(line.productId || '').trim();
    const qty = Number(line.qty) || 0;
    if (!productId || qty <= 0) continue;
    const lineKey = String(line.orderLineKey || productId);
    const idempotencyKey = `SALES_RESERVE:proforma_invoice:${opts.piId}:${lineKey}`;
    const unit = String(line.unit || 'PCS');
    metaByKey.set(idempotencyKey, { orderLineKey: lineKey, productId, warehouseId: opts.warehouseId, unit, qtyRequested: qty });
    inputs.push({
      movementType: 'SALES_RESERVE',
      productId,
      warehouseId: opts.warehouseId,
      qty,
      unit,
      sourceType: 'proforma_invoice',
      sourceId: opts.piId,
      lineKey,
      idempotencyKey,
      companyId: opts.companyId,
      actorId: opts.actorId,
      clampToStock: true,
      ...(opts.reservationsEnabled !== undefined ? { reservationsEnabled: opts.reservationsEnabled } : {}),
      ledgerExtra: {
        referenceType: 'ProformaInvoice',
        referenceId: opts.piId,
        orderId: opts.orderId,
        ...(line.productName ? { product: line.productName } : {}),
      },
    });
  }
  return { inputs, metaByKey };
}

/** productId -> FIFO reservation doc ids, from a set of reservation records. */
export function docIdsByProduct(reservations: StockReservationRecord[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of reservations) {
    const pid = String(r.productId || '');
    const arr = map.get(pid) || [];
    arr.push(r.id);
    map.set(pid, arr);
  }
  return map;
}

/**
 * `SALES_RELEASE` inputs that CONSUME reservation during a verified dispatch —
 * one per line that has an active reservation. `qty` is
 * `min(verifiedQty, Σ remainder for that product on the order)`; `clampToStock`
 * caps it again at the live `reservedQty` (stale-safe). Lines with no
 * reservation produce nothing (pre-07 orders dispatch normally).
 */
export function buildDispatchConsumeInputs(opts: {
  companyId: string;
  actorId: string;
  dispatchId: string;
  orderId: string;
  warehouseId: string;
  warehouseName?: string;
  verifiedLines: Array<{ productId: string; unit?: string; verifiedQty: number; productName?: string }>;
  reservations: StockReservationRecord[];
  reservationsEnabled?: boolean;
}): StockMovementInput[] {
  const remainderByProduct = new Map<string, number>();
  for (const r of opts.reservations) {
    const pid = String(r.productId || '');
    remainderByProduct.set(pid, (remainderByProduct.get(pid) || 0) + reservationRemainder(r));
  }
  const inputs: StockMovementInput[] = [];
  for (const line of opts.verifiedLines) {
    const productId = String(line.productId || '').trim();
    const verified = Number(line.verifiedQty) || 0;
    if (!productId || verified <= 0) continue;
    const rem = remainderByProduct.get(productId) || 0;
    const consume = Math.min(verified, rem);
    if (consume <= 1e-6) continue;
    inputs.push({
      movementType: 'SALES_RELEASE',
      productId,
      warehouseId: opts.warehouseId,
      qty: consume,
      unit: String(line.unit || 'PCS'),
      sourceType: 'dispatch_consume',
      sourceId: String(opts.dispatchId),
      lineKey: productId,
      idempotencyKey: `SALES_RELEASE:dispatch_consume:${opts.dispatchId}:${productId}`,
      companyId: opts.companyId,
      actorId: opts.actorId,
      clampToStock: true,
      ...(opts.reservationsEnabled !== undefined ? { reservationsEnabled: opts.reservationsEnabled } : {}),
      ledgerExtra: {
        referenceType: 'Dispatch', referenceId: String(opts.dispatchId), orderId: opts.orderId, reservationConsumption: true,
        ...(line.productName ? { product: line.productName } : {}),
        ...(opts.warehouseName ? { warehouse: opts.warehouseName } : {}),
      },
    });
  }
  return inputs;
}

/**
 * `SALES_RELEASE` inputs that release the UNCONSUMED remainder of every active
 * reservation on a cancelled order — aggregated per product. Physical stock
 * already dispatched is restored separately by `SALES_RETURN_IN` (no double
 * count). `clampToStock` keeps it stale-safe + idempotent.
 */
export function buildCancelReleaseInputs(opts: {
  companyId: string;
  actorId: string;
  orderId: string;
  reservations: StockReservationRecord[];
  reservationsEnabled?: boolean;
  reason?: string;
}): StockMovementInput[] {
  const byProduct = new Map<string, { qty: number; warehouseId: string; unit: string }>();
  for (const r of opts.reservations) {
    const rem = reservationRemainder(r);
    if (rem <= 1e-6) continue;
    const pid = String(r.productId || '');
    const cur = byProduct.get(pid) || { qty: 0, warehouseId: String(r.warehouseId || ''), unit: String(r.unit || 'PCS') };
    cur.qty += rem;
    byProduct.set(pid, cur);
  }
  const inputs: StockMovementInput[] = [];
  for (const [productId, v] of byProduct) {
    if (v.qty <= 1e-6 || !v.warehouseId) continue;
    inputs.push({
      movementType: 'SALES_RELEASE',
      productId,
      warehouseId: v.warehouseId,
      qty: v.qty,
      unit: v.unit,
      sourceType: 'order_cancel',
      sourceId: String(opts.orderId),
      lineKey: productId,
      idempotencyKey: `SALES_RELEASE:order_cancel:${opts.orderId}:${productId}`,
      companyId: opts.companyId,
      actorId: opts.actorId,
      clampToStock: true,
      ...(opts.reservationsEnabled !== undefined ? { reservationsEnabled: opts.reservationsEnabled } : {}),
      notes: opts.reason || `Reservation released for cancelled order ${opts.orderId}`,
      ledgerExtra: { referenceType: 'OrderCancel', referenceId: String(opts.orderId), reservationRelease: true },
    });
  }
  return inputs;
}

/**
 * Participant for the reserve-on-PI-paid flow: creates ONE `stock_reservations`
 * doc per applied `SALES_RESERVE` entry, atomically with the movement.
 */
export function reserveParticipant(ctx: ReserveParticipantContext): MovementParticipant<Map<string, RsvSnapshot>> {
  const keys = Array.from(ctx.metaByKey.keys()).map((k) => reservationDocId(k));
  return {
    async read(rc) {
      const map = new Map<string, RsvSnapshot>();
      for (const id of keys) map.set(id, await rc.get(RESERVATIONS, id));
      return map;
    },
    commit(existingById, plan, writer) {
      for (const entry of plan) {
        if (!entry.applied || entry.direction !== 'RESERVE') continue;
        const meta = ctx.metaByKey.get(entry.idempotencyKey);
        if (!meta) continue;
        const rsvId = reservationDocId(entry.idempotencyKey);
        if (existingById.get(rsvId)) continue; // already recorded (defensive)
        const granted = Math.max(0, entry.reservedAfter - entry.reservedBefore);
        const doc: StockReservationRecord = {
          id: rsvId,
          companyId: ctx.companyId,
          ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
          orderId: ctx.orderId,
          orderLineKey: meta.orderLineKey,
          productId: meta.productId,
          warehouseId: meta.warehouseId,
          unit: meta.unit,
          qtyRequested: meta.qtyRequested,
          qtyReserved: granted,
          qtyConsumed: 0,
          qtyReleased: 0,
          status: 'active',
          piId: ctx.piId,
          idempotencyKey: entry.idempotencyKey,
          createdAt: ctx.nowIso,
          createdBy: ctx.actorId,
          updatedAt: ctx.nowIso,
          updatedBy: ctx.actorId,
          lastMovementAt: ctx.nowIso,
          lastMovementLedgerId: entry.ledgerId,
          isDeleted: false,
        };
        writer.set(RESERVATIONS, rsvId, doc as unknown as Record<string, unknown>);
      }
    },
  };
}

/**
 * Participant that ONLY updates `stock_reservations` docs (qtyConsumed /
 * qtyReleased / status) to match the actually-applied SALES_RELEASE entries of a
 * batch — used by the cancel-release flow (the order/dispatch status flip is a
 * separate Phase-04 transaction). Reads each reservation doc for in-txn
 * authority; writes nothing else.
 */
export function reservationUpdateParticipant(opts: {
  reservations: StockReservationRecord[];
  mode: 'consume' | 'release';
  matchSourceType: string;
  actorId: string;
  nowIso: string;
}): MovementParticipant<Map<string, RsvSnapshot>> {
  const ids = opts.reservations.map((r) => r.id);
  return {
    async read(rc) {
      const map = new Map<string, RsvSnapshot>();
      for (const id of ids) map.set(id, await rc.get(RESERVATIONS, id));
      return map;
    },
    commit(snapshotById, plan, writer) {
      applyReservationDelta({
        plan, snapshotById, docIdsByProduct: docIdsByProduct(opts.reservations),
        writer, mode: opts.mode, actorId: opts.actorId, nowIso: opts.nowIso,
        matchSourceType: opts.matchSourceType,
      });
    },
  };
}

/**
 * READ active `stock_reservations` for an order (remainder > 0), newest-first,
 * grouped by productId. Used to size the dispatch consume + cancel release.
 */
export async function fetchOrderReservations(orderId: string): Promise<StockReservationRecord[]> {
  if (!orderId) return [];
  const { where } = await import('firebase/firestore');
  const rows = await getAll<StockReservationRecord>(RESERVATIONS, [where('orderId', '==', orderId)]).catch(() => []);
  return rows
    .filter((r) => r.isDeleted !== true)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/**
 * Distribute an actually-applied reservation delta (`consumed` or `released`)
 * across a product's reservation docs FIFO, and enqueue the doc updates through
 * `writer`. `mode` selects which counter moves.
 */
export function applyReservationDelta(opts: {
  plan: readonly MovementPlanEntry[];
  /** rsv doc id -> authoritative in-txn snapshot (from participant.read). */
  snapshotById: Map<string, RsvSnapshot>;
  /** productId -> reservation doc ids for this order, FIFO order. */
  docIdsByProduct: Map<string, string[]>;
  writer: MovementWriter;
  mode: 'consume' | 'release';
  actorId: string;
  nowIso: string;
  /** SALES_RELEASE entries whose sourceType marks them as this flow's. */
  matchSourceType: string;
}): void {
  const { plan, snapshotById, docIdsByProduct, writer, mode, actorId, nowIso } = opts;
  for (const entry of plan) {
    if (!entry.applied || entry.direction !== 'RELEASE') continue;
    if (String(entry.input.sourceType || '') !== opts.matchSourceType) continue;
    let remaining = Math.max(0, entry.reservedBefore - entry.reservedAfter);
    if (remaining <= 1e-6) continue;
    const productId = String(entry.input.lineKey || entry.input.productId || '');
    const ids = docIdsByProduct.get(productId) || [];
    for (const id of ids) {
      if (remaining <= 1e-6) break;
      const snap = snapshotById.get(id) as Partial<StockReservationRecord> | null;
      if (!snap) continue;
      const cur = {
        qtyRequested: Number(snap.qtyRequested) || 0,
        qtyReserved: Number(snap.qtyReserved) || 0,
        qtyConsumed: Number(snap.qtyConsumed) || 0,
        qtyReleased: Number(snap.qtyReleased) || 0,
      };
      const rem = reservationRemainder(cur);
      if (rem <= 1e-6) continue;
      const take = Math.min(rem, remaining);
      remaining -= take;
      const nextQtys = {
        qtyRequested: cur.qtyRequested,
        qtyReserved: cur.qtyReserved,
        qtyConsumed: mode === 'consume' ? cur.qtyConsumed + take : cur.qtyConsumed,
        qtyReleased: mode === 'release' ? cur.qtyReleased + take : cur.qtyReleased,
      };
      const status = reservationStatusFor(nextQtys);
      writer.update(RESERVATIONS, id, {
        qtyConsumed: nextQtys.qtyConsumed,
        qtyReleased: nextQtys.qtyReleased,
        status,
        updatedAt: nowIso,
        updatedBy: actorId,
        lastMovementAt: nowIso,
        lastMovementLedgerId: entry.ledgerId,
      });
      // keep the running snapshot coherent if two entries touch the same doc
      snapshotById.set(id, { ...(snap as Record<string, unknown>), ...nextQtys, status } as RsvSnapshot);
    }
  }
}
