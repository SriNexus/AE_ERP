import { createDocWithId, updateDocById, genId, getOne, resolveWriteCompanyId, resolveWriteGroupId } from './firestore';
import { COLLECTIONS, firebaseEnv } from './firebase';
import { sanitizeFirestoreData } from './sanitizer';
import { useAppStore } from '../store/useAppStore';
import { NotificationType } from '../types';
import { canDo } from './permissions';
import { generateDeliveryOTP, hashOTP, isDispatchImmutable, logActivity, notifyUsers, resolveWorkflowCompanyId, text, timestampMillis, usersByRole, type WorkflowRecord } from './workflow';
import { propagateCaseIdFromChain } from './casePropagation';
import { buildProjectStageAdvancePatch } from './projectLifecycle';
import { applyStockMovements } from './inventory/stockMovementEngine';
import { buildIdempotencyKey, movementLedgerId } from './inventory/idempotency';
import { isReservationsEnabled } from './inventory/reservationConfig';
import { normalizeSerial, dispatchSerialLockId, lockHeldByAnotherDispatch, type DispatchSerialLockDoc } from './inventory/serialLock';
import {
  applyReservationDelta, buildDispatchConsumeInputs, docIdsByProduct, fetchOrderReservations,
  type StockReservationRecord,
} from './inventory/reservations';
import type { MovementParticipant, StockMovementInput } from './inventory/types';

type DispatchRequestPayload = { orderId: string; customerId: string; customer: string; warehouseId: string; warehouse: string; vehicleNo: string; driverName: string; driverPhone: string; transporterId: string; lrNumber: string; items: Array<{ productId: string; product: string; requestedQty: number; trackingType: string; unit: string }>; notes: string; projectId?: string; projectName?: string };
export function projectDispatchPatch(project: any, dispatchId: string, userId: string, now = new Date().toISOString()) {
  return { linkedDispatchIds: Array.from(new Set([...(project?.linkedDispatchIds || []), dispatchId])), ...buildProjectStageAdvancePatch(project, 'Dispatch', userId, `Dispatch ${dispatchId} requested`, now) };
}
export function projectInstallationPatch(project: any, dispatchId: string, userId: string, now = new Date().toISOString()) {
  return buildProjectStageAdvancePatch(project, 'Installation', userId, `Dispatch ${dispatchId} executed; installation ready`, now);
}

export async function requestDispatch(payload: DispatchRequestPayload) {
  const state = useAppStore.getState();
  const companyId = resolveWorkflowCompanyId();
  const did = genId.dispatch(state.company.dispatchPrefix);
  const deliveryOTP = generateDeliveryOTP();
  const now = Date.now();

  const { projectId, projectName, ...restPayload } = payload;

  await createDocWithId(COLLECTIONS.DISPATCH, did, {
    id: did, dispatchId: did, dispatchNumber: did, ...restPayload, companyId, deliveryOTPHash: await hashOTP(deliveryOTP),
    deliveryOTPGeneratedAt: new Date(now).toISOString(),
    deliveryOTPExpiresAt: new Date(now + 72 * 60 * 60 * 1000).toISOString(),
    deliveryConfirmed: false, status: 'Pending Verification', approvalStatus: 'Pending',
    date: new Date().toISOString().split('T')[0], createdBy: state.user?.id, verifiedBy: null,
    items: restPayload.items.map(it => ({ ...it, verifiedQty: 0, serials: [], barcodes: [] })),
    ...(projectId ? { projectId, projectName } : {}),
  });

  // Link dispatch to project if projectId is provided
  if (projectId) {
    try {
      const project = await getOne<WorkflowRecord & { linkedDispatchIds?: string[] }>(COLLECTIONS.PROJECTS, projectId);
      if (project) {
        await updateDocById(COLLECTIONS.PROJECTS, projectId, projectDispatchPatch(project, did, state.user?.id || 'system'));
      }
    } catch {
      // Non-critical: project linking failure shouldn't block dispatch creation
    }
  }

  await logActivity('Dispatch', 'Requested Dispatch', did, {
    orderId: restPayload.orderId, entityName: restPayload.customer || restPayload.orderId, actionLabel: 'Requested dispatch',
  });
  notifyUsers(await usersByRole('Accounts'), NotificationType.DISPATCH_REQUESTED, 'Dispatch approval requested', `Dispatch ${did} is pending approval for order ${restPayload.orderId}.`, 'dispatch', did, companyId);
  // Phase 3B: Propagate caseId from order chain to dispatch
  void propagateCaseIdFromChain('dispatch', did);

  return { dispatchId: did, deliveryOTP };
}

