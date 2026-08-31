/**
 * CustomerB2BWorkflowPipeline — the B2B Center Panel's default view
 * (Compact Workspace & Central Panel B2B Workflow mission; refined into a
 * production-ready flow by the B2B Workflow Completeness mission; visually
 * and functionally completed by the Center Panel B2B Workflow Enhancement
 * mission; brought to always-visible active/inactive actions by the Final
 * UX Parity + B2B Production Readiness mission).
 *
 * B2B is the long-term customer relationship hub: Quotation → Order →
 * Invoice → Payment → Dispatch, shown as five connected stage cards (a
 * stepper rail links their step nodes) — each with a dedicated stage
 * illustration, its own status badge, latest-record context, and a Create/
 * Record action permanently anchored in the card header — so the Sales team
 * can see exactly where this customer stands and what to do next without
 * leaving the workspace.
 *
 * Final UI/UX Refinement mission: five small, transparent, hand-authored
 * illustrations (src/assets/customer-workspace/{quotation,order,invoice,
 * payment,dispatch}.png — duotone line pictograms, no gradients/glow/3D, on
 * a shared "light document/object fill + slate outline + one indigo accent
 * badge" visual language) now give each stage a real visual identity inside
 * the card itself, and the Create action moved into a single shared
 * component (CreateActionButton) permanently docked in the header's
 * top-right — see the StageCard/CreateActionButton doc comments below for
 * the full anatomy.
 *
 * Final UX Parity + B2B Production Readiness mission: every stage ALWAYS
 * renders both its primary action and "View Latest" — never omitted —
 * so the complete workflow stays visible even for a brand-new customer
 * with nothing yet. Each action carries its own `active` boolean (derived
 * strictly from real data/permissions, never invented) that only toggles
 * the button between its real and a subtly muted, disabled-but-not-broken
 * look — see StageCard. "View Latest" targets the current order's own
 * record when one exists, falling back to the most recent record from an
 * older order (folding the previous "View Previous" link into the same
 * always-visible action) so nothing reachable before is lost.
 *
 * Repeat-business design note: this customer can have MANY quotations,
 * orders, invoices, payments, and dispatches over its lifetime. Quotation/
 * Order/Payment/Dispatch each keep their "create/record another" action
 * permanently available (gated only on permission and on the real
 * predecessor existing), never hidden just because a previous one already
 * exists.
 *
 * Order-specific, not just "latest by date" (Invoice/Payment/Dispatch): the
 * B2B Workflow Completeness mission's own audit found that once a repeat
 * customer places Order #2, showing Order #1's invoice/payment/dispatch as
 * if everything were in order would be actively misleading — Order #2
 * genuinely has none of those yet. So each of these three stages checks
 * records tied to the CURRENT latest order (via `orderId`) for its badge
 * and Create action, never invented as if it belonged to the current order.
 *
 * Blocked vs actionable vs done: Invoice/Payment/Dispatch cannot happen
 * before an Order exists — those cards show "Not Available Yet" (muted
 * badge, both actions rendered but inactive) until `latestOrder` exists.
 * Once unblocked but not yet acted on, they show "Action Needed". Once a
 * record exists, the card shows that record's OWN real status via the
 * shared statusBadge() — never invented.
 *
 * Reuse discipline (no duplicate business logic, no second Invoice/Payment
 * workspace):
 *   - Quotation/Order "create" actions call the EXISTING
 *     useCustomerCenterWorkflow handlers (goToQuotation/goToOrder) — the
 *     same functions CustomerCenterSnapshot's old action cards called and
 *     the Right Panel's Quick Actions still call. Clicking here launches the
 *     exact same embedded CustomerQuotationForm/CustomerOrderForm
 *     CustomerCenterPanel already renders for those views.
 *   - "Generate Invoice" calls useGeneratePIFromOrder() (features/orders/
 *     hooks/useOrders.ts), the EXACT hook/mutation Orders.tsx's own
 *     "Generate PI" button calls (generatePIsFromOrder() in
 *     lib/invoiceWorkflow.ts) — same PI-splitting-by-category logic, same
 *     order.piGenerated/generatedPIs bookkeeping, same notifications.
 *   - "Record Payment" calls useSavePayment() (features/sales/hooks/useSales.ts)
 *     — the EXACT hook the real Payments.tsx page's own "Record Payment"
 *     button uses (a Firestore transaction that writes the payment AND
 *     updates the linked order's/PI's paidAmount/balanceAmount/paymentStatus
 *     in one atomic write). NOTE: this codebase also has an older, separate
 *     lib/paymentWorkflow.ts + features/payment/hooks/usePayment.ts module
 *     — that is NOT what the real Payments page uses, so it is deliberately
 *     NOT used here either, to avoid standing up a second, divergent
 *     payment system for this workspace.
 *   - "View Latest"/"View Previous"/"View" (Quotation/Order/Invoice/
 *     Payment/Dispatch) navigate DIRECTLY to the real, existing per-record
 *     workspace/list routes (unchanged from the B2B Workflow Completeness
 *     mission, already verified end-to-end) — this panel never renders
 *     invoice/payment line items, PDF templates, or status-transition logic
 *     itself. It is a summary + navigation point, not a second implementation.
 *   - Dispatch's "Request Dispatch" reuses the exact same
 *     DispatchRequestModal/requestDispatch()/loadOrderForDispatch pattern
 *     CustomerDispatchSection (now folded into this pipeline) already used.
 *
 * Data: one shared useCustomerBillingContext(customer) call (React Query
 * dedups against every other consumer already on this page) plus a single
 * additional products query needed for the Dispatch request form's line
 * items — mirrors CustomerDispatchSection's own prior sourcing exactly.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { statusBadge } from '../../../../components/ui/Badge';
import quotationIllustration from '../../../../assets/customer-workspace/quotation.png';
import orderIllustration from '../../../../assets/customer-workspace/order.png';
import invoiceIllustration from '../../../../assets/customer-workspace/invoice.png';
import paymentIllustration from '../../../../assets/customer-workspace/payment.png';
import dispatchIllustration from '../../../../assets/customer-workspace/dispatch.png';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { Input, Select, Textarea, FormRow } from '../../../../components/ui/Input';
import { fmtCurrency, fmtDate, getAll } from '../../../../lib/firestore';
import { COLLECTIONS } from '../../../../lib/firebase';
import { PAYMENT_MODES, PAYMENT_STATUSES } from '../../../../config/company';
import { usePermissions } from '../../../../lib/permissions';
import { requestDispatch } from '../../../../lib/dispatchWorkflow';
import { DEFAULT_FORM } from '../../../dispatch/utils/dispatchWorkspaceUtils';
import { DispatchRequestModal } from '../../../dispatch/components/DispatchRequestModal';
import { useWarehouses } from '../../../warehouses/hooks/useWarehouses';
import { useGeneratePIFromOrder } from '../../../orders/hooks/useOrders';
import { useSavePayment, PAYMENT_FORM_DEFAULT, type PaymentForm } from '../../../sales/hooks/useSales';
import { useCustomerBillingContext } from '../../hooks/useCustomerBillingContext';
import { dispatchCustomer, dispatchWarehouse, dispatchAssigned } from '../../../dispatch/utils/dispatchWorkspaceUtils';
import { mostRecentByDate } from './CustomerWorkspaceKpis';
import { hasActiveBatch } from './CustomerWorkspaceHeader';
import WorkflowCard from './WorkflowCard';
import type { RecordFact } from './RecordFacts';
import type { CustomerCenterWorkflow } from '../../hooks/useCustomerCenterWorkflow';

interface Props {
  customer: any;
  workflow: CustomerCenterWorkflow;
}



/** Record Payment — small local modal, same pattern as the Dispatch request
 * flow below: real mutation (useSavePayment), no parallel business logic.
 * Defaults to the customer's latest order but lets the user pick any of
 * this customer's orders (a repeat customer may need to record a payment
 * against an older order after a newer one has already been created). */
