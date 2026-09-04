/**
 * INVENTORY-05a — Stock Movement Engine (DORMANT).
 *
 * The single controlled write boundary for `stock` + `stock_ledger`
 * (Plan §4.1). Every stock-changing operation will call ONLY
 * `applyStockMovement`; direct `transaction.set(stockRef, …)` outside this
 * module becomes an anti-pattern (enforced from Phase 05d).
 *
 * **This module has NO callers yet.** Phases 05b (GRN), 05c (dispatch) and
 * 05d (manual + cancel-restore) migrate the existing workflows onto it. Until
 * then it is fully tested dead code.
 *
 * Guarantees (Plan §5, §9, §10):
 *  - ONE `runTransaction` covering the stock summary + the ledger row +
 *    the in-transaction idempotency check — never a state where stock changed
 *    but the ledger did not, or vice-versa (INV-7).
 *  - Deterministic, injective ledger doc id — a repeated invocation is a
 *    no-op that returns the prior result (INV-8).
 *  - INV-1 (`onHandQty >= 0`) and INV-2 (`reservedQty >= 0`) enforced inside
 *    the transaction; a violation aborts it with zero partial mutation.
 *  - INV-3 (`reservedQty <= onHandQty`) / INV-4 (`availableQty = onHandQty -
 *    reservedQty`) are gated behind `reservationsEnabled` (FALSE for Phases
 *    05–06: `availableQty == onHandQty`, `reservedQty` stays 0). Phase 07
 *    flips the gate.
 *  - `companyId` + `groupId` stamped manually (raw transaction bypasses
 *    `createDocWithId`/`updateDocById` auto-stamping — HR-9).
 *  - Legacy ledger fields (`type`, `referenceType`/`referenceId`, `date`)
 *    dual-written so existing `stock_ledger` consumers keep working.
 *
 * The engine's write shape satisfies the CURRENT `firestore.rules` for
 * `stock` / `stock_ledger` unchanged — proven by
 * stockMovementEngine.emulator.test.ts.
 */
import { COLLECTIONS, firebaseEnv } from '../firebase';
import { createDocWithId, genId, getAll, getOne, resolveWriteGroupId } from '../firestore';
import { sanitizeFirestoreData } from '../sanitizer';
import { useAppStore } from '../../store/useAppStore';
import { resolveStockSummaryDocumentId } from '../stockWorkflow';
import { resolveWorkflowCompanyId, stockSummaryId, type WorkflowRecord } from '../workflow';
import { buildIdempotencyKey, movementLedgerId } from './idempotency';
import {
  MOVEMENT_DIRECTION, REASON_CODE_REQUIRED,
  type MovementDirection, type MovementResult, type MovementType, type StockMovementInput,
} from './types';

const EPSILON = 1e-6;

function resolveDirection(movementType: MovementType, signedQty: number): MovementDirection {
  if (movementType === 'RECONCILE_ADJUST') return signedQty >= 0 ? 'IN' : 'OUT';
  return MOVEMENT_DIRECTION[movementType as Exclude<MovementType, 'RECONCILE_ADJUST'>];
}

/** Legacy `stock_ledger.type` value dual-written for existing consumers ('IN' | 'OUT'). */
function legacyType(direction: MovementDirection): 'IN' | 'OUT' {
  return direction === 'OUT' || direction === 'RELEASE' ? 'OUT' : 'IN';
}

interface PreparedMovement {
  companyId: string;
  groupId: string;
  actorId: string;
  direction: MovementDirection;
  absQty: number;
  idempotencyKey: string;
  ledgerId: string;
  reservationsEnabled: boolean;
}