export async function closeDispatch(dispatchId: string, options: { skipPermission?: boolean } = {}) {
  const state = useAppStore.getState();
  const role = String(state.user?.role || '');
  if (!options.skipPermission && !/account/i.test(role) && !canDo('invoices', 'approve')) {
    throw new Error('Accounts permission required to close dispatch');
  }
  let linkedOrderId = '';

  if (!firebaseEnv.isConfigured) {
    const dispatch = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.DISPATCH, dispatchId);
    if (!dispatch) throw new Error(`Dispatch ${dispatchId} not found`);
    const status = text(dispatch.status);
    if (status === 'Closed') throw new Error('Dispatch is already closed');
    if (!['Dispatched', 'Delivered'].includes(status)) throw new Error('Only dispatched or delivered dispatches can be closed');
    await updateDocById(COLLECTIONS.DISPATCH, dispatchId, {
      status: 'Closed', closedBy: state.user?.id || 'system', closedAt: new Date().toISOString(), updatedBy: state.user?.id || 'system',
    });
    linkedOrderId = text(dispatch.orderId);
  } else {
    const { db } = await import('./firebase');
    const { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } = await import('firebase/firestore');
    const dispatchRef = doc(db, COLLECTIONS.DISPATCH, dispatchId);
    const initialDispatchSnap = await getDoc(dispatchRef);
    if (!initialDispatchSnap.exists()) throw new Error(`Dispatch ${dispatchId} not found`);
    linkedOrderId = text(initialDispatchSnap.data().orderId);
    const dispatchCompanyId = text(initialDispatchSnap.data().companyId);
    const relatedDispatchIds = linkedOrderId
      ? (await getDocs(query(collection(db, COLLECTIONS.DISPATCH), where('companyId', '==', dispatchCompanyId), where('orderId', '==', linkedOrderId)))).docs.map((docSnap) => docSnap.id)
      : [];

    await runTransaction(db, async (transaction) => {
      const dispatchSnap = await transaction.get(dispatchRef);
      if (!dispatchSnap.exists()) throw new Error(`Dispatch ${dispatchId} not found`);
      const dispatch = dispatchSnap.data() as WorkflowRecord;
      const status = text(dispatch.status);
      if (status === 'Closed') throw new Error('Dispatch is already closed');
      if (!['Dispatched', 'Delivered'].includes(status)) throw new Error('Only dispatched or delivered dispatches can be closed');

      linkedOrderId = text(dispatch.orderId);
      let allRelatedClosed = true;
      let orderRef: ReturnType<typeof doc> | null = null;
      let orderExists = false;
      if (linkedOrderId) {
        orderRef = doc(db, COLLECTIONS.ORDERS, linkedOrderId);
        const orderSnap = await transaction.get(orderRef);
        orderExists = orderSnap.exists();
        const relatedSnaps = await Promise.all(relatedDispatchIds.map((id) => transaction.get(doc(db, COLLECTIONS.DISPATCH, id))));
        allRelatedClosed = relatedSnaps.every((docSnap) => docSnap.id === dispatchId || text(docSnap.data()?.status) === 'Closed');
        const order = orderSnap.exists() ? orderSnap.data() as WorkflowRecord : {};
        const settlementState = `${text(order.paymentStatus)} ${text(order.status)} ${text(order.reconciliationStatus)}`.toLowerCase();
        const alreadySettled = settlementState.includes('settled') || settlementState.includes('reconciled') || settlementState.includes('paid');
        if (orderSnap.exists() && !alreadySettled) {
          transaction.set(orderRef, sanitizeFirestoreData({ paymentReconciliationPending: true, updatedBy: state.user?.id || 'system' }), { merge: true });
        }
      }

      transaction.set(dispatchRef, sanitizeFirestoreData({
        status: 'Closed', closedBy: state.user?.id || 'system', closedAt: serverTimestamp(), updatedBy: state.user?.id || 'system',
      }), { merge: true });
      if (orderRef && orderExists && allRelatedClosed) {
        transaction.set(orderRef, sanitizeFirestoreData({ reconciled: true, updatedBy: state.user?.id || 'system' }), { merge: true });
      }
    });
  }

  await logActivity('Dispatch', 'Closed Dispatch', dispatchId, {
    orderId: linkedOrderId, entityName: linkedOrderId || dispatchId, actionLabel: 'Closed dispatch',
  });
  notifyUsers(
    await usersByRole('Accounts'), NotificationType.DISPATCH_CLOSED, 'Dispatch closed',
    `Dispatch ${dispatchId} was closed.`, 'dispatch', dispatchId, resolveWriteCompanyId()
  );
}

