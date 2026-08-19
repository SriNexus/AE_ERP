import { createDocWithId, updateDocById, genId, getAll, getOne, resolveWriteCompanyId, resolveWriteCompanyCode } from './firestore';
import { getNextDocumentNumber, resolveDocumentDefaults } from './documentNumbering';
import { COLLECTIONS, firebaseEnv } from './firebase';
import { sanitizeFirestoreData } from './sanitizer';
import { useAppStore } from '../store/useAppStore';
import { NotificationType } from '../types';
import { logActivity, notifyUsers, text, usersByRole, type WorkflowRecord } from './workflow';

function addDaysIso(dateValue: string | undefined, days: number): string {
  const base = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(base.getTime())) return new Date(Date.now() + Math.max(0, days) * 86400000).toISOString().split('T')[0];
  const next = new Date(base);
  next.setDate(next.getDate() + Math.max(0, Number(days) || 0));
  return next.toISOString().split('T')[0];
}


export async function generatePIsFromOrder(order: any) {
  const state = useAppStore.getState();

  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId() || order.companyId || '';
  const documentDefaults = await resolveDocumentDefaults(companyId);

  // Data-driven template selection — the company's own companyCode, the same
  // source src/templates/documents/PI/index.ts and shared/theme.ts already
  // key their template/theme rendering off. Historically this function
  // always split an order's items into two Proforma Invoices for two
  // separate legal entities (CGPL: general items, STS/Santosh Techno: BOS &
  // structural items) — a real dual-entity billing arrangement, not a
  // generic multi-tenant rule. That split is preserved exactly, but now only
  // actually applies to a company whose own companyCode is 'CGPL' — the
  // dual-entity setup it was built for. Any other company (including
  // Ashish Enterprises, companyCode 'AE-01') gets one PI covering every
  // item, correctly labelled with its own companyCode — it must not inherit
  // a CGPL/STS identity it was never associated with.
  const companyCode = resolveWriteCompanyCode(companyId);
  const isDualEntityCompany = companyCode === 'CGPL';

  const cgplItems: any[] = [];
  const santoshItems: any[] = [];
  if (isDualEntityCompany) {
    (order.items || []).forEach((it: any) => {
      const cat = String(it.category || '').toLowerCase();
      if (cat.includes('bos') || cat.includes('structure')) {
        santoshItems.push(it);
      } else {
        cgplItems.push(it);
      }
    });
  } else {
    cgplItems.push(...(order.items || []));
  }

  const generatedPIs: string[] = [];
  const grossForItems = (items: any[]) => items.reduce((sum, item) => {
    const base = Number(item.qty || 0) * Number(item.price || 0);
    return sum + base + (base * Number(item.tax || 0) / 100);
  }, 0);
  let remainingGroupGross = grossForItems([...cgplItems, ...santoshItems]);
  let remainingOrderTotal = Number(order.total || remainingGroupGross);

  // Internal helper to create PI
  async function createPI(items: any[], template: string) {
    if (items.length === 0) return;
    const piId = genId.invoice(state.company.invoicePrefix);
    const { documentNumber } = await getNextDocumentNumber(companyId, 'invoice');

    const subtotal = items.reduce((s, i) => s + (Number(i.qty) * Number(i.price)), 0);
    const taxAmount = items.reduce((s, i) => s + (Number(i.qty) * Number(i.price) * Number(i.tax) / 100), 0);
    const groupGross = subtotal + taxAmount;
    const total = Math.round((remainingGroupGross <= groupGross
      ? remainingOrderTotal
      : remainingOrderTotal * (groupGross / remainingGroupGross)) * 100) / 100;
    const adjustmentAmount = Math.round((total - groupGross) * 100) / 100;
    remainingOrderTotal = Math.round((remainingOrderTotal - total) * 100) / 100;
    remainingGroupGross = Math.round((remainingGroupGross - groupGross) * 100) / 100;

    await createDocWithId(COLLECTIONS.PROFORMA_INVOICES, piId, {
      id: piId,
      invoiceNumber: documentNumber,
      piNumber: documentNumber,
      refNo: documentNumber,
      orderId: order.id,
      projectId: String(order.projectId || ''),
      quotationId: String(order.quotationId || order.sourceQuotationId || ''),
      engineeringDesignId: String(order.engineeringDesignId || ''),
      customerId: order.customerId,
      customer: order.customer,
      date: new Date().toISOString().split('T')[0],
      dueDate: addDaysIso(order.date || order.createdAt || new Date().toISOString().split('T')[0], documentDefaults.settings.piValidityDays),
      status: 'Draft',
      paymentStatus: 'Pending',
      items,
      subtotal,
      taxAmount,
      discount: 0,
      adjustmentAmount,
      total,
      templateUsed: template,
      sourceOrderId: order.id,
      generatedBy: state.user?.id,
      approvalStatus: 'Pending',
      terms: documentDefaults.settings.defaultTerms,
      notes: documentDefaults.settings.defaultNotes,
    });

    await logActivity('Orders', 'Generated PI', order.id, {
      piId,
      documentNumber,
      template,
      entityName: order.customer || order.customerName || order.id,
      actionLabel: 'Generated proforma invoice',
    });
    notifyUsers(
      await usersByRole('Accounts'),
      NotificationType.PI_GENERATED,
      'PI generated',
      `Proforma invoice ${documentNumber} was generated for order ${order.id}.`,
      'invoice',
      piId,
      companyId
    );
    generatedPIs.push(piId);
  }

  // Generate the PI(s). Dual-entity companies (companyCode 'CGPL') get one
  // PI per legal entity, each correctly labelled with that entity's own
  // companyCode; every other company gets a single PI labelled with its own
  // companyCode ('' only if the company config has none loaded yet — never a
  // guessed literal).
  await createPI(cgplItems, companyCode);
  if (isDualEntityCompany) {
    await createPI(santoshItems, 'STS');
  }

  // 3. Update Order
  await updateDocById(COLLECTIONS.ORDERS, order.id, {
    piGenerated: true,
    generatedPIs: generatedPIs,
    totalInvoiced: order.total, // Simplified logic: assumes fully invoiced
    pendingBilling: 0
  });

  return generatedPIs;
}