function prepare(input: StockMovementInput): PreparedMovement {
  const state = useAppStore.getState();
  const companyId = String(input.companyId || resolveWorkflowCompanyId() || '');
  if (!companyId) throw new Error('Active company is required for a stock movement');
  const groupId = resolveWriteGroupId(companyId);
  const actorId = String(input.actorId || state.user?.id || 'system');

  if (!input.movementType) throw new Error('movementType is required');
  if (!input.productId) throw new Error('productId is required for a stock movement');
  if (!input.warehouseId) throw new Error('warehouseId is required for a stock movement');
  if (!input.sourceType || !input.sourceId) throw new Error('sourceType and sourceId are required for a stock movement');
  if (!input.unit) throw new Error('unit is required for a stock movement');

  const signedQty = Number(input.qty);
  if (!Number.isFinite(signedQty)) throw new Error('Movement quantity must be a finite number');
  const direction = resolveDirection(input.movementType, signedQty);
  const absQty = Math.abs(signedQty);
  if (absQty <= EPSILON) throw new Error('Movement quantity must be greater than zero');
  if (input.movementType !== 'RECONCILE_ADJUST' && signedQty <= 0) {
    throw new Error('Movement quantity must be greater than zero');
  }
  if (REASON_CODE_REQUIRED.includes(input.movementType) && !String(input.reasonCode || '').trim()) {
    throw new Error(`${input.movementType} requires a reasonCode`);
  }

  const idempotencyKey = String(
    input.idempotencyKey
      || buildIdempotencyKey(input.movementType, input.sourceType, input.sourceId, input.lineKey),
  );

  return {
    companyId, groupId, actorId, direction, absQty,
    idempotencyKey, ledgerId: movementLedgerId(idempotencyKey),
    reservationsEnabled: input.reservationsEnabled === true,
  };
}

function applyDelta(direction: MovementDirection, onHandBefore: number, reservedBefore: number, absQty: number) {
  let onHandAfter = onHandBefore;
  let reservedAfter = reservedBefore;
  if (direction === 'IN') onHandAfter = onHandBefore + absQty;
  else if (direction === 'OUT') onHandAfter = onHandBefore - absQty;
  else if (direction === 'RESERVE') reservedAfter = reservedBefore + absQty;
  else if (direction === 'RELEASE') reservedAfter = reservedBefore - absQty;
  return { onHandAfter, reservedAfter };
}

function assertInvariants(prep: PreparedMovement, onHandAfter: number, reservedAfter: number) {
  // INV-1 — negative on-hand is prohibited for Neozy.
  if (onHandAfter < -EPSILON) {
    throw new Error(`Insufficient stock: this ${prep.direction} movement would drive onHandQty to ${onHandAfter}`);
  }
  // INV-2 — cannot release more than is reserved.
  if (reservedAfter < -EPSILON) {
    throw new Error(`Invalid release: this movement would drive reservedQty to ${reservedAfter}`);
  }
  // INV-3 — gated behind reservationsEnabled (Phase 07). Inert in Phases 05–06.
  if (prep.reservationsEnabled && reservedAfter > onHandAfter + EPSILON) {
    throw new Error(`Over-reservation: reservedQty ${reservedAfter} would exceed onHandQty ${onHandAfter}`);
  }
}

/** `availableQty` cache. Phases 05–06: `= onHandQty` (reserved 0). Phase 07: `= onHandQty − reservedQty`. */
function deriveAvailable(prep: PreparedMovement, onHandAfter: number, reservedAfter: number): number {
  return prep.reservationsEnabled ? onHandAfter - reservedAfter : onHandAfter;
}

function buildLedgerRow(args: {
  prep: PreparedMovement;
  input: StockMovementInput;
  transactionId: string;
  dateIso: string;
  movementAt: unknown;
  createdAt: unknown;
  before: { onHand: number; reserved: number };
  after: { onHand: number; reserved: number };
}) {
  const { prep, input, before, after } = args;
  return {
    id: prep.ledgerId,
    companyId: prep.companyId,
    ...(prep.groupId ? { groupId: prep.groupId } : {}),
    productId: input.productId,
    warehouseId: input.warehouseId,
    unit: input.unit,
    movementType: input.movementType,
    direction: prep.direction,
    qty: prep.absQty,
    onHandBefore: before.onHand,
    onHandAfter: after.onHand,
    reservedBefore: before.reserved,
    reservedAfter: after.reserved,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    idempotencyKey: prep.idempotencyKey,
    ...(input.reasonCode ? { reasonCode: String(input.reasonCode) } : {}),
    actorId: prep.actorId,
    transactionId: args.transactionId,        // firestore.rules: transactionId is string
    movementAt: args.movementAt,              // firestore.rules: movementAt != null
    createdAt: args.createdAt,
    createdBy: prep.actorId,
    isDeleted: false,
    // ── legacy compatibility (dual-write during migration) ──
    type: legacyType(prep.direction),
    referenceType: input.sourceType,
    referenceId: input.sourceId,
    date: args.dateIso,
    notes: input.notes || '',
  };
}