/**
 * Confirms OTP-verified delivery — sets status:'Delivered' and stops there.
 *
 * Phase 9: this used to unconditionally call closeDispatch({skipPermission:
 * true}) immediately afterward, collapsing 'Delivered' into 'Closed' within
 * the same call — meaning 'Delivered' could never actually persist as its
 * own observable state, and the Accounts-only permission closeDispatch()
 * normally requires was bypassed for whoever confirmed delivery (often a
 * driver/logistics role, not Accounts). Three independent parts of the
 * codebase already assumed 'Delivered' is a real, separately-closeable
 * state: dispatchWorkspaceUtils.ts's progress%/workflowState/KPI logic,
 * validateDispatchIntegrity()'s own checks, and a dedicated "Close
 * Dispatch" bulk action in DispatchWorkspace.tsx. closeDispatch() itself
 * already accepts 'Delivered' as a valid pre-close status — confirming
 * this two-step design (deliver, then a separate, Accounts-permissioned
 * close/reconcile) was always the intent. Closing is now left to that
 * existing action instead of happening here automatically.
 */
export async function confirmDelivery(dispatchId: string, enteredOTP: string) {
  const state = useAppStore.getState();
  let dispatchForNotification: WorkflowRecord = {};
  if (!firebaseEnv.isConfigured) {
    const current = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.DISPATCH, dispatchId);
    if (!current) throw new Error(`Dispatch ${dispatchId} not found`);
    dispatchForNotification = current;
    if (!enteredOTP) throw new Error('Invalid OTP');
    const status = text(current.status);
    if (isDispatchImmutable(status)) throw new Error('Delivery cannot be confirmed for delivered or closed dispatch');
    if (current.deliveryConfirmed === true || current.deliveryOTPConsumedAt) throw new Error('Delivery OTP already consumed');
    const expiresAt = timestampMillis(current.deliveryOTPExpiresAt);
    if (expiresAt && expiresAt < Date.now()) throw new Error('Delivery OTP expired');
    if (await hashOTP(enteredOTP) !== text(current.deliveryOTPHash)) throw new Error('Invalid OTP');
    await updateDocById(COLLECTIONS.DISPATCH, dispatchId, {
      status: 'Delivered', deliveryConfirmed: true, deliveryOTPHash: null,
      deliveryOTPConsumedAt: new Date().toISOString(), deliveredAt: new Date().toISOString(),
      deliveredBy: state.user?.id || 'system', updatedBy: state.user?.id || 'system',
    });
    await logActivity('Dispatch', 'Confirmed Delivery', dispatchId, {
      orderId: text(current.orderId), entityName: text(current.customer) || dispatchId, actionLabel: 'Confirmed delivery',
    });
    return;
  }

  const { db } = await import('./firebase');
  const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
  const dispatchRef = doc(db, COLLECTIONS.DISPATCH, dispatchId);
  const enteredHash = await hashOTP(enteredOTP);
  if (!enteredOTP) throw new Error('Invalid OTP');

  await runTransaction(db, async (transaction) => {
    const currentSnap = await transaction.get(dispatchRef);
    if (!currentSnap.exists()) throw new Error(`Dispatch ${dispatchId} not found`);
    const current = currentSnap.data() as WorkflowRecord;
    dispatchForNotification = current;
    const status = text(current.status);
    if (isDispatchImmutable(status)) throw new Error('Delivery cannot be confirmed for delivered or closed dispatch');
    if (current.deliveryConfirmed === true || current.deliveryOTPConsumedAt) throw new Error('Delivery OTP already consumed');
    const expiresAt = timestampMillis(current.deliveryOTPExpiresAt);
    if (expiresAt && expiresAt < Date.now()) throw new Error('Delivery OTP expired');
    if (enteredHash !== text(current.deliveryOTPHash)) throw new Error('Invalid OTP');
    transaction.set(dispatchRef, sanitizeFirestoreData({
      status: 'Delivered', deliveryConfirmed: true, deliveryOTPHash: null,
      deliveryOTPConsumedAt: serverTimestamp(), deliveredAt: serverTimestamp(),
      deliveredBy: state.user?.id || 'system', updatedBy: state.user?.id || 'system',
    }), { merge: true });
  });

  await logActivity('Dispatch', 'Confirmed Delivery', dispatchId, {
    orderId: text(dispatchForNotification.orderId), entityName: text(dispatchForNotification.customer) || dispatchId, actionLabel: 'Confirmed delivery',
  });
  notifyUsers(
    [
      ...(dispatchForNotification.createdBy ? [{ id: String(dispatchForNotification.createdBy) }] : []),
      ...(dispatchForNotification.verifiedBy ? [{ id: String(dispatchForNotification.verifiedBy) }] : []),
    ],
    NotificationType.DISPATCH_VERIFIED, 'Delivery confirmed',
    `Delivery was confirmed for dispatch ${dispatchId}.`, 'dispatch', dispatchId,
    resolveWriteCompanyId() || text(dispatchForNotification.companyId) || ''
  );
}

