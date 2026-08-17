import { COLLECTIONS } from './firebase';
import { db } from './firebase';
import { fromDoc, resolveWriteCompanyId } from './firestore';
import { collection, getDocs, limit as firestoreLimit, orderBy, query as firestoreQuery, where, type QueryConstraint } from 'firebase/firestore';
import { useAppStore } from '../store/useAppStore';

type UnknownRecord = Record<string, unknown>;

export type InventoryMovementType =
  | 'IN'
  | 'OUT'
  | 'ADJUSTMENT'
  | 'RESERVED'
  | 'RELEASED';

export type InventoryMovementSourceType =
  | 'dispatch'
  | 'order'
  | 'manual'
  | 'return'
  | 'adjustment'
  | 'unknown';

export type InventoryMovement = {
  id: string;
  companyId?: string;
  productId?: string;
  productName?: string;
  warehouseId?: string;
  warehouseName?: string;
  qty: number;
  movementType?: InventoryMovementType;
  type?: InventoryMovementType;
  sourceType?: InventoryMovementSourceType;
  sourceId?: string;
  dispatchId?: string;
  orderId?: string;
  customerId?: string;
  customerName?: string;
  referenceType?: string;
  referenceId?: string;
  date?: string;
  createdAt?: string;
  performedBy?: string;
  workflowStep?: string;
  raw: UnknownRecord;
};

export type InventoryMovementQuery = {
  productId?: string;
  warehouseId?: string;
  dispatchId?: string;
  orderId?: string;
  customerId?: string;
  sourceType?: InventoryMovementSourceType;
  sourceId?: string;
  movementType?: InventoryMovementType;
  limit?: number;
};

export type InventoryMovementSummary = {
  totalIn: number;
  totalOut: number;
  totalAdjustment: number;
  netQty: number;
  count: number;
};

const MOVEMENT_TYPES: readonly InventoryMovementType[] = [
  'IN',
  'OUT',
  'ADJUSTMENT',
  'RESERVED',
  'RELEASED',
];

const SOURCE_TYPES: readonly InventoryMovementSourceType[] = [
  'dispatch',
  'order',
  'manual',
  'return',
  'adjustment',
  'unknown',
];

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
};

const numberValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const normalizeMovementType = (value: unknown): InventoryMovementType | undefined => {
  const normalized = stringValue(value)?.toUpperCase();
  return MOVEMENT_TYPES.includes(normalized as InventoryMovementType)
    ? normalized as InventoryMovementType
    : undefined;
};

const normalizeSourceType = (value: unknown): InventoryMovementSourceType | undefined => {
  const normalized = stringValue(value)?.toLowerCase();
  if (!normalized) return undefined;

  if (normalized.includes('dispatch')) return 'dispatch';
  if (normalized.includes('order')) return 'order';
  if (normalized.includes('manual')) return 'manual';
  if (normalized.includes('return')) return 'return';
  if (normalized.includes('adjust')) return 'adjustment';

  return SOURCE_TYPES.includes(normalized as InventoryMovementSourceType)
    ? normalized as InventoryMovementSourceType
    : 'unknown';
};