function resultFromLedgerRow(prep: PreparedMovement, input: StockMovementInput, row: WorkflowRecord, stockId: string): MovementResult {
  const onHandBefore = Number(row.onHandBefore) || 0;
  const onHandAfter = Number(row.onHandAfter) || 0;
  const reservedBefore = Number(row.reservedBefore) || 0;
  const reservedAfter = Number(row.reservedAfter) || 0;
  return {
    applied: false,
    movementType: input.movementType,
    direction: (row.direction as MovementDirection) || prep.direction,
    stockId,
    ledgerId: prep.ledgerId,
    idempotencyKey: prep.idempotencyKey,
    productId: input.productId,
    warehouseId: input.warehouseId,
    companyId: prep.companyId,
    qty: Number(row.qty) || prep.absQty,
    onHandBefore,
    onHandAfter,
    reservedBefore,
    reservedAfter,
    availableAfter: deriveAvailable(prep, onHandAfter, reservedAfter),
  };
}

/**
 * Apply ONE stock movement. Idempotent by the deterministic ledger doc id;
 * atomic over (stock summary + ledger row). Returns `{ applied: false }` when
 * the movement was already recorded.
 */
export async function applyStockMovement(input: StockMovementInput): Promise<MovementResult> {
  const prep = prepare(input);
  const nowIso = new Date().toISOString();

  if (!firebaseEnv.isConfigured) {
    // ── Demo / non-configured branch — sequential, still idempotent. ──
    const existingLedger = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK_LEDGER, prep.ledgerId).catch(() => null);
    const matching = (await getAll<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK)).filter((row) =>
      row.companyId === prep.companyId && row.productId === input.productId && row.warehouseId === input.warehouseId);
    const stockId = resolveStockSummaryDocumentId(stockSummaryId(prep.companyId, input.productId, input.warehouseId), matching);
    if (existingLedger) return resultFromLedgerRow(prep, input, existingLedger, stockId);

    const existing = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK, stockId).catch(() => null);
    const onHandBefore = Number((existing as WorkflowRecord | null)?.onHandQty
      ?? (existing as WorkflowRecord | null)?.availableQty
      ?? (existing as WorkflowRecord | null)?.available) || 0;
    const reservedBefore = Number((existing as WorkflowRecord | null)?.reservedQty
      ?? (existing as WorkflowRecord | null)?.reserved) || 0;
    const { onHandAfter, reservedAfter } = applyDelta(prep.direction, onHandBefore, reservedBefore, prep.absQty);
    assertInvariants(prep, onHandAfter, reservedAfter);
    const availableAfter = deriveAvailable(prep, onHandAfter, reservedAfter);
    const transactionId = genId.generic('TXN');

    const summaryBase = { ...(existing || {}) };
    delete (summaryBase as WorkflowRecord).available;
    delete (summaryBase as WorkflowRecord).reserved;
    await createDocWithId(COLLECTIONS.STOCK, stockId, sanitizeFirestoreData({
      ...summaryBase,
      id: stockId, companyId: prep.companyId, ...(prep.groupId ? { groupId: prep.groupId } : {}),
      productId: input.productId, warehouseId: input.warehouseId, unit: input.unit,
      onHandQty: onHandAfter, reservedQty: reservedAfter, availableQty: availableAfter,
      updatedBy: prep.actorId, isDeleted: false,
    }));
    await createDocWithId(COLLECTIONS.STOCK_LEDGER, prep.ledgerId, sanitizeFirestoreData(buildLedgerRow({
      prep, input, transactionId, dateIso: nowIso, movementAt: nowIso, createdAt: nowIso,
      before: { onHand: onHandBefore, reserved: reservedBefore },
      after: { onHand: onHandAfter, reserved: reservedAfter },
    })));

    return {
      applied: true, movementType: input.movementType, direction: prep.direction,
      stockId, ledgerId: prep.ledgerId, idempotencyKey: prep.idempotencyKey,
      productId: input.productId, warehouseId: input.warehouseId, companyId: prep.companyId,
      qty: prep.absQty, onHandBefore, onHandAfter, reservedBefore, reservedAfter, availableAfter,
    };
  }

  // ── Configured branch — ONE runTransaction over stock + stock_ledger. ──
  const { db } = await import('../firebase');
  const { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } = await import('firebase/firestore');

  const canonicalId = stockSummaryId(prep.companyId, input.productId, input.warehouseId);
  const matches = await getDocs(query(
    collection(db, COLLECTIONS.STOCK),
    where('companyId', '==', prep.companyId),
    where('productId', '==', input.productId),
    where('warehouseId', '==', input.warehouseId),
  ));
  const active = matches.docs.filter((entry) => (entry.data() as WorkflowRecord).isDeleted !== true);
  if (active.length > 1) throw new Error('Duplicate stock summaries exist for the same company, product, and warehouse');
  const stockId = active[0]?.id || canonicalId;

  const stockRef = doc(db, COLLECTIONS.STOCK, stockId);
  const ledgerRef = doc(db, COLLECTIONS.STOCK_LEDGER, prep.ledgerId);

  const outcome = await runTransaction(db, async (transaction) => {
    const ledgerSnap = await transaction.get(ledgerRef);
    if (ledgerSnap.exists()) {
      return { applied: false as const, row: ledgerSnap.data() as WorkflowRecord };
    }
    const stockSnap = await transaction.get(stockRef);
    const existing = stockSnap.exists() ? stockSnap.data() as WorkflowRecord : null;
    const onHandBefore = Number(existing?.onHandQty ?? existing?.availableQty ?? existing?.available) || 0;
    const reservedBefore = Number(existing?.reservedQty ?? existing?.reserved) || 0;
    const { onHandAfter, reservedAfter } = applyDelta(prep.direction, onHandBefore, reservedBefore, prep.absQty);
    assertInvariants(prep, onHandAfter, reservedAfter);
    const availableAfter = deriveAvailable(prep, onHandAfter, reservedAfter);
    const transactionId = genId.generic('TXN');

    const summaryBase = { ...(existing || {}) };
    delete (summaryBase as WorkflowRecord).available;
    delete (summaryBase as WorkflowRecord).reserved;
    transaction.set(stockRef, sanitizeFirestoreData({
      ...summaryBase,
      id: stockId, companyId: prep.companyId, ...(prep.groupId ? { groupId: prep.groupId } : {}),
      productId: input.productId, warehouseId: input.warehouseId, unit: input.unit,
      onHandQty: onHandAfter, reservedQty: reservedAfter, availableQty: availableAfter,
      updatedBy: prep.actorId, updatedAt: serverTimestamp(),
      createdAt: existing?.createdAt ?? serverTimestamp(),
      isDeleted: false,
    }));
    transaction.set(ledgerRef, sanitizeFirestoreData(buildLedgerRow({
      prep, input, transactionId, dateIso: nowIso, movementAt: serverTimestamp(), createdAt: serverTimestamp(),
      before: { onHand: onHandBefore, reserved: reservedBefore },
      after: { onHand: onHandAfter, reserved: reservedAfter },
    })));

    return {
      applied: true as const,
      values: { onHandBefore, onHandAfter, reservedBefore, reservedAfter, availableAfter },
    };
  });

  if (!outcome.applied) return resultFromLedgerRow(prep, input, outcome.row, stockId);
  return {
    applied: true, movementType: input.movementType, direction: prep.direction,
    stockId, ledgerId: prep.ledgerId, idempotencyKey: prep.idempotencyKey,
    productId: input.productId, warehouseId: input.warehouseId, companyId: prep.companyId,
    qty: prep.absQty, ...outcome.values,
  };
}