export async function approveDispatch(dispatchId: string) {
  await updateDocById(COLLECTIONS.DISPATCH, dispatchId, { approvalStatus: 'Approved' });
  await logActivity('Dispatch', 'Approved Dispatch', dispatchId, { entityName: dispatchId, actionLabel: 'Approved dispatch' });
  notifyUsers(
    await usersByRole('Warehouse'), NotificationType.DISPATCH_APPROVED, 'Dispatch approved',
    `Dispatch ${dispatchId} was approved.`, 'dispatch', dispatchId, resolveWriteCompanyId()
  );
}

/**
 * INVENTORY-11 (§11a) — in-batch duplicate check ONLY: rejects verification
 * if the SAME serial (compared NORMALIZED — `normalizeSerial`, so "SN-100"
 * and "sn-100" collide too) is typed more than once in this one
 * verification call. A fast, non-transactional pre-validate for a friendlier
 * error on the common case.
 *
 * The REAL cross-dispatch uniqueness guard — "already recorded against
 * another dispatch for this company" — used to be a `getAll(DISPATCH)` full
 * collection scan run BEFORE the stock transaction even opened (a classic
 * "query → check → write" race: two concurrent verifications of the same
 * serial could both pass this check, then both commit, landing the same
 * serial on two different dispatches). It is now the
 * `dispatch_serials/{companyId}_{normalizedSerial}` lock doc — read,
 * validated, and written INSIDE `dispatchDocParticipant`, the SAME
 * transaction as the DISPATCH_OUT movements (see `collectSerialClaims` +
 * `dispatchDocParticipant` below) — a genuine transactional guarantee, not
 * an app-layer race.
 */
function assertNoDuplicateSerialsInBatch(verifiedItems: any[]) {
  const seen = new Set<string>();
  for (const item of verifiedItems) {
    for (const raw of Array.isArray(item.serials) ? item.serials : []) {
      const serial = String(raw || '').trim();
      if (!serial) continue;
      const normalizedSerial = normalizeSerial(serial);
      if (seen.has(normalizedSerial)) throw new Error(`Serial number ${serial} was entered more than once in this verification.`);
      seen.add(normalizedSerial);
    }
  }
}

interface SerialClaim { serial: string; normalizedSerial: string; productId: string; }

/** Every distinct (normalized) serial across `verifiedItems`, blank entries
 *  skipped (never locked — mirrors the SKU-lock precedent for an absent
 *  value). Duplicates within the batch are already rejected by
 *  `assertNoDuplicateSerialsInBatch` before this is ever called, so the
 *  first occurrence of each normalized serial is authoritative. */
function collectSerialClaims(verifiedItems: any[]): SerialClaim[] {
  const claims: SerialClaim[] = [];
  const seen = new Set<string>();
  for (const item of verifiedItems) {
    const productId = String(item.productId || '');
    for (const raw of Array.isArray(item.serials) ? item.serials : []) {
      const serial = String(raw || '').trim();
      if (!serial) continue;
      const normalizedSerial = normalizeSerial(serial);
      if (seen.has(normalizedSerial)) continue;
      seen.add(normalizedSerial);
      claims.push({ serial, normalizedSerial, productId });
    }
  }
  return claims;
}

// INVENTORY-01 (P0-1): a dispatch that has reached any of these states has
// already had its stock issued — a second verification must NOT decrement
// stock again. Derived from DISPATCH_STATUSES + closeDispatch()/confirmDelivery().
export const TERMINAL_DISPATCH_STATUSES = ['Dispatched', 'In Transit', 'Delivered', 'Returned', 'Closed'] as const;

/**
 * INVENTORY-01 / INVENTORY-05c: deterministic `stock_ledger` document id for a
 * dispatch-OUT line — one id per (dispatch, product). A retried or concurrent
 * verification of the same line resolves to the SAME ledger doc, so the
 * movement is applied at most once. INVENTORY-05c routes this through the
 * movement engine, so the id is now the engine's injective
 * `STKMV-{enc(DISPATCH_OUT:dispatch:{dispatchId}:{productId})}` (the idempotency
 * key is byte-identical to the INVENTORY-01 key).
 */
