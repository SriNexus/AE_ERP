// features/sales/hooks/useSales.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAll, deleteDocById, genId, fmtDate, createDocWithId, resolveWriteCompanyId, resolveWriteCompanyCode, resolveWriteGroupId,
} from '../../../lib/firestore';
import { getNextDocumentNumber, resolveDocumentDefaults } from '../../../lib/documentNumbering';
import { COLLECTIONS, db } from '../../../lib/firebase';
import { useCurrentUser, useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { PAYMENT_MODES, PAYMENT_STATUSES } from '../../../config/company';
import toast from 'react-hot-toast';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { sanitizePayload } from '../../../lib/sanitizer';
import { usePaginatedCollection } from '../../../hooks/usePaginatedCollection';
import { NotificationType, type Order, type Quotation } from '../../../types';
import { notifyRoleUsers, sendNotification } from '../../../lib/notifications';
import { refundPayment } from '../../../lib/invoiceWorkflow';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';

// ── Orders ────────────────────────────────────────────────────

export const ORDER_FORM_DEFAULT = {
  customer: '', customerId: '', orderType: 'B2B', date: '', deliveryDate: '',
  status: 'Pending', paymentStatus: 'Pending', paymentMode: '', discount: '0',
  notes: '', shippingAddress: '', warehouseId: '',
};
export type OrderForm = typeof ORDER_FORM_DEFAULT;

export function useOrders() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return usePaginatedCollection<Order>(keys.ordersPaged, COLLECTIONS.ORDERS, 30_000);
}

// ── Quotations ───────────────────────────────────────────────

export const QUOTATION_FORM_DEFAULT = {
  orderId: '', projectId: '', engineeringDesignId: '', customer: '', customerId: '', customerPhone: '', customerEmail: '',
  customerAddress: '', customerGst: '', customerState: '', date: '', validUntil: '',
  status: 'Draft', notes: '', terms: '', deliveryTimeline: '',
  installationCharges: '', transportCharges: '', specialDiscount: '',
};
export type QuotationForm = typeof QUOTATION_FORM_DEFAULT;
export const QT_STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];

export function useQuotations() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return usePaginatedCollection<Quotation>(keys.quotationsPaged, COLLECTIONS.QUOTATIONS, 30_000);
}

function resolveCompanyId() {
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  // (activeCompanyId is 'default' post-logout until useGlobalBoot resolves it;
  // the old `activeCompanyId !== 'all'` branch returned that placeholder and
  // emitted where('companyId','==','default') reads → Admin 403 storm.)
  return resolveWriteCompanyId();
}

function addDaysIso(base: string | undefined, days: number) {
  const anchor = base ? new Date(base) : new Date();
  if (Number.isNaN(anchor.getTime())) return new Date(Date.now() + Math.max(0, days) * 86400000).toISOString().split('T')[0];
  const next = new Date(anchor);
  next.setDate(next.getDate() + Math.max(0, Number(days) || 0));
  return next.toISOString().split('T')[0];
}

export function useSalesProducts() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const company = useAppStore(s => s.company);
  const user = useAppStore(s => s.user);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  return useQuery({
    queryKey: ['products', companyId, 'all'],
    queryFn: async () => (await getAll(COLLECTIONS.PRODUCTS)).filter((product: any) => !product.companyId || product.companyId === companyId),
    staleTime: 60_000,
  });
}

export async function createQuotation(payload: Record<string, unknown>) {
  const companyId = String(payload.companyId || resolveCompanyId());
  const defaults = await resolveDocumentDefaults(companyId);
  const id = String(payload.id || genId.quotation());
  const { documentNumber } = await getNextDocumentNumber(companyId, 'quotation');
  const baseDate = String(payload.date || new Date().toISOString().split('T')[0]);
  const validUntil = String(payload.validUntil || addDaysIso(baseDate, defaults.settings.piValidityDays));
  await createDocWithId(COLLECTIONS.QUOTATIONS, id, {
    ...payload,
    id,
    companyId,
    quotationNumber: documentNumber,
    quoteNumber: documentNumber,
    refNo: documentNumber,
    validUntil,
    terms: String(payload.terms || defaults.settings.defaultTerms),
    notes: String(payload.notes || defaults.settings.defaultNotes),
  });
  // Phase 3B: Propagate caseId from customer chain to quotation
  void propagateCaseIdFromChain('quotations', id);
  return id;
}

