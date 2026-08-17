import { createDocWithId, updateDocById, genId, getAll, getOne, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS, firebaseEnv } from './firebase';
import { sanitizeFirestoreData } from './sanitizer';
import { useAppStore } from '../store/useAppStore';
import { NotificationType } from '../types';
import { canDo } from './permissions';
import { generateDeliveryOTP, hashOTP, isDispatchImmutable, logActivity, notifyUsers, resolveWorkflowCompanyId, text, timestampMillis, usersByRole, type WorkflowRecord } from './workflow';
import { propagateCaseIdFromChain } from './casePropagation';
import { buildProjectStageAdvancePatch } from './projectLifecycle';

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
 * Rejects verification if any serial in verifiedItems is (a) typed more than
 * once in this same batch, or (b) already recorded against another dispatch
 * for this company. Nothing previously checked this — dispatch.items[].serials
 * is free-text captured at verification time with no uniqueness guard, so
 * the same physical serial could be typed into two different dispatches
 * with no error.
 */
async function assertNoDuplicateSerials(dispatch: any, verifiedItems: any[], companyId: string) {
  const newSerials = verifiedItems.flatMap((item) => (Array.isArray(item.serials) ? item.serials : []));
  if (newSerials.length === 0) return;

  const seen = new Set<string>();
  for (const serial of newSerials) {
    if (seen.has(serial)) throw new Error(`Serial number ${serial} was entered more than once in this verification.`);
    seen.add(serial);
  }

  const allDispatches = await getAll<WorkflowRecord & { id: string; items?: any[] }>(COLLECTIONS.DISPATCH);
  const existingSerials = new Set<string>();
  for (const other of allDispatches) {
    if (other.id === dispatch.id) continue;
    if (companyId && other.companyId && other.companyId !== companyId) continue;
    for (const item of other.items || []) {
      for (const serial of Array.isArray(item.serials) ? item.serials : []) {
        existingSerials.add(serial);
      }
    }
  }
  for (const serial of newSerials) {
    if (existingSerials.has(serial)) throw new Error(`Serial number ${serial} has already been dispatched on another order.`);
  }
}

export async function executeAndVerifyDispatch(dispatch: any, verifiedItems: any[]) {
  const state = useAppStore.getState();
  await assertNoDuplicateSerials(dispatch, verifiedItems, state.activeCompanyId || dispatch.companyId || '');
  if (!firebaseEnv.isConfigured) {
    for (const item of verifiedItems) {
      if (item.verifiedQty <= 0) continue;
      const rows = await getAll<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK);
      const stock = rows.find((row) => (
        row.productId === item.productId && row.warehouseId === dispatch.warehouseId && row.companyId === (state.activeCompanyId || dispatch.companyId)
      ));
      if (!stock) throw new Error(`Stock not found for ${item.product}`);
      const available = Number(stock.availableQty ?? stock.available) || 0;
      if (available < item.verifiedQty) throw new Error(`Insufficient stock for ${item.product}. Available: ${available}, Required: ${item.verifiedQty}`);
      const newQty = available - item.verifiedQty;
      await updateDocById(COLLECTIONS.STOCK, stock.id, { availableQty: newQty, reservedQty: Number(stock.reservedQty ?? stock.reserved) || 0 });
      const ledgerId = genId.generic('STK');
      await createDocWithId(COLLECTIONS.STOCK_LEDGER, ledgerId, {
        id: ledgerId, companyId: resolveWriteCompanyId() || dispatch.companyId || '',
        productId: item.productId, product: item.product, warehouseId: dispatch.warehouseId, warehouse: dispatch.warehouse,
        type: 'OUT', qty: item.verifiedQty, beforeQty: available, afterQty: newQty,
        transactionId: genId.generic('TXN'), movementAt: new Date().toISOString(), unit: item.unit,
        referenceType: 'Dispatch', referenceId: dispatch.id, date: new Date().toISOString(),
        notes: `Dispatch verification for Order ${dispatch.orderId}`,
      });
    }
  } else {
    const { db } = await import('./firebase');
    const { getDocs, query, where, collection } = await import('firebase/firestore');
    for (const item of verifiedItems) {
      if (item.verifiedQty <= 0) continue;
      const stockQuery = query(
        collection(db, COLLECTIONS.STOCK),
        where('productId', '==', item.productId),
        where('warehouseId', '==', dispatch.warehouseId),
        // Canonical tenant resolution — never the neutral 'default' placeholder.
        where('companyId', '==', resolveWriteCompanyId() || dispatch.companyId)
      );
      const stockSnap = await getDocs(stockQuery);
      let currentStockId = '';
      let available = 0;
      if (!stockSnap.empty) {
        const stockDoc = stockSnap.docs[0];
        currentStockId = stockDoc.id;
        available = Number(stockDoc.data().availableQty ?? stockDoc.data().available) || 0;
      }
      if (!currentStockId) throw new Error(`Stock not found for ${item.product}`);
      if (available < item.verifiedQty) throw new Error(`Insufficient stock for ${item.product}. Available: ${available}, Required: ${item.verifiedQty}`);

      const newQty = available - item.verifiedQty;
      await updateDocById(COLLECTIONS.STOCK, currentStockId, {
        availableQty: newQty,
        reservedQty: Number(stockSnap.docs[0]?.data().reservedQty ?? stockSnap.docs[0]?.data().reserved) || 0,
      });
      const ledgerId = genId.generic('STK');
      await createDocWithId(COLLECTIONS.STOCK_LEDGER, ledgerId, {
        id: ledgerId, companyId: state.activeCompanyId || dispatch.companyId || '',
        productId: item.productId, product: item.product, warehouseId: dispatch.warehouseId, warehouse: dispatch.warehouse,
        type: 'OUT', qty: item.verifiedQty, beforeQty: available, afterQty: newQty,
        transactionId: genId.generic('TXN'), movementAt: new Date().toISOString(), unit: item.unit,
        referenceType: 'Dispatch', referenceId: dispatch.id, date: new Date().toISOString(),
        notes: `Dispatch verification for Order ${dispatch.orderId}`,
      });
    }
  }

  const { getOne } = await import('./firestore');
  const order = await getOne<WorkflowRecord & { items?: WorkflowRecord[]; id: string }>(COLLECTIONS.ORDERS, dispatch.orderId);
  if (order) {
    let allDispatched = true;
    const updatedOrderItems = (order.items || []).map((oItem: any) => {
      const vItem = verifiedItems.find(v => v.productId === oItem.productId);
      if (vItem) {
        const newDispatched = (oItem.dispatchedQty || 0) + vItem.verifiedQty;
        const newPending = Math.max(0, (oItem.pendingQty || oItem.qty) - vItem.verifiedQty);
        if (newPending > 0) allDispatched = false;
        return { ...oItem, dispatchedQty: newDispatched, pendingQty: newPending };
      }
      if (oItem.pendingQty > 0) allDispatched = false;
      return oItem;
    });
    await updateDocById(COLLECTIONS.ORDERS, order.id, { items: updatedOrderItems, status: allDispatched ? 'Dispatched' : 'Partial Dispatch' });
  }

  await updateDocById(COLLECTIONS.DISPATCH, dispatch.id, {
    status: 'Dispatched', items: verifiedItems, verifiedBy: state.user?.id, dispatchedAt: new Date().toISOString(),
  });
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
  ], NotificationType.DISPATCH_VERIFIED, 'Dispatch verified', `Dispatch ${dispatch.id} was verified and dispatched.`, 'dispatch', dispatch.id, resolveWriteCompanyId() || dispatch.companyId || '');
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