export function dispatchOutLedgerId(dispatchId: string, productId: string): string {
  return movementLedgerId(buildIdempotencyKey('DISPATCH_OUT', 'dispatch', String(dispatchId || '').trim(), String(productId || '').trim()));
}

/**
 * INVENTORY-01 (P1-6, dispatch slice): before any stock mutation, the
 * referenced warehouse and every referenced product must exist, must not be
 * soft-deleted, and must belong to the dispatch's company. Cross-company
 * references are rejected. Broader master-data integrity is Phase 09.
 */
async function assertDispatchReferencesValid(companyId: string, warehouseId: string, productIds: string[]) {
  if (!warehouseId) throw new Error('Dispatch has no warehouse');
  const warehouse = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.WAREHOUSES, warehouseId);
  if (!warehouse || warehouse.isDeleted === true) throw new Error(`Warehouse ${warehouseId} does not exist or has been removed`);
  if (companyId && warehouse.companyId && warehouse.companyId !== companyId) {
    throw new Error('Dispatch warehouse belongs to a different company');
  }
  for (const productId of Array.from(new Set(productIds))) {
    if (!productId) throw new Error('Dispatch line has no product');
    const product = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PRODUCTS, productId);
    if (!product || product.isDeleted === true) throw new Error(`Product ${productId} does not exist or has been removed`);
    if (companyId && product.companyId && product.companyId !== companyId) {
      throw new Error(`Product ${productId} belongs to a different company`);
    }
  }
}

/**
 * INVENTORY-01 (P0-1) → INVENTORY-05c → INVENTORY-11 (§11a): dispatch
 * stock-OUT, transaction-safe, on the shared movement engine.
 *
 * Each line's decrement is a `DISPATCH_OUT` movement; `applyStockMovements`
 * runs every line + the dispatch-doc status flip + the serial-lock claims
 * (all via THIS ONE `dispatchDocParticipant`) inside ONE `runTransaction` —
 * the Phase-01 atomic boundary, preserved. Two concurrent verifications of
 * the same line cannot both decrement (deterministic ledger id); insufficient
 * stock aborts the whole transaction with no partial mutation (INV-1); a
 * concurrent verify that finds the dispatch already terminal is a benign
 * no-op (the participant's `validate` returns false); a serial already
 * locked by a DIFFERENT dispatch aborts the whole transaction (no partial
 * mutation — the same "throw = abort everything" guarantee INV-13's GRN
 * participant and INV-11's transfer participant already rely on).
 *
 * The order-items update + project patch + notifications stay AFTER the engine
 * call (Phase-01 shape — Plan §811 "keep the order-items/dispatch-doc sequence").
 */
interface DispatchParticipantCtx {
  dispatch: WorkflowRecord | null;
  rsv: Map<string, Record<string, unknown> | null>;
  serialLocks: Map<string, DispatchSerialLockDoc | null>;
}

interface SerialClaimContext {
  claims: SerialClaim[];
  companyId: string;
  groupId?: string;
  orderId?: string;
  warehouseId?: string;
  projectId?: string;
}