export async function createPI(payload: Record<string, unknown>) {
  const companyId = String(payload.companyId || resolveCompanyId());
  const defaults = await resolveDocumentDefaults(companyId);
  const id = String(payload.id || genId.invoice());
  const { documentNumber } = await getNextDocumentNumber(companyId, 'invoice');
  const baseDate = String(payload.date || new Date().toISOString().split('T')[0]);
  await createDocWithId(COLLECTIONS.PROFORMA_INVOICES, id, {
    ...payload,
    id,
    companyId,
    invoiceNumber: documentNumber,
    piNumber: documentNumber,
    refNo: documentNumber,
    // Data-driven: the company's own companyCode (same source PI/index.ts and
    // theme.ts already key their template/theme selection off), never a
    // hardcoded company-name literal — see resolveWriteCompanyCode().
    templateUsed: resolveWriteCompanyCode(companyId),
    dueDate: String(payload.dueDate || addDaysIso(baseDate, defaults.settings.piValidityDays)),
    terms: String(payload.terms || defaults.settings.defaultTerms),
    notes: String(payload.notes || defaults.settings.defaultNotes),
  });
  // Phase 3B: Propagate caseId from order chain to proforma invoice
  void propagateCaseIdFromChain('proforma_invoices', id);
  return id;
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: createQuotation,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.quotationsRoot });
      toast.success('Quotation created');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useCreatePI() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: createPI,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success('PI created');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Invoices ─────────────────────────────────────────────────

export function useInvoices() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({ queryKey: keys.invoices, queryFn: () => getAll(COLLECTIONS.INVOICES), staleTime: 30_000 });
}

// ── Payments ─────────────────────────────────────────────────

export const PAYMENT_FORM_DEFAULT = {
  customer: '', customerId: '', orderId: '', amount: '', mode: 'UPI',
  status: 'Paid', date: new Date().toISOString().split('T')[0],
  reference: '', notes: '',
};
export type PaymentForm = typeof PAYMENT_FORM_DEFAULT;