const dateMs = (movement: InventoryMovement): number => {
  const candidate = movement.date || movement.createdAt || stringValue(movement.raw.updatedAt);
  if (!candidate) return 0;

  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const matchesString = (actual: string | undefined, expected: string | undefined): boolean =>
  !expected || actual === expected;

const matchesQuery = (movement: InventoryMovement, query: InventoryMovementQuery): boolean => {
  if (!matchesString(movement.productId, query.productId)) return false;
  if (!matchesString(movement.warehouseId, query.warehouseId)) return false;
  if (!matchesString(movement.dispatchId, query.dispatchId)) return false;
  if (!matchesString(movement.orderId, query.orderId)) return false;
  if (!matchesString(movement.customerId, query.customerId)) return false;
  if (!matchesString(movement.sourceId, query.sourceId)) return false;
  if (query.sourceType && movement.sourceType !== query.sourceType) return false;
  if (query.movementType && movement.movementType !== query.movementType) return false;
  return true;
};

export function normalizeStockLedgerMovement(record: unknown): InventoryMovement {
  const data = asRecord(record);
  const referenceType = stringValue(data.referenceType);
  const referenceId = stringValue(data.referenceId);
  const sourceType = normalizeSourceType(data.sourceType) || normalizeSourceType(referenceType) || 'unknown';
  const sourceId = stringValue(data.sourceId) || referenceId;
  const type = normalizeMovementType(data.type) || normalizeMovementType(data.movementType);
  const movementType = normalizeMovementType(data.movementType) || type;

  return {
    id: stringValue(data.id) || '',
    companyId: stringValue(data.companyId),
    productId: stringValue(data.productId),
    productName: stringValue(data.productName) || stringValue(data.product) || stringValue(data.name),
    warehouseId: stringValue(data.warehouseId),
    warehouseName: stringValue(data.warehouseName) || stringValue(data.warehouse),
    qty: numberValue(data.qty ?? data.quantity),
    movementType,
    type,
    sourceType,
    sourceId,
    dispatchId:
      stringValue(data.dispatchId) ||
      (sourceType === 'dispatch' ? sourceId : undefined),
    orderId:
      stringValue(data.orderId) ||
      (sourceType === 'order' ? sourceId : undefined),
    customerId: stringValue(data.customerId),
    customerName: stringValue(data.customerName) || stringValue(data.customer),
    referenceType,
    referenceId,
    date: stringValue(data.date),
    createdAt: stringValue(data.createdAt),
    performedBy: stringValue(data.performedBy),
    workflowStep: stringValue(data.workflowStep),
    raw: data,
  };
}

export async function getInventoryMovements(
  query: InventoryMovementQuery = {}
): Promise<InventoryMovement[]> {
  const constraints: QueryConstraint[] = [where('isDeleted', '==', false)];
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  if (companyId) constraints.push(where('companyId', '==', companyId));
  if (query.productId) constraints.push(where('productId', '==', query.productId));
  if (query.warehouseId) constraints.push(where('warehouseId', '==', query.warehouseId));
  if (query.dispatchId) constraints.push(where('dispatchId', '==', query.dispatchId));
  if (query.orderId) constraints.push(where('orderId', '==', query.orderId));
  if (query.customerId) constraints.push(where('customerId', '==', query.customerId));
  if (query.sourceType) constraints.push(where('sourceType', '==', query.sourceType));
  if (query.sourceId) constraints.push(where('sourceId', '==', query.sourceId));
  if (query.movementType) constraints.push(where('movementType', '==', query.movementType));

  constraints.push(orderBy('createdAt', 'desc'));
  if (Number.isFinite(query.limit) && query.limit && query.limit > 0) {
    constraints.push(firestoreLimit(query.limit));
  }

  const snap = await getDocs(firestoreQuery(collection(db, COLLECTIONS.STOCK_LEDGER), ...constraints));
  const movements = snap.docs
    .map((doc) => fromDoc<UnknownRecord>(doc as any))
    .map(normalizeStockLedgerMovement)
    .filter((movement) => matchesQuery(movement, query))
    .sort((a, b) => dateMs(b) - dateMs(a));

  if (!Number.isFinite(query.limit) || !query.limit || query.limit <= 0) {
    return movements;
  }

  return movements.slice(0, query.limit);
}

export const getMovementsByProduct = (
  productId: string,
  limit?: number
): Promise<InventoryMovement[]> =>
  getInventoryMovements({ productId, limit });

export const getMovementsByWarehouse = (
  warehouseId: string,
  limit?: number
): Promise<InventoryMovement[]> =>
  getInventoryMovements({ warehouseId, limit });

export const getMovementsByDispatch = (
  dispatchId: string,
  limit?: number
): Promise<InventoryMovement[]> =>
  getInventoryMovements({ dispatchId, limit });

export const getMovementsByOrder = (
  orderId: string,
  limit?: number
): Promise<InventoryMovement[]> =>
  getInventoryMovements({ orderId, limit });

export const getMovementsByCustomer = (
  customerId: string,
  limit?: number
): Promise<InventoryMovement[]> =>
  getInventoryMovements({ customerId, limit });

export function summarizeMovements(movements: InventoryMovement[]): InventoryMovementSummary {
  return movements.reduce<InventoryMovementSummary>(
    (summary, movement) => {
      const qty = Number.isFinite(movement.qty) ? movement.qty : 0;

      if (movement.movementType === 'IN' || movement.type === 'IN') {
        summary.totalIn += qty;
        summary.netQty += qty;
      } else if (movement.movementType === 'OUT' || movement.type === 'OUT') {
        summary.totalOut += qty;
        summary.netQty -= qty;
      } else if (movement.movementType === 'ADJUSTMENT' || movement.type === 'ADJUSTMENT') {
        summary.totalAdjustment += qty;
        summary.netQty += qty;
      }

      summary.count += 1;
      return summary;
    },
    {
      totalIn: 0,
      totalOut: 0,
      totalAdjustment: 0,
      netQty: 0,
      count: 0,
    }
  );
}