function dispatchDocParticipant(
  dispatchId: string,
  verifiedItems: any[],
  actorId: string,
  nowIso: string,
  reservations: StockReservationRecord[] = [],
  serialCtx: SerialClaimContext = { claims: [], companyId: '' },
): MovementParticipant<DispatchParticipantCtx> {
  const rsvIds = reservations.map((r) => r.id);
  return {
    async read(rc) {
      const rsv = new Map<string, Record<string, unknown> | null>();
      for (const id of rsvIds) rsv.set(id, await rc.get(COLLECTIONS.STOCK_RESERVATIONS, id));
      const serialLocks = new Map<string, DispatchSerialLockDoc | null>();
      for (const claim of serialCtx.claims) {
        const lockId = dispatchSerialLockId(serialCtx.companyId, claim.normalizedSerial);
        serialLocks.set(claim.normalizedSerial, await rc.get<DispatchSerialLockDoc>(COLLECTIONS.DISPATCH_SERIALS, lockId));
      }
      return { dispatch: await rc.get<WorkflowRecord>(COLLECTIONS.DISPATCH, dispatchId), rsv, serialLocks };
    },
    validate(ctx) {
      const status = String((ctx.dispatch?.status ?? '') || '');
      // A concurrent verification already issued this dispatch — benign no-op
      // (do NOT decrement stock again, do NOT re-bump the order, do NOT
      // re-consume the reservation, do NOT re-claim any serial).
      if ((TERMINAL_DISPATCH_STATUSES as readonly string[]).includes(status)) return false;
      // INVENTORY-11 (§11a) — the REAL cross-dispatch serial-uniqueness guard:
      // a lock already held by a DIFFERENT dispatch aborts the WHOLE
      // transaction (zero partial write), same class as INV-1/INV-13.
      for (const claim of serialCtx.claims) {
        if (lockHeldByAnotherDispatch(ctx.serialLocks.get(claim.normalizedSerial), dispatchId)) {
          throw new Error(`Serial number ${claim.serial} has already been dispatched on another order.`);
        }
      }
    },
    commit(ctx, plan, writer) {
      writer.set(COLLECTIONS.DISPATCH, dispatchId, {
        status: 'Dispatched', items: verifiedItems, verifiedBy: actorId, dispatchedAt: nowIso,
        updatedBy: actorId,
      }, { merge: true });
      // INVENTORY-07 — consume the applicable reservation atomically with the
      // DISPATCH_OUT + dispatch-doc write. `applyReservationDelta` distributes
      // the actually-released amount (from each SALES_RELEASE plan entry) FIFO
      // across this order's reservation docs. A dispatch of a pre-07 order (no
      // reservations) contributes nothing here.
      if (reservations.length) {
        applyReservationDelta({
          plan, snapshotById: ctx.rsv, docIdsByProduct: docIdsByProduct(reservations),
          writer, mode: 'consume', actorId, nowIso, matchSourceType: 'dispatch_consume',
        });
      }
      // INVENTORY-11 (§11a) — claim every new serial ATOMICALLY with the
      // stock decrement + dispatch-doc write above. A claim already owned by
      // THIS dispatch (a resumed retry after a partial prior commit) is
      // harmlessly re-written with the same identity — never re-validated
      // against a different owner here, `validate` already cleared that.
      for (const claim of serialCtx.claims) {
        const lockId = dispatchSerialLockId(serialCtx.companyId, claim.normalizedSerial);
        writer.set(COLLECTIONS.DISPATCH_SERIALS, lockId, {
          // warehouseId is REQUIRED, not conditional: a dispatch always has
          // one by the time a serial claim reaches commit (validated earlier
          // in executeAndVerifyDispatch) — the `sameWarehouse()` rules gate
          // for warehouse-restricted-role reads depends on it being present.
          id: lockId, companyId: serialCtx.companyId, ...(serialCtx.groupId ? { groupId: serialCtx.groupId } : {}),
          serial: claim.serial, dispatchId, productId: claim.productId, warehouseId: serialCtx.warehouseId || '',
          ...(serialCtx.orderId ? { orderId: serialCtx.orderId } : {}),
          ...(serialCtx.projectId ? { projectId: serialCtx.projectId } : {}),
          status: 'assigned', isDeleted: false, createdAt: nowIso, createdBy: actorId,
        });
      }
    },
  };
}