export async function markPIAsPaid(piId: string) {
  const state = useAppStore.getState();
  let linkedOrderId = '';
  let customerName = '';
  if (!firebaseEnv.isConfigured) {
    const pi = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PROFORMA_INVOICES, piId);
    if (!pi) throw new Error(`PI ${piId} not found`);
    linkedOrderId = text(pi.orderId) || text(pi.sourceOrderId);
    customerName = text(pi.customer);
    if (!linkedOrderId) throw new Error(`PI ${piId} is not linked to an order`);
    await updateDocById(COLLECTIONS.PROFORMA_INVOICES, piId, {
      paymentStatus: 'Paid',
      paidAt: new Date().toISOString(),
      updatedBy: state.user?.id || 'system',
    });
    await updateDocById(COLLECTIONS.ORDERS, linkedOrderId, {
      stockBlocked: true,
      updatedBy: state.user?.id || 'system',
    });
  } else {
  const { db } = await import('./firebase');
  const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');

  await runTransaction(db, async (transaction) => {
    const piRef = doc(db, COLLECTIONS.PROFORMA_INVOICES, piId);
    const piSnap = await transaction.get(piRef);
    if (!piSnap.exists()) {
      throw new Error(`PI ${piId} not found`);
    }

    const pi = piSnap.data() as WorkflowRecord;
    linkedOrderId = text(pi.orderId) || text(pi.sourceOrderId);
    customerName = text(pi.customer);
    if (!linkedOrderId) {
      throw new Error(`PI ${piId} is not linked to an order`);
    }

    const orderRef = doc(db, COLLECTIONS.ORDERS, linkedOrderId);
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) {
      throw new Error(`Order ${linkedOrderId} not found`);
    }

    transaction.set(piRef, sanitizeFirestoreData({
      paymentStatus: 'Paid',
      paidAt: serverTimestamp(),
      updatedBy: state.user?.id || 'system',
    }), { merge: true });
    transaction.set(orderRef, sanitizeFirestoreData({
      stockBlocked: true,
      updatedBy: state.user?.id || 'system',
    }), { merge: true });
  });
  }

  await logActivity('Invoices', 'Marked PI Paid', piId, {
    orderId: linkedOrderId,
    entityName: customerName || piId,
    actionLabel: 'Marked proforma invoice paid',
  });
  notifyUsers(
    await usersByRole('Warehouse'),
    NotificationType.PAYMENT_CONFIRMED,
    'Payment confirmed',
    `Payment was confirmed for PI ${piId}. Stock is now blocked for order ${linkedOrderId}.`,
    'invoice',
    piId,
    resolveWriteCompanyId()
  );

  return { piId, orderId: linkedOrderId };
}