export function paymentLinkageFromOrder(order: any) {
  const invoiceIds = Array.isArray(order?.generatedPIs)
    ? order.generatedPIs.map((id: unknown) => String(id || '')).filter(Boolean)
    : [];
  return sanitizePayload({
    projectId: String(order?.projectId || ''),
    quotationId: String(order?.quotationId || order?.sourceQuotationId || ''),
    engineeringDesignId: String(order?.engineeringDesignId || ''),
    invoiceId: invoiceIds[0] || '',
    invoiceIds,
  });
}
export function usePayments() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({ queryKey: keys.payments, queryFn: () => getAll(COLLECTIONS.PAYMENTS), staleTime: 30_000 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useSavePayment(onSuccess: (payment?: any) => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (data: PaymentForm) => {
      const id = genId.payment();
      const amount = Number(data.amount) || 0;
      let orderCreatorId = '';
      if (amount <= 0) throw new Error('Payment amount must be greater than zero');

      const groupId = resolveWriteGroupId(activeCompanyId);

      await runTransaction(db, async (transaction) => {
        const paymentRef = doc(db, COLLECTIONS.PAYMENTS, id);
        const paymentSnap = await transaction.get(paymentRef);
        if (paymentSnap.exists()) {
          throw new Error(`Payment ${id} already exists`);
        }

        const orderRef = data.orderId ? doc(db, COLLECTIONS.ORDERS, data.orderId) : null;
        const orderSnap = orderRef ? await transaction.get(orderRef) : null;
        const order = orderSnap?.exists() ? orderSnap.data() as any : null;
        orderCreatorId = String(order?.createdBy || '');

        if (data.orderId && !order) {
          throw new Error(`Order ${data.orderId} not found`);
        }
        if (order && order.companyId !== activeCompanyId) {
          throw new Error(`Order ${data.orderId} does not belong to the active company`);
        }

        const piRefs = order?.generatedPIs && Array.isArray(order.generatedPIs)
          ? order.generatedPIs.map((piId: string) => doc(db, COLLECTIONS.PROFORMA_INVOICES, piId))
          : [];
        const piSnaps = await Promise.all(piRefs.map((piRef: any) => transaction.get(piRef)));

        transaction.set(paymentRef, sanitizePayload({
          ...data,
          ...(order ? paymentLinkageFromOrder(order) : {}),
          id,
          amount,
          companyId: activeCompanyId,
          // Same "Group Admin cannot add stock" bug class: a raw Firestore
          // transaction bypasses createDocWithId()'s automatic groupId
          // stamping (Master Plan §3.4), and firestore.rules'
          // groupAdminCanCreate() requires a `groupId` field to match a
          // Group Admin actor recording a payment for a sibling Company.
          ...(groupId ? { groupId } : {}),
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          isDeleted: false,
        }));

        if (!orderRef || !order) return;

        const orderTotal = Number(order.total) || 0;
        const previousPaid = Number(order.paidAmount || order.amountPaid || 0) || 0;
        const paidAmount = Math.round((previousPaid + amount) * 100) / 100;
        if (orderTotal > 0 && paidAmount > orderTotal) {
          throw new Error(`Payment exceeds order balance. Balance: ${Math.max(0, orderTotal - previousPaid)}`);
        }

        const orderBalance = Math.round(Math.max(0, orderTotal - paidAmount) * 100) / 100;
        const paymentStatus = orderBalance <= 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Pending';

        let remaining = amount;
        piSnaps.forEach((piSnap) => {
          if (!piSnap.exists() || remaining <= 0) return;
          const pi = piSnap.data() as any;
          if (pi.companyId !== activeCompanyId) {
            throw new Error(`PI ${piSnap.id} does not belong to the active company`);
          }
          const piTotal = Number(pi.total) || 0;
          const piPaidBefore = Number(pi.paidAmount || pi.amountPaid || 0) || 0;
          const piBalanceBefore = Math.max(0, piTotal - piPaidBefore);
          const applied = Math.min(remaining, piBalanceBefore);
          const piPaidAmount = Math.round((piPaidBefore + applied) * 100) / 100;
          const piBalanceAmount = Math.round(Math.max(0, piTotal - piPaidAmount) * 100) / 100;
          const piPaymentStatus = piBalanceAmount <= 0 ? 'Paid' : piPaidAmount > 0 ? 'Partial' : 'Pending';
          remaining = Math.round((remaining - applied) * 100) / 100;

          transaction.set(piSnap.ref, sanitizePayload({
            paidAmount: piPaidAmount,
            amountPaid: piPaidAmount,
            balanceAmount: piBalanceAmount,
            paymentStatus: piPaymentStatus,
            lastPaymentId: id,
            lastPaymentAt: data.date || new Date().toISOString().split('T')[0],
            updatedBy: user.id,
            updatedAt: serverTimestamp(),
          }), { merge: true });
        });

        transaction.set(orderRef, sanitizePayload({
          paidAmount,
          amountPaid: paidAmount,
          balanceAmount: orderBalance,
          paymentStatus,
          lastPaymentId: id,
          lastPaymentAt: data.date || new Date().toISOString().split('T')[0],
          updatedBy: user.id,
          updatedAt: serverTimestamp(),
        }), { merge: true });
      });
      await notifyRoleUsers(
        ['Accounts', 'Director'],
        NotificationType.PAYMENT_RECORDED,
        'Payment recorded',
        `Payment ${id} was recorded for ${data.customer || data.orderId || 'customer'}.`,
        'payment',
        id,
        activeCompanyId
      );
      if (orderCreatorId && orderCreatorId !== user.id) {
        await sendNotification(
          orderCreatorId,
          NotificationType.PAYMENT_CONFIRMED,
          'Payment confirmed',
          `Payment ${id} was recorded for order ${data.orderId}.`,
          'payment',
          id,
          activeCompanyId
        );
      }
      return { ...data, id, amount };
    },
    onSuccess: (payment) => {
      qc.invalidateQueries({ queryKey: keys.payments });
      toast.success('Payment recorded');
      // Phase 3B: Propagate caseId from order to payment
      if (payment?.id) void propagateCaseIdFromChain('payments', payment.id as string);
      onSuccess(payment);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeletePayment() {
  const qc              = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.PAYMENTS, id);
      await notifyRoleUsers(['Accounts', 'Director'], NotificationType.PAYMENT_DELETED, 'Payment deleted', `Payment ${id} was deleted.`, 'payment', id, activeCompanyId);
    },
    onSuccess:  () => { qc.invalidateQueries({ queryKey: keys.payments }); toast.success('Payment deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}

export function useRefundPayment() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason?: string }) => refundPayment(paymentId, reason),
    onSuccess: ({ paymentId }) => {
      qc.invalidateQueries({ queryKey: keys.payments });
      qc.invalidateQueries({ queryKey: keys.ordersRoot });
      qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success(`Payment ${paymentId} refunded`);
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Payment refund failed'),
  });
}

export function exportPaymentsCSV(payments: any[]) {
  const rows = [
    ['ID', 'Customer', 'Order', 'Amount', 'Mode', 'Status', 'Date', 'Reference'],
    ...payments.map((p: any) => [p.id, p.customer, p.orderId, p.amount, p.mode, p.status, fmtDate(p.date), p.reference]),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'payments.csv';
  a.click();
  toast.success('Exported!');
}