export async function executeAndVerifyDispatch(dispatch: any, verifiedItems: any[]) {
  const state = useAppStore.getState();
  const companyId = resolveWriteCompanyId() || String(dispatch.companyId || '');
  const actorId = state.user?.id || 'system';
  assertNoDuplicateSerialsInBatch(verifiedItems);

  const stockLines = (verifiedItems || []).filter((it) => Number(it.verifiedQty) > 0);
  const serialClaims = collectSerialClaims(verifiedItems);
  // INVENTORY-11 (§11a) — a serial can only be locked ATOMICALLY with a
  // DISPATCH_OUT movement (the participant only runs when at least one
  // input actually applies — see `applyStockMovements`). A serial captured
  // against a zero-qty line would otherwise be written onto the dispatch
  // doc's `items` completely UNLOCKED — reject instead of silently
  // accepting an unguarded serial (never silently discard/accept invalid
  // serial data).
  if (!stockLines.length && serialClaims.length) {
    throw new Error('Serial numbers require a verified quantity greater than zero.');
  }

  // Authoritative dispatch state — a sequential double-click / retry after a
  // successful verification is rejected here with a clear message.
  const authoritative = await getOne<WorkflowRecord & { id: string; status?: string }>(COLLECTIONS.DISPATCH, dispatch.id).catch(() => null);
  const authoritativeStatus = String((authoritative?.status ?? dispatch.status) || '');
  if ((TERMINAL_DISPATCH_STATUSES as readonly string[]).includes(authoritativeStatus)) {
    throw new Error(`Dispatch ${dispatch.id} has already been verified (status: ${authoritativeStatus}).`);
  }

  await assertDispatchReferencesValid(companyId, String(dispatch.warehouseId || ''), stockLines.map((it) => String(it.productId || '')));

  const now = new Date().toISOString();
  let applied: Array<{ productId: string; appliedQty: number }> = [];

  // INVENTORY-07 — reservation consume. Read this order's active reservations
  // ONCE (outside the txn); each verified line that has a reservation gets a
  // `SALES_RELEASE` (`clampToStock` → stale-safe) in the SAME engine batch as
  // its DISPATCH_OUT, and the participant updates the reservation docs.
  const reservations = isReservationsEnabled() && dispatch.orderId
    ? await fetchOrderReservations(String(dispatch.orderId))
    : [];
  const groupId = resolveWriteGroupId(companyId);
  const participant = dispatchDocParticipant(String(dispatch.id), verifiedItems, actorId, now, reservations, {
    claims: serialClaims, companyId, groupId,
    orderId: dispatch.orderId ? String(dispatch.orderId) : undefined,
    warehouseId: dispatch.warehouseId ? String(dispatch.warehouseId) : undefined,
    projectId: dispatch.projectId ? String(dispatch.projectId) : undefined,
  });

  if (!stockLines.length) {
    // Nothing to decrement — still flip the dispatch status (Phase-01 parity).
    const cur = authoritative ?? (await getOne<WorkflowRecord & { id: string; status?: string }>(COLLECTIONS.DISPATCH, dispatch.id).catch(() => null));
    if (cur && (TERMINAL_DISPATCH_STATUSES as readonly string[]).includes(String(cur.status || ''))) {
      return { dispatchId: dispatch.id, alreadyVerified: true, applied: [] as Array<{ productId: string; appliedQty: number }> };
    }
    await updateDocById(COLLECTIONS.DISPATCH, dispatch.id, sanitizeFirestoreData({
      status: 'Dispatched', items: verifiedItems, verifiedBy: state.user?.id, dispatchedAt: now, updatedBy: actorId,
    }));
  } else {
    // ---- ATOMIC: every line's DISPATCH_OUT + the dispatch-doc status flip, ONE engine txn.
    const outInputs: StockMovementInput[] = stockLines.map((item) => ({
      movementType: 'DISPATCH_OUT' as const,
      productId: String(item.productId),
      warehouseId: String(dispatch.warehouseId || ''),
      qty: Number(item.verifiedQty),
      unit: String(item.unit || 'PCS'),
      sourceType: 'dispatch',
      sourceId: String(dispatch.id),
      lineKey: String(item.productId),
      companyId,
      actorId,
      notes: `Dispatch verification for Order ${dispatch.orderId}`,
      ledgerExtra: {
        referenceType: 'Dispatch', referenceId: String(dispatch.id),
        product: item.product, warehouse: dispatch.warehouse,
      },
    }));
    const consumeInputs = reservations.length
      ? buildDispatchConsumeInputs({
          companyId, actorId,
          dispatchId: String(dispatch.id), orderId: String(dispatch.orderId || ''),
          warehouseId: String(dispatch.warehouseId || ''), warehouseName: String(dispatch.warehouse || ''),
          verifiedLines: stockLines.map((it) => ({ productId: String(it.productId), unit: String(it.unit || 'PCS'), verifiedQty: Number(it.verifiedQty), productName: String(it.product || '') })),
          reservations,
        })
      : [];
    const inputs: StockMovementInput[] = [...outInputs, ...consumeInputs];

    let batch;
    try {
      batch = await applyStockMovements(inputs, participant);
    } catch (err) {
      // Preserve the Phase-01 error phrasing for an insufficient-stock abort.
      const msg = String((err as Error)?.message || err);
      if (/Insufficient stock|onHandQty/i.test(msg)) {
        const short = stockLines[0];
        throw new Error(`Insufficient stock for ${short?.product ?? 'a line'}. ${msg}`);
      }
      throw err;
    }

    if (batch.skipped) {
      // A concurrent verification won the race — do NOT double-apply order qty.
      return { dispatchId: dispatch.id, alreadyVerified: true, applied: [] as Array<{ productId: string; appliedQty: number }> };
    }
    // Only DISPATCH_OUT results drive the order-items dispatchedQty/pendingQty
    // bump — the SALES_RELEASE consume rows share the same productId and must
    // NOT be counted as dispatched quantity.
    applied = batch.results
      .filter((r) => r.movementType === 'DISPATCH_OUT')
      .map((r) => ({ productId: r.productId, appliedQty: r.applied ? r.qty : 0 }));

    if (!applied.some((a) => a.appliedQty > 0)) {
      // Every line was an idempotent no-op → the engine skipped the
      // dispatch-doc participant. Flip the status here for Phase-01 parity
      // (recovery after a partial failure where the ledger rows committed but
      // the status write did not). Idempotent.
      await updateDocById(COLLECTIONS.DISPATCH, dispatch.id, sanitizeFirestoreData({
        status: 'Dispatched', items: verifiedItems, verifiedBy: state.user?.id, dispatchedAt: now, updatedBy: actorId,
      }));
    }
  }

  const totalApplied = applied.reduce((s, a) => s + a.appliedQty, 0);
  const appliedByProduct = new Map(applied.map((a) => [a.productId, a.appliedQty]));

  const order = await getOne<WorkflowRecord & { items?: WorkflowRecord[]; id: string }>(COLLECTIONS.ORDERS, dispatch.orderId);
  if (order && totalApplied > 0) {
    let allDispatched = true;
    const updatedOrderItems = (order.items || []).map((oItem: any) => {
      const add = appliedByProduct.get(String(oItem.productId)) ?? 0;
      if (add > 0) {
        const newDispatched = (oItem.dispatchedQty || 0) + add;
        const newPending = Math.max(0, (oItem.pendingQty ?? oItem.qty) - add);
        if (newPending > 0) allDispatched = false;
        return { ...oItem, dispatchedQty: newDispatched, pendingQty: newPending };
      }
      if ((oItem.pendingQty ?? 0) > 0) allDispatched = false;
      return oItem;
    });
    await updateDocById(COLLECTIONS.ORDERS, order.id, { items: updatedOrderItems, status: allDispatched ? 'Dispatched' : 'Partial Dispatch' });
  }

  // (The dispatch-doc status flip happens inside the engine transaction via
  //  dispatchDocParticipant — INVENTORY-05c — for both the configured and demo
  //  branches; no separate write here.)

  if (dispatch.projectId) {
    const project = await getOne<WorkflowRecord>(COLLECTIONS.PROJECTS, dispatch.projectId);
    if (project) await updateDocById(COLLECTIONS.PROJECTS, dispatch.projectId, projectInstallationPatch(project, dispatch.id, state.user?.id || 'system'));
  }
  await logActivity('Dispatch', 'Verified & Dispatched', dispatch.id, {
    orderId: dispatch.orderId, entityName: dispatch.customer || dispatch.orderId || dispatch.id, actionLabel: 'Verified and dispatched',
  });
  const accountUsers = await usersByRole('Accounts');
  notifyUsers([
    ...accountUsers,
    ...(order?.createdBy ? [{ id: String(order.createdBy) }] : []),
    ...(dispatch.createdBy ? [{ id: String(dispatch.createdBy) }] : []),
  ], NotificationType.DISPATCH_VERIFIED, 'Dispatch verified', `Dispatch ${dispatch.id} was verified and dispatched.`, 'dispatch', dispatch.id, companyId || dispatch.companyId || '');

  return { dispatchId: dispatch.id, alreadyVerified: false, applied };
}

