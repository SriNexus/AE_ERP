/**
 * INVENTORY-10 (§10d) — low-stock alerts.
 *
 * Called by `stockMovementEngine.ts` AFTER a batch's transaction has already
 * committed (both the configured and demo branches) — this is a best-effort,
 * side-effect-only step: it reads `products.lowStockThreshold` and, on a
 * genuine THRESHOLD CROSSING (on-hand was above the threshold, now at or
 * below it), creates one `notifications` row for Warehouse/Procurement. A
 * failure here NEVER surfaces to the caller and NEVER re-touches `stock` /
 * `stock_ledger` — the engine's core transaction logic is untouched; this
 * runs strictly after it, exactly like every other post-movement
 * notification in this codebase (dispatch/GRN/transfer all call
 * `notifyUsers`/`notifyRoleUsers` AFTER their own engine call, never inside it).
 *
 * "Fires once per threshold crossing" (Plan §10d): re-derived fresh from
 * `onHandBefore`/`onHandAfter` on every call — no persisted "already
 * notified" flag needed. Stock that stays low across several further OUT
 * movements does NOT re-notify (before was already <= threshold); stock that
 * dips low, is topped back up, and dips low again notifies TWICE (two
 * genuine crossings) — both are the intended behavior.
 */
import { getOne } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { NotificationType } from '../../types';
import { notifyUsers, resolveWorkflowCompanyId, usersByRole, type WorkflowRecord } from '../workflow';
import type { MovementResult } from './types';

interface LowStockCandidate {
  productId: string;
  warehouseId: string;
  companyId: string;
  onHandBefore: number;
  onHandAfter: number;
}

/** Movements that can newly cross INTO low stock — only physical OUT movements
 *  reduce onHandQty; RESERVE/RELEASE never touch it, IN movements move away
 *  from low stock. */
function isOutCrossingCandidate(r: MovementResult): boolean {
  return r.applied && r.direction === 'OUT' && r.onHandAfter < r.onHandBefore;
}

export async function checkLowStockAndNotify(results: MovementResult[]): Promise<void> {
  const candidates: LowStockCandidate[] = results
    .filter(isOutCrossingCandidate)
    .map((r) => ({ productId: r.productId, warehouseId: r.warehouseId, companyId: r.companyId, onHandBefore: r.onHandBefore, onHandAfter: r.onHandAfter }));
  if (!candidates.length) return;

  for (const c of candidates) {
    try {
      const product = await getOne<WorkflowRecord & { id: string; name?: string; lowStockThreshold?: number }>(COLLECTIONS.PRODUCTS, c.productId);
      if (!product) continue;
      const threshold = Number(product.lowStockThreshold);
      if (!Number.isFinite(threshold) || threshold < 0) continue;
      const wasAboveThreshold = c.onHandBefore > threshold;
      const isAtOrBelowNow = c.onHandAfter <= threshold;
      if (!(wasAboveThreshold && isAtOrBelowNow)) continue; // not a genuine crossing

      const companyId = c.companyId || resolveWorkflowCompanyId();
      const productName = String(product.name || c.productId);
      notifyUsers(
        [...(await usersByRole('Warehouse')), ...(await usersByRole('Procurement'))],
        NotificationType.INVENTORY_UPDATED,
        'Low stock alert',
        `${productName} dropped to ${c.onHandAfter} (threshold ${threshold}) at warehouse ${c.warehouseId}.`,
        'stock',
        c.productId,
        companyId,
      );
    } catch {
      // Best-effort — a notification failure must never affect the movement
      // that already committed.
    }
  }
}