function nextPaymentStatus(total: number, paidAmount: number, orderStatus?: string) {
  const balanceAmount = Math.round(Math.max(0, total - paidAmount) * 100) / 100;
  if (String(orderStatus || '').toLowerCase() === 'cancelled' && paidAmount <= 0) return 'Refunded';
  if (balanceAmount <= 0 && total > 0) return 'Paid';
  if (paidAmount > 0) return 'Partial';
  return 'Pending';
}

export async function refundPayment(paymentId: string, reason = '') {
  const state = useAppStore.getState();
  const createdBy = state.user?.id || 'system';
  const refundId = genId.payment();
  let linkedOrderId = '';
  let customerName = '';
  let refundAmount = 0;
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  let companyId = resolveWriteCompanyId();

  if (!firebaseEnv.isConfigured) {
    const payment = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PAYMENTS, paymentId);
    if (!payment) throw new Error(`Payment ${paymentId} not found`);
    if (String(payment.status || '').toLowerCase() === 'refunded') throw new Error('Payment is already refunded');
    if (payment.refundOfPaymentId) throw new Error('Refund entries cannot be refunded');
    refundAmount = Number(payment.amount) || 0;
    if (refundAmount <= 0) throw new Error('Only positive payment records can be refunded');
    linkedOrderId = text(payment.orderId);
    customerName = text(payment.customer);
    companyId = text(payment.companyId) || companyId;

    await createDocWithId(COLLECTIONS.PAYMENTS, refundId, sanitizeFirestoreData({
      ...payment,
      id: refundId,
      amount: -refundAmount,
      status: 'Refunded',
      reference: `Refund for ${paymentId}`,
      notes: reason || `Refund reversal for payment ${paymentId}`,
      refundOfPaymentId: paymentId,
      originalPaymentId: paymentId,
      refundReason: reason || '',
      refundedAt: new Date().toISOString(),
      createdBy,
      updatedBy: createdBy,
      isDeleted: false,
    }));
    await updateDocById(COLLECTIONS.PAYMENTS, paymentId, sanitizeFirestoreData({
      status: 'Refunded',
      refundPaymentId: refundId,
      refundReason: reason || '',
      refundedAt: new Date().toISOString(),
      refundedBy: createdBy,
      updatedBy: createdBy,
    }));

    if (linkedOrderId) {
      const order = await getOne<WorkflowRecord & { id: string; generatedPIs?: string[] }>(COLLECTIONS.ORDERS, linkedOrderId);
      if (order) {
        const orderTotal = Number(order.total) || 0;
        const paidBefore = Number(order.paidAmount ?? order.amountPaid) || 0;
        const paidAfter = Math.round(Math.max(0, paidBefore - refundAmount) * 100) / 100;
        const balanceAfter = Math.round(Math.max(0, orderTotal - paidAfter) * 100) / 100;
        await updateDocById(COLLECTIONS.ORDERS, linkedOrderId, sanitizeFirestoreData({
          paidAmount: paidAfter,
          amountPaid: paidAfter,
          balanceAmount: balanceAfter,
          paymentStatus: nextPaymentStatus(orderTotal, paidAfter, text(order.status)),
          lastRefundPaymentId: refundId,
          lastRefundAt: new Date().toISOString(),
          paymentReconciliationPending: false,
          updatedBy: createdBy,
        }));

        let remaining = refundAmount;
        const invoices = (await getAll<WorkflowRecord & { id: string }>(COLLECTIONS.PROFORMA_INVOICES))
          .filter((pi) => pi.orderId === linkedOrderId || pi.sourceOrderId === linkedOrderId || order.generatedPIs?.includes(pi.id))
          .reverse();
        for (const pi of invoices) {
          if (remaining <= 0) break;
          const paidBeforePi = Number(pi.paidAmount ?? pi.amountPaid) || 0;
          if (paidBeforePi <= 0) continue;
          const applied = Math.min(remaining, paidBeforePi);
          const paidAfterPi = Math.round((paidBeforePi - applied) * 100) / 100;
          const total = Number(pi.total) || 0;
          await updateDocById(COLLECTIONS.PROFORMA_INVOICES, pi.id, sanitizeFirestoreData({
            paidAmount: paidAfterPi,
            amountPaid: paidAfterPi,
            balanceAmount: Math.round(Math.max(0, total - paidAfterPi) * 100) / 100,
            paymentStatus: nextPaymentStatus(total, paidAfterPi, text(order.status)),
            lastRefundPaymentId: refundId,
            lastRefundAt: new Date().toISOString(),
            updatedBy: createdBy,
          }));
          remaining = Math.round((remaining - applied) * 100) / 100;
        }
      }
    }
  } else {
    const { db } = await import('./firebase');
    const { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } = await import('firebase/firestore');
    const paymentRef = doc(db, COLLECTIONS.PAYMENTS, paymentId);
    const paymentSnap = await getDoc(paymentRef);
    if (!paymentSnap.exists()) throw new Error(`Payment ${paymentId} not found`);
    const payment = paymentSnap.data() as WorkflowRecord;
    if (String(payment.status || '').toLowerCase() === 'refunded') throw new Error('Payment is already refunded');
    if (payment.refundOfPaymentId) throw new Error('Refund entries cannot be refunded');
    refundAmount = Number(payment.amount) || 0;
    if (refundAmount <= 0) throw new Error('Only positive payment records can be refunded');
    linkedOrderId = text(payment.orderId);
    customerName = text(payment.customer);
    companyId = text(payment.companyId) || companyId;

    const orderRef = linkedOrderId ? doc(db, COLLECTIONS.ORDERS, linkedOrderId) : null;
    const orderSnapForInvoices = orderRef ? await getDoc(orderRef) : null;
    const orderForInvoices = orderSnapForInvoices?.exists() ? orderSnapForInvoices.data() as WorkflowRecord : null;
    const invoiceRefMap = new Map<string, ReturnType<typeof doc>>();
    if (linkedOrderId) {
      const orderIdSnap = await getDocs(query(collection(db, COLLECTIONS.PROFORMA_INVOICES), where('companyId', '==', companyId), where('orderId', '==', linkedOrderId)));
      orderIdSnap.docs.forEach((docSnap) => invoiceRefMap.set(docSnap.id, docSnap.ref));
      const sourceOrderSnap = await getDocs(query(collection(db, COLLECTIONS.PROFORMA_INVOICES), where('companyId', '==', companyId), where('sourceOrderId', '==', linkedOrderId)));
      sourceOrderSnap.docs.forEach((docSnap) => invoiceRefMap.set(docSnap.id, docSnap.ref));
      const generatedPIs = Array.isArray(orderForInvoices?.generatedPIs) ? orderForInvoices.generatedPIs : [];
      generatedPIs.forEach((piId) => {
        if (piId) invoiceRefMap.set(String(piId), doc(db, COLLECTIONS.PROFORMA_INVOICES, String(piId)));
      });
    }
    const invoiceRefs = Array.from(invoiceRefMap.values());

    await runTransaction(db, async (transaction) => {
      const currentPaymentSnap = await transaction.get(paymentRef);
      if (!currentPaymentSnap.exists()) throw new Error(`Payment ${paymentId} not found`);
      const currentPayment = currentPaymentSnap.data() as WorkflowRecord;
      if (String(currentPayment.status || '').toLowerCase() === 'refunded') throw new Error('Payment is already refunded');

      const refundRef = doc(db, COLLECTIONS.PAYMENTS, refundId);
      const refundSnap = await transaction.get(refundRef);
      if (refundSnap.exists()) throw new Error(`Refund payment ${refundId} already exists`);

      const orderSnap = orderRef ? await transaction.get(orderRef) : null;
      const order = orderSnap?.exists() ? orderSnap.data() as WorkflowRecord : null;
      const invoiceSnaps = await Promise.all(invoiceRefs.map((ref) => transaction.get(ref)));

      transaction.set(refundRef, sanitizeFirestoreData({
        ...currentPayment,
        id: refundId,
        amount: -refundAmount,
        status: 'Refunded',
        reference: `Refund for ${paymentId}`,
        notes: reason || `Refund reversal for payment ${paymentId}`,
        refundOfPaymentId: paymentId,
        originalPaymentId: paymentId,
        refundReason: reason || '',
        refundedAt: serverTimestamp(),
        createdBy,
        updatedBy: createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isDeleted: false,
      }));
      transaction.set(paymentRef, sanitizeFirestoreData({
        status: 'Refunded',
        refundPaymentId: refundId,
        refundReason: reason || '',
        refundedAt: serverTimestamp(),
        refundedBy: createdBy,
        updatedBy: createdBy,
        updatedAt: serverTimestamp(),
      }), { merge: true });

      if (!orderRef || !orderSnap?.exists() || !order) return;
      const orderTotal = Number(order.total) || 0;
      const paidBefore = Number(order.paidAmount ?? order.amountPaid) || 0;
      const paidAfter = Math.round(Math.max(0, paidBefore - refundAmount) * 100) / 100;
      const balanceAfter = Math.round(Math.max(0, orderTotal - paidAfter) * 100) / 100;
      transaction.set(orderRef, sanitizeFirestoreData({
        paidAmount: paidAfter,
        amountPaid: paidAfter,
        balanceAmount: balanceAfter,
        paymentStatus: nextPaymentStatus(orderTotal, paidAfter, text(order.status)),
        lastRefundPaymentId: refundId,
        lastRefundAt: serverTimestamp(),
        paymentReconciliationPending: false,
        updatedBy: createdBy,
        updatedAt: serverTimestamp(),
      }), { merge: true });

      let remaining = refundAmount;
      for (const piSnap of invoiceSnaps.reverse()) {
        if (!piSnap.exists() || remaining <= 0) continue;
        const pi = piSnap.data() as WorkflowRecord;
        const paidBeforePi = Number(pi.paidAmount ?? pi.amountPaid) || 0;
        if (paidBeforePi <= 0) continue;
        const applied = Math.min(remaining, paidBeforePi);
        const paidAfterPi = Math.round((paidBeforePi - applied) * 100) / 100;
        const total = Number(pi.total) || 0;
        transaction.set(piSnap.ref, sanitizeFirestoreData({
          paidAmount: paidAfterPi,
          amountPaid: paidAfterPi,
          balanceAmount: Math.round(Math.max(0, total - paidAfterPi) * 100) / 100,
          paymentStatus: nextPaymentStatus(total, paidAfterPi, text(order.status)),
          lastRefundPaymentId: refundId,
          lastRefundAt: serverTimestamp(),
          updatedBy: createdBy,
          updatedAt: serverTimestamp(),
        }), { merge: true });
        remaining = Math.round((remaining - applied) * 100) / 100;
      }
    });
  }

  await logActivity('Payments', 'Refunded Payment', paymentId, {
    refundPaymentId: refundId,
    orderId: linkedOrderId,
    entityName: customerName || linkedOrderId || paymentId,
    actionLabel: 'Refunded payment',
    reason,
  });
  notifyUsers(
    await usersByRole('Accounts'),
    NotificationType.PAYMENT_RECORDED,
    'Payment refunded',
    `Payment ${paymentId} was refunded with reversal entry ${refundId}.`,
    'payment',
    refundId,
    companyId
  );

  return { paymentId, refundPaymentId: refundId, orderId: linkedOrderId, amount: refundAmount };
}