export async function validateDispatchIntegrity(dispatchId: string): Promise<{ valid: boolean; issues: string[] }> {
  const { getOne } = await import('./firestore');
  const dispatch = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.DISPATCH, dispatchId);
  if (!dispatch) return { valid: false, issues: [`Dispatch ${dispatchId} not found`] };

  const issues: string[] = [];
  const status = text(dispatch.status);
  if ((status === 'Delivered' || status === 'Closed') && !dispatch.deliveredAt && dispatch.deliveryConfirmed === true) {
    issues.push('Delivered dispatch is missing deliveredAt');
  }
  if (status === 'Closed' && !dispatch.closedAt) issues.push('Closed dispatch is missing closedAt');
  if (dispatch.deliveryOTPConsumedAt && dispatch.deliveryConfirmed !== true) issues.push('OTP consumed but dispatch is not delivered');

  const orderId = text(dispatch.orderId);
  if (dispatch.paymentReconciliationPending && orderId) {
    const order = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.ORDERS, orderId);
    const settlementState = `${text(order?.paymentStatus)} ${text(order?.status)} ${text(order?.reconciliationStatus)}`.toLowerCase();
    if (settlementState.includes('settled') || settlementState.includes('reconciled') || settlementState.includes('paid')) {
      issues.push('Reconciliation is pending but linked order is already settled');
    }
  }
  return { valid: issues.length === 0, issues };
}
