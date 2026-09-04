/**
 * INVENTORY-10 (§10e) — customer return / RMA.
 *
 * A `customer_returns/{RET-*}` doc links back to the original order + dispatch
 * it returns from. Every line's physical restock (`SALES_RETURN_IN`) — and,
 * for a damaged-condition line, the immediate write-off (`DAMAGE_OUT`) that
 * follows it — goes through the SAME movement-engine batch as the doc's own
 * creation (a `MovementParticipant`), so the return document can never exist
 * without its stock effect committing, and vice versa (mirrors the GRN /
 * transfer / reservation participant pattern — the engine stays the sole
 * `stock` / `stock_ledger` writer).
 */
import { getOne, resolveWriteGroupId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { logActivity, resolveWorkflowCompanyId, type WorkflowRecord } from '../../../lib/workflow';
import { applyStockMovements } from '../../../lib/inventory/stockMovementEngine';
import { DAMAGE_REASON_CODES, type DamageReasonCode } from './stockOperationsWorkflow';
import type { MovementParticipant, StockMovementInput } from '../../../lib/inventory/types';

const EPSILON = 1e-6;

export type ReturnCondition = 'resellable' | 'damaged';

export interface CustomerReturnItemInput {
  productId: string;
  qty: number;
  condition: ReturnCondition;
  /** Required when `condition === 'damaged'`. */
  damageReasonCode?: DamageReasonCode;
}

export interface CreateCustomerReturnInput {
  orderId: string;
  dispatchId: string;
  items: CustomerReturnItemInput[];
  notes?: string;
}

export interface CustomerReturnRecord {
  id: string;
  companyId: string;
  groupId?: string;
  orderId: string;
  dispatchId: string;
  warehouseId: string;
  warehouseName?: string;
  items: Array<{
    productId: string; product?: string; qty: number; unit: string;
    condition: ReturnCondition; damageReasonCode?: DamageReasonCode;
  }>;
  notes?: string;
  status: 'processed';
  createdBy: string;
  createdAt: string;
  isDeleted?: boolean;
}

function returnParticipant(record: CustomerReturnRecord): MovementParticipant<WorkflowRecord | null> {
  return {
    async read(rc) {
      return rc.get<WorkflowRecord>(COLLECTIONS.CUSTOMER_RETURNS, record.id);
    },
    validate(existing) {
      if (existing) return false; // idempotent retry of the SAME return id — benign no-op
    },
    commit(_existing, _plan, writer) {
      writer.set(COLLECTIONS.CUSTOMER_RETURNS, record.id, record as unknown as Record<string, unknown>);
    },
  };
}

/**
 * §10e — process a customer return against a specific dispatched order line.
 * Every line restocks physically (`SALES_RETURN_IN`); a `damaged`-condition
 * line is ADDITIONALLY written off immediately (`DAMAGE_OUT`) — both in the
 * SAME atomic batch as the `customer_returns` doc itself.
 */
export async function createCustomerReturn(input: CreateCustomerReturnInput, returnId: string): Promise<CustomerReturnRecord> {
  if (!input.orderId) throw new Error('An order is required');
  if (!input.dispatchId) throw new Error('A dispatch is required');
  if (!input.items?.length) throw new Error('A return needs at least one line');

  const state = useAppStore.getState();
  const companyId = resolveWorkflowCompanyId();
  const groupId = resolveWriteGroupId(companyId);
  const actorId = state.user?.id || 'system';

  const [order, dispatch] = await Promise.all([
    getOne<WorkflowRecord & { id: string }>(COLLECTIONS.ORDERS, input.orderId),
    getOne<WorkflowRecord & { id: string; items?: Array<{ productId?: string; product?: string; verifiedQty?: number; unit?: string }> }>(COLLECTIONS.DISPATCH, input.dispatchId),
  ]);
  if (!order || order.isDeleted === true) throw new Error(`Order ${input.orderId} not found`);
  if (!dispatch || dispatch.isDeleted === true) throw new Error(`Dispatch ${input.dispatchId} not found`);
  if (String(dispatch.orderId || '') !== input.orderId) throw new Error(`Dispatch ${input.dispatchId} does not belong to order ${input.orderId}`);
  if (companyId && dispatch.companyId && dispatch.companyId !== companyId) throw new Error('Dispatch belongs to a different company');
  const warehouseId = String(dispatch.warehouseId || '');
  if (!warehouseId) throw new Error('Dispatch has no warehouse');

  const dispatchLineByProduct = new Map((dispatch.items || []).map((it) => [String(it.productId || ''), it]));

  const items: CustomerReturnRecord['items'] = [];
  const inputs: StockMovementInput[] = [];
  for (const line of input.items) {
    const productId = String(line.productId || '').trim();
    const qty = Number(line.qty);
    if (!productId) throw new Error('Every return line must reference a product');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Return quantity for ${productId} must be greater than zero`);
    if (line.condition !== 'resellable' && line.condition !== 'damaged') throw new Error(`Invalid condition for ${productId}`);
    const dispatchLine = dispatchLineByProduct.get(productId);
    if (!dispatchLine) throw new Error(`Product ${productId} was not part of dispatch ${input.dispatchId}`);
    const dispatchedQty = Number(dispatchLine.verifiedQty) || 0;
    if (qty > dispatchedQty + EPSILON) {
      throw new Error(`Return quantity for ${dispatchLine.product || productId} (${qty}) exceeds the dispatched quantity (${dispatchedQty})`);
    }
    if (line.condition === 'damaged' && !line.damageReasonCode) {
      throw new Error(`A damage reason is required for the damaged line: ${dispatchLine.product || productId}`);
    }
    if (line.condition === 'damaged' && !DAMAGE_REASON_CODES.includes(line.damageReasonCode as DamageReasonCode)) {
      throw new Error(`Reason must be one of: ${DAMAGE_REASON_CODES.join(', ')}`);
    }
    const unit = String(dispatchLine.unit || 'PCS');

    items.push({ productId, product: dispatchLine.product, qty, unit, condition: line.condition, damageReasonCode: line.damageReasonCode });

    // Leg 1 — the physical goods ARE back in the warehouse, regardless of condition.
    inputs.push({
      movementType: 'SALES_RETURN_IN',
      productId, warehouseId, qty, unit,
      sourceType: 'customer_return',
      sourceId: returnId,
      lineKey: productId,
      companyId, actorId,
      notes: `Customer return ${returnId} for order ${input.orderId}`,
      ledgerExtra: {
        referenceType: 'CustomerReturn', referenceId: returnId, orderId: input.orderId, dispatchId: input.dispatchId,
        product: dispatchLine.product, warehouse: dispatch.warehouse, returnCondition: line.condition,
      },
    });

    // Leg 2 — damaged-condition stock is unsellable; write it off immediately.
    if (line.condition === 'damaged') {
      inputs.push({
        movementType: 'DAMAGE_OUT',
        productId, warehouseId, qty, unit,
        sourceType: 'customer_return_damage',
        sourceId: returnId,
        lineKey: productId,
        companyId, actorId,
        reasonCode: line.damageReasonCode!,
        notes: `Damaged on return — ${returnId}`,
        ledgerExtra: {
          referenceType: 'CustomerReturnDamage', referenceId: returnId, orderId: input.orderId, dispatchId: input.dispatchId,
          product: dispatchLine.product, warehouse: dispatch.warehouse,
        },
      });
    }
  }

  const record: CustomerReturnRecord = {
    id: returnId, companyId, ...(groupId ? { groupId } : {}), orderId: input.orderId, dispatchId: input.dispatchId,
    warehouseId, warehouseName: String(dispatch.warehouse || ''), items, notes: input.notes || '',
    status: 'processed', createdBy: actorId, createdAt: new Date().toISOString(), isDeleted: false,
  };

  await applyStockMovements(inputs, returnParticipant(record));

  await logActivity('Stock', 'Customer Return', returnId, {
    orderId: input.orderId, dispatchId: input.dispatchId, entityName: `Return for order ${input.orderId}`,
    actionLabel: `Processed customer return (${items.length} line${items.length === 1 ? '' : 's'})`,
  });

  return record;
}