function RecordPaymentModal({ open, onClose, customer, orders, defaultOrderId }: {
  open: boolean;
  onClose: () => void;
  customer: any;
  orders: any[];
  defaultOrderId: string;
}) {
  const customerDisplayName = customer.companyName || customer.company || customer.name || '';
  const [form, setForm] = useState<PaymentForm>({ ...PAYMENT_FORM_DEFAULT, customer: customerDisplayName, customerId: customer.id });

  useEffect(() => {
    if (!open) return;
    const order = orders.find((o: any) => o.id === defaultOrderId);
    setForm({
      ...PAYMENT_FORM_DEFAULT,
      customer: order?.customer || customerDisplayName,
      customerId: customer.id,
      orderId: defaultOrderId || '',
      amount: order?.balanceAmount != null ? String(order.balanceAmount) : order?.total != null ? String(order.total) : '',
      date: new Date().toISOString().split('T')[0],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultOrderId]);

  const qc = useQueryClient();
  const saveMut = useSavePayment(() => {
    // useSavePayment's own invalidation targets the company-wide payments
    // list (Payments.tsx) — this workspace reads orders/payments through the
    // separate customer-scoped useCustomerBillingContext query keys, so they
    // need their own invalidation too, same as Invoice generation/Dispatch
    // requests above.
    qc.invalidateQueries({ queryKey: ['customer-kpi-orders', customer.id] });
    qc.invalidateQueries({ queryKey: ['customer-kpi-payments', customer.id] });
    onClose();
  });

  function handleOrderChange(orderId: string) {
    const order = orders.find((o: any) => o.id === orderId);
    setForm((f) => ({
      ...f,
      orderId,
      customer: order?.customer || f.customer,
      amount: order?.balanceAmount != null ? String(order.balanceAmount) : order?.total != null ? String(order.total) : f.amount,
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveMut.isPending) return;
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Payment amount must be greater than zero');
    saveMut.mutate(form);
  }

  const orderOptions = [...orders]
    .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .map((o: any) => ({ label: `${o.orderNumber || o.orderNo || o.id} — ${fmtCurrency(o.total)}`, value: o.id }));

  return (
    <Modal open={open} onClose={onClose} title="Record Payment" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Order"
          value={form.orderId}
          onChange={(e) => handleOrderChange(e.target.value)}
          options={[{ label: 'No order linked', value: '' }, ...orderOptions]}
        />
        <FormRow>
          <Input label="Amount (₹)" type="number" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </FormRow>
        <FormRow>
          <Select label="Payment Mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} options={PAYMENT_MODES.map((m) => ({ label: m, value: m }))} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={PAYMENT_STATUSES.map((s) => ({ label: s, value: s }))} />
        </FormRow>
        <Input label="Reference / UTR / Cheque No." value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Transaction reference" />
        <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={saveMut.isPending}>Cancel</Button>
          <Button type="submit" loading={saveMut.isPending}>Record Payment</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function CustomerB2BWorkflowPipeline({ customer, workflow }: Props) {
  const navigate = useNavigate();
  const perms = usePermissions();
  const qc = useQueryClient();
  const {
    quotations, orders, invoices, payments, dispatches,
  } = useCustomerBillingContext(customer);

  // Display-only lookup so Quotation / Invoice / Payment facts can show the
  // human order number their list rows show (built from the same `orders`
  // already loaded above — no extra query).
  const orderNumberById = new Map<string, string>(
    (orders as any[]).map((o: any) => [String(o.id), o.orderNumber || o.orderNo || o.id]),
  );

  const canCreateQuotations = perms.canCreate('quotations');
  const canCreateOrders = perms.canCreate('orders');
  const canGenerateInvoice = perms.canCreate('invoices');
  const canRecordPayment = perms.canCreate('payments');
  const canRequestDispatch = perms.canCreate('dispatch');

  // ── Dispatch request modal — same pattern as the retired standalone
  // CustomerDispatchSection: DispatchRequestModal + requestDispatch() +
  // loadOrderForDispatch, reused verbatim, not reimplemented. ──
  const { data: warehouses = [] } = useWarehouses();
  const { data: products = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => getAll<any>(COLLECTIONS.PRODUCTS),
    staleTime: 60000,
  });
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [dispatchForm, setDispatchForm] = useState({ ...DEFAULT_FORM, customerId: customer.id, customer: customer.name || customer.company || '' });
  const [dispatchItems, setDispatchItems] = useState<any[]>([]);
  const eligibleOrders = (orders as any[]).filter((o: any) => o.status !== 'Dispatched');

  function loadOrderForDispatch(orderId: string) {
    const order = (orders as any[]).find((row: any) => row.id === orderId);
    if (!order) return;
    setDispatchForm((prev) => ({ ...prev, orderId, customerId: order.customerId || customer.id, customer: order.customer || prev.customer }));
    const pendingItems = (order.items || [])
      .map((item: any, idx: number) => ({ item, idx }))
      .filter(({ item }: any) => (item.pendingQty || item.qty) > 0)
      .map(({ item, idx }: any) => {
        const product = (products as any[]).find((row: any) => row.id === item.productId);
        return {
          orderLineId: item.lineId || item.id || `idx:${idx}`,
          orderLineIndex: idx,
          productId: item.productId,
          product: item.product,
          requestedQty: item.pendingQty || item.qty,
          maxQty: item.pendingQty || item.qty,
          trackingType: product?.trackingType || 'none',
          unit: item.unit || 'PCS',
        };
      });
    setDispatchItems(pendingItems);
  }

  const createDispatchReq = useMutation({
    mutationFn: (payload: any) => requestDispatch(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-kpi-dispatches', customer.id] });
      qc.invalidateQueries({ queryKey: ['dispatchRoot'] });
      toast.success('Dispatch request submitted');
      setShowRequestForm(false);
      setDispatchForm({ ...DEFAULT_FORM, customerId: customer.id, customer: customer.name || customer.company || '' });
      setDispatchItems([]);
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to submit dispatch request'),
  });

  // ── Invoice generation — the exact hook/mutation Orders.tsx's own
  // "Generate PI" button uses (useGeneratePIFromOrder -> generatePIsFromOrder
  // in lib/invoiceWorkflow.ts). Its own onSuccess already invalidates the
  // Orders/Invoices list queries; this call's extra onSuccess (passed at
  // .mutate() call time) additionally invalidates THIS page's own
  // customer-scoped query keys so the pipeline reflects the new invoice
  // immediately, without duplicating any of the actual PI-generation logic. ──
  const generateInvoice = useGeneratePIFromOrder();

  const [showPaymentForm, setShowPaymentForm] = useState(false);

  // ── Stage 1: Quotation — never blocked, always creatable. ──
  const latestQuotation = mostRecentByDate(quotations, 'date');
  // ── Stage 2: Order — never blocked, always creatable. "Active Batch"
  // (an order recorded within the last 30 days) used to be its own
  // competing header badge — Premium UX Redesign mission moved it here,
  // where an order-recency signal actually belongs, as plain inline text
  // rather than a fourth badge. Same hasActiveBatch() calculation, reused
  // from CustomerWorkspaceHeader, not reimplemented. ──
  const latestOrder = mostRecentByDate(orders, 'date');
  const hasOrder = !!latestOrder;
  const isActiveBatch = hasActiveBatch(orders);

  // ── Stage 3: Invoice — blocked until an Order exists; order-specific,
  // not just "latest by date" (see the file doc comment for why this
  // matters for repeat business). ──
  const invoicesForLatestOrder = latestOrder ? (invoices as any[]).filter((inv: any) => inv.orderId === latestOrder.id) : [];
  const invoiceForLatestOrder = mostRecentByDate(invoicesForLatestOrder, 'date');
  const previousInvoice = mostRecentByDate((invoices as any[]).filter((inv: any) => inv.id !== invoiceForLatestOrder?.id), 'date');

  // ── Stage 4: Payment — blocked until an Order exists; also order-specific
  // (a repeat customer's newer order genuinely has no payment yet just
  // because an older one is fully paid). `latestOrder.paymentStatus` is
  // maintained by the SAME useSavePayment transaction, so it is read
  // directly rather than re-derived from the payments list. ──
  const paymentsForLatestOrder = latestOrder ? (payments as any[]).filter((p: any) => p.orderId === latestOrder.id) : [];
  const latestPaymentForOrder = mostRecentByDate(paymentsForLatestOrder, 'date');
  const previousPayment = mostRecentByDate((payments as any[]).filter((p: any) => p.id !== latestPaymentForOrder?.id), 'date');

  // ── Stage 5: Dispatch — blocked until an Order exists; also order-specific.
  // "Request Dispatch" is only offered while at least one order is still
  // eligible (not already fully Dispatched) — otherwise the request modal's
  // own order picker would be empty, which is exactly the "fake action"
  // this workflow must never show. ──
  const dispatchesForLatestOrder = latestOrder ? (dispatches as any[]).filter((d: any) => d.orderId === latestOrder.id) : [];
  const dispatchForLatestOrder = mostRecentByDate(dispatchesForLatestOrder, 'date');
  const previousDispatch = mostRecentByDate((dispatches as any[]).filter((d: any) => d.id !== dispatchForLatestOrder?.id), 'date');
  const canRequestDispatchNow = eligibleOrders.length > 0;

  // ── "View Latest" always targets the current order's own record when one
  // exists; otherwise it falls back to the most recent record from an older
  // order (folding the old separate "View Previous" link into the single,
  // always-visible "View Latest" action the mission asks for) — never
  // invented, never a dead click when something real exists to show. ──
  const invoiceViewTarget = invoiceForLatestOrder || previousInvoice;
  const paymentViewTarget = latestPaymentForOrder || previousPayment;
  const dispatchViewTarget = dispatchForLatestOrder || previousDispatch;

  return (
    <div>
      <WorkflowCard
        title="Quotation"
        illustration={quotationIllustration}
        badge={latestQuotation ? statusBadge(latestQuotation.status || 'Draft') : statusBadge('Not Started')}
        summary={latestQuotation
          ? <>{latestQuotation.quotationNumber || latestQuotation.quoteNumber || latestQuotation.id} · {fmtCurrency(latestQuotation.total)} · {fmtDate(latestQuotation.date)}</>
          : 'No quotation yet for this customer.'}
        facts={latestQuotation ? [
          { label: 'Quotation', value: latestQuotation.quotationNumber || latestQuotation.quoteNumber || latestQuotation.id },
          { label: 'Order', value: latestQuotation.orderId ? orderNumberById.get(String(latestQuotation.orderId)) : null },
          { label: 'Date', value: fmtDate(latestQuotation.date) },
          { label: 'Valid Until', value: fmtDate(latestQuotation.validUntil) },
          { label: 'Items', value: `${(latestQuotation.items || []).length} items` },
          { label: 'Total', value: fmtCurrency(latestQuotation.total) },
        ] : undefined}
        action={{ label: 'Create Quotation', onClick: workflow.goToQuotation, active: canCreateQuotations }}
        viewAction={{
          label: 'View Latest', active: !!latestQuotation,
          onClick: () => latestQuotation && navigate(`/quotations/${encodeURIComponent(latestQuotation.id)}`),
        }}
      />
      <WorkflowCard
        title="Order"
        illustration={orderIllustration}
        badge={latestOrder ? statusBadge(latestOrder.status || 'Pending') : statusBadge('Not Started')}
        summary={latestOrder
          ? <>{latestOrder.orderNumber || latestOrder.orderNo || latestOrder.id} · {fmtCurrency(latestOrder.total)} · {fmtDate(latestOrder.date)}{isActiveBatch && <> · <span className="text-[var(--color-primary-text)] font-semibold">Active batch (ordered within 30 days)</span></>}</>
          : 'No order yet for this customer.'}
        facts={latestOrder ? [
          { label: 'Order', value: latestOrder.orderNumber || latestOrder.orderNo || latestOrder.id },
          { label: 'Type', value: latestOrder.orderType || 'B2C' },
          { label: 'Date', value: fmtDate(latestOrder.date || latestOrder.createdAt) },
          { label: 'Delivery', value: fmtDate(latestOrder.deliveryDate) },
          { label: 'Items', value: `${(latestOrder.items || []).length} items` },
          { label: 'Total', value: fmtCurrency(latestOrder.total) },
          { label: 'Payment', value: latestOrder.paymentStatus || 'Pending' },
          { label: 'Batch', value: isActiveBatch ? 'Active · within 30 days' : null },
        ] : undefined}
        action={{ label: 'Create Order', onClick: () => void workflow.goToOrder(), active: canCreateOrders, loading: workflow.orderCheckLoading }}
        viewAction={{
          label: 'View Latest', active: !!latestOrder,
          onClick: () => latestOrder && navigate(`/orders/${encodeURIComponent(latestOrder.id)}`),
        }}
      />
      <WorkflowCard
        title="Invoice"
        illustration={invoiceIllustration}
        badge={
          !hasOrder ? statusBadge('Not Available Yet')
          : invoiceForLatestOrder ? statusBadge(invoiceForLatestOrder.paymentStatus || invoiceForLatestOrder.status || 'Pending')
          : statusBadge('Action Needed')
        }
        summary={
          !hasOrder ? 'Create an order first — invoices are generated from an order.'
          : invoiceForLatestOrder
            ? <>{invoiceForLatestOrder.invoiceNumber || invoiceForLatestOrder.piNumber || invoiceForLatestOrder.id} · {fmtCurrency(invoiceForLatestOrder.total)} · {fmtDate(invoiceForLatestOrder.date)}</>
            : <>Order {latestOrder.orderNumber || latestOrder.orderNo || latestOrder.id} has no invoice yet.</>
        }
        facts={invoiceForLatestOrder ? [
          { label: 'Invoice', value: invoiceForLatestOrder.invoiceNumber || invoiceForLatestOrder.piNumber || invoiceForLatestOrder.id },
          { label: 'Order', value: orderNumberById.get(String(invoiceForLatestOrder.orderId)) || (latestOrder && (latestOrder.orderNumber || latestOrder.orderNo)) },
          { label: 'Date', value: fmtDate(invoiceForLatestOrder.date || invoiceForLatestOrder.createdAt) },
          { label: 'Due', value: fmtDate(invoiceForLatestOrder.dueDate) },
          { label: 'Tax', value: invoiceForLatestOrder.taxAmount != null ? fmtCurrency(invoiceForLatestOrder.taxAmount) : null },
          { label: 'Total', value: fmtCurrency(invoiceForLatestOrder.total) },
          { label: 'Payment', value: invoiceForLatestOrder.paymentStatus || 'Pending' },
        ] : undefined}
        action={{
          label: 'Generate Invoice',
          active: hasOrder && !invoiceForLatestOrder && canGenerateInvoice,
          loading: generateInvoice.isPending,
          onClick: () => hasOrder && !invoiceForLatestOrder && generateInvoice.mutate(latestOrder, {
            onSuccess: () => {
              qc.invalidateQueries({ queryKey: ['customer-kpi-orders', customer.id] });
              qc.invalidateQueries({ queryKey: ['customer-kpi-invoices', customer.id] });
            },
          }),
        }}
        viewAction={{
          label: 'View Latest', active: !!invoiceViewTarget,
          onClick: () => invoiceViewTarget && navigate(`/invoices/${encodeURIComponent(invoiceViewTarget.id)}`),
        }}
      />
      <WorkflowCard
        title="Payment"
        illustration={paymentIllustration}
        badge={
          !hasOrder ? statusBadge('Not Available Yet')
          : latestPaymentForOrder ? statusBadge(latestOrder.paymentStatus || latestPaymentForOrder.status || 'Pending')
          : statusBadge('Action Needed')
        }
        summary={
          !hasOrder ? 'Create an order first — payments are recorded against an order.'
          : latestPaymentForOrder
            ? <>{fmtCurrency(latestPaymentForOrder.amount)} · {latestPaymentForOrder.mode} · {fmtDate(latestPaymentForOrder.date)}</>
            : <>Order {latestOrder.orderNumber || latestOrder.orderNo || latestOrder.id} is awaiting payment.</>
        }
        facts={latestPaymentForOrder ? [
          { label: 'Pay ID', value: latestPaymentForOrder.paymentNumber || latestPaymentForOrder.id },
          { label: 'Date', value: fmtDate(latestPaymentForOrder.date || latestPaymentForOrder.createdAt) },
          { label: 'Order', value: latestPaymentForOrder.orderId ? (orderNumberById.get(String(latestPaymentForOrder.orderId)) || latestPaymentForOrder.orderId) : null },
          { label: 'Amount', value: fmtCurrency(latestPaymentForOrder.amount) },
          { label: 'Mode', value: latestPaymentForOrder.mode },
          { label: 'Reference', value: latestPaymentForOrder.reference },
        ] : undefined}
        action={{ label: 'Record Payment', onClick: () => setShowPaymentForm(true), active: hasOrder && canRecordPayment }}
        viewAction={{
          label: 'View Latest', active: !!paymentViewTarget,
          onClick: () => paymentViewTarget && navigate(`/payments/${encodeURIComponent(paymentViewTarget.id)}`),
        }}
      />
      <WorkflowCard
        title="Dispatch"
        illustration={dispatchIllustration}
        badge={
          !hasOrder ? statusBadge('Not Available Yet')
          : dispatchForLatestOrder ? statusBadge(dispatchForLatestOrder.status || 'Pending Verification')
          : statusBadge('Action Needed')
        }
        summary={
          !hasOrder ? 'Create an order first — dispatch is requested against an order.'
          : dispatchForLatestOrder
            ? <>{dispatchForLatestOrder.dispatchNumber || dispatchForLatestOrder.dispatchId || dispatchForLatestOrder.id} · {dispatchForLatestOrder.vehicleNo}{dispatchForLatestOrder.driverName ? ` · ${dispatchForLatestOrder.driverName}` : ''}</>
            : <>Order {latestOrder.orderNumber || latestOrder.orderNo || latestOrder.id} has not been dispatched yet.</>
        }
        facts={dispatchForLatestOrder ? [
          { label: 'Dispatch', value: dispatchForLatestOrder.dispatchNumber || dispatchForLatestOrder.dispatchNo || dispatchForLatestOrder.dispatchId || dispatchForLatestOrder.id },
          { label: 'Warehouse', value: dispatchWarehouse(dispatchForLatestOrder) },
          { label: 'Vehicle', value: dispatchForLatestOrder.vehicleNo },
          { label: 'Driver', value: dispatchForLatestOrder.driverName },
          { label: 'Assigned', value: dispatchAssigned(dispatchForLatestOrder) },
          { label: 'Date', value: fmtDate(dispatchForLatestOrder.date || dispatchForLatestOrder.createdAt) },
        ] : undefined}
        action={{
          label: 'Request Dispatch',
          active: canRequestDispatchNow && canRequestDispatch,
          onClick: () => { if (!canRequestDispatchNow) return; loadOrderForDispatch(latestOrder.id); setShowRequestForm(true); },
        }}
        viewAction={{
          label: 'View Latest', active: !!dispatchViewTarget,
          onClick: () => dispatchViewTarget && navigate(`/dispatch/${encodeURIComponent(dispatchViewTarget.id)}`),
        }}
      />

      <RecordPaymentModal
        open={showPaymentForm}
        onClose={() => setShowPaymentForm(false)}
        customer={customer}
        orders={orders as any[]}
        defaultOrderId={latestOrder?.id || ''}
      />

      <DispatchRequestModal
        open={showRequestForm}
        onClose={() => setShowRequestForm(false)}
        form={dispatchForm}
        setForm={setDispatchForm}
        items={dispatchItems}
        setItems={setDispatchItems}
        orders={eligibleOrders}
        warehouses={warehouses as any[]}
        onOrderSelect={loadOrderForDispatch}
        onSubmit={() => createDispatchReq.mutate({ ...dispatchForm, items: dispatchItems.filter((item) => item.requestedQty > 0) })}
        submitting={createDispatchReq.isPending}
      />
    </div>
  );
}
