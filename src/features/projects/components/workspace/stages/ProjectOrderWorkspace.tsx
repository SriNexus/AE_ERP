/**
 * ProjectOrderWorkspace — the Order stage's operational workspace, embedded
 * inside "Work on This Project" (Stage 5 — Order mission; the standalone
 * Order view popup was retired). Built the same way ProjectSurveyWorkspace /
 * ProjectEngineeringWorkspace / ProjectQuotationWorkspace were: surfaces the
 * EXISTING Order system verbatim, no parallel implementation.
 *
 * Reuse discipline:
 *   - useOrders() (features/sales/hooks/useSales.ts) is the exact hook the
 *     Orders list page already uses — same data source, query-keyed and
 *     deduped, never a second Order query.
 *   - useQuotations() is the exact hook the Quotations list page and
 *     ProjectQuotationWorkspace already use — project-linked quotations are
 *     the only legitimate Order source.
 *   - useConvertQuotationToOrder() (features/quotations/hooks/useQuotations.ts)
 *     is the exact conversion mutation the standalone Quotation popup and
 *     ProjectQuotationWorkspace already use — same convertQuotationToOrder
 *     business logic (lib/quotationWorkflow.ts): it creates the real Order
 *     document with the quotation's items/quantities/pricing/totals, maps
 *     dispatch tracking fields (dispatchedQty/pendingQty), writes
 *     sourceQuotationId/projectId/engineeringDesignId, links + advances the
 *     project (projectOrderPatch), locks the quotation
 *     (status 'Converted to Order' / convertedOrderId), propagates caseId
 *     and notifies. There is NO manual item entry anywhere in this
 *     workspace: the quotation is the source of the Order's contents.
 *   - isQuotationLocked() (lib/quotationWorkflow.ts) is the real
 *     quotation-lock state — only non-converted quotations are offered for
 *     conversion here, so a second Order can never be placed from the same
 *     quotation.
 *
 * States:
 *   - No Order yet + the project has a convertible quotation → the simple
 *     creation flow: Select Quotation → read-only preview (items, qty,
 *     pricing, totals) → Place Order (the existing conversion service).
 *   - Order(s) exist → the real Order state/result: latest order (selector
 *     when several) with its real data — number, status, payment status,
 *     customer, order type, dates, read-only items table and totals — plus
 *     a link to the full /orders/:id workspace. If an unconverted quotation
 *     still exists, a quiet "Place another order" toggle re-offers the
 *     creation flow (the ERP legitimately supports multiple Orders per
 *     project — the B2B pipeline's Order #2 flow).
 *   - No Order and no convertible quotation → guidance to create the
 *     quotation at Stage 3; a pagination gap on linked Orders shows a
 *     loading hint instead of a creation surface (same guard the Quotation
 *     workspace uses — no duplicate records).
 *
 * The old popup's Notes / Documents / Activity / email supporting sections
 * are deliberately NOT carried in here; the /orders/:id detail page keeps
 * the Documents/Notes/email surfaces.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowUpRight, CheckCircle2, FileText, Package, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../../../components/ui/Button';
import { Select, FormSection } from '../../../../../components/ui/Input';
import { statusBadge } from '../../../../../components/ui/Badge';
import { fmtCurrency, fmtDate } from '../../../../../lib/firestore';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import { useOrders, useQuotations } from '../../../../sales/hooks/useSales';
import { useConvertQuotationToOrder } from '../../../../quotations/hooks/useQuotations';
import { isQuotationLocked } from '../../../../../lib/quotationWorkflow';
import type { ProjectStageWorkspaceProps } from './types';

function orderDisplayNumber(order: any): string {
  return String(order?.orderNumber || order?.orderNo || '').trim() || String(order?.id || '—');
}

/** Read-only preview of what will become the Order — the exact real data
 * the quotation carries (items, quantities, unit prices, tax, totals). The
 * user never edits here: per the Order stage mission, changes happen on the
 * quotation (Stage 3) and the preview reflects the quotation's real state. */
function QuotationPreview({ quote, currencySymbol }: { quote: any; currencySymbol: string }) {
  const total = Number(quote.total) || 0;
  const subtotal = Number(quote.subtotal) || 0;
  const taxTotal = Number(quote.taxTotal ?? quote.taxAmount) || 0;
  const extraDisplay = (Number(quote.installationCharges) || 0) + (Number(quote.transportCharges) || 0);
  const discountDisplay = Number(quote.discount || quote.specialDiscount || 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">
              {quote.quotationNumber || quote.quoteNumber || quote.refNo || quote.id}
            </p>
            {statusBadge(quote.status || 'Draft')}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {quote.customer || '—'} · {quote.validUntil ? <>Valid until {fmtDate(quote.validUntil)} · </> : null}{fmtCurrency(total, currencySymbol)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        {Array.isArray(quote.items) && quote.items.length ? (
          <table className="min-w-full text-xs">
            <thead className="bg-[var(--color-bg-sunken)]">
              <tr>
                {['Product', 'Qty', 'Unit Price', 'Tax %', 'Line Total'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {quote.items.map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="px-3 py-2 text-[var(--color-text)]">{item.product || 'Custom item'}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.qty || 0} {item.unit || ''}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{fmtCurrency(Number(item.price) || 0, currencySymbol)}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{Number(item.tax) || 0}</td>
                  <td className="px-3 py-2 font-semibold text-[var(--color-text)]">{fmtCurrency((Number(item.qty) || 0) * (Number(item.price) || 0), currencySymbol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex items-center gap-2 px-3 py-5 text-xs text-[var(--color-text-muted)]">
            <Package className="h-4 w-4" /> No line items on this quotation.
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <div className="w-72 space-y-1.5 text-sm rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
          <div className="flex justify-between text-[var(--color-text-secondary)]"><span>Subtotal</span><span>{fmtCurrency(subtotal, currencySymbol)}</span></div>
          <div className="flex justify-between text-[var(--color-text-secondary)]"><span>GST / Tax</span><span>{fmtCurrency(taxTotal, currencySymbol)}</span></div>
          {extraDisplay > 0 && <div className="flex justify-between text-[var(--color-text-secondary)]"><span>Charges</span><span>{fmtCurrency(extraDisplay, currencySymbol)}</span></div>}
          {discountDisplay > 0 && <div className="flex justify-between text-[var(--color-success-text)]"><span>Discount</span><span>- {fmtCurrency(discountDisplay, currencySymbol)}</span></div>}
          <div className="flex justify-between border-t border-[var(--color-border-subtle)] pt-1.5 font-bold text-[var(--color-text)]">
            <span>Order Total</span><span>{fmtCurrency(total, currencySymbol)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The real Order state/result — the latest (or selected) order for this
 * project with its actual record data; a link to the full /orders/:id
 * workspace keeps the Documents/Notes/PI/email surfaces where they already
 * live. */
function OrderStateView({ orders, currencySymbol }: { orders: any[]; currencySymbol: string }) {
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const activeOrder = orders.find((o) => o.id === activeId) || orders[0];

  const items = Array.isArray(activeOrder?.items) ? activeOrder.items : [];
  const subtotal = Number(activeOrder?.subtotal) || 0;
  const taxTotal = Number(activeOrder?.taxTotal ?? activeOrder?.taxAmount) || 0;
  const discount = Number(activeOrder?.discount) || 0;
  const total = Number(activeOrder?.total) || 0;
  const paidAmount = Number(activeOrder?.paidAmount || activeOrder?.amountPaid) || 0;

  return (
    <div className="space-y-3">
      {orders.length > 1 && (
        <Select
          label="Order"
          value={activeOrder.id}
          onChange={(e) => setActiveId(e.target.value)}
          options={orders.map((o) => ({ label: `${orderDisplayNumber(o)} · ${o.status || 'Pending'}`, value: o.id }))}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{orderDisplayNumber(activeOrder)}</p>
            {statusBadge(activeOrder.status || 'Pending')}
            {statusBadge(activeOrder.paymentStatus || 'Pending')}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {activeOrder.customer || '—'} · {activeOrder.orderType || '—'} · {fmtCurrency(total, currencySymbol)}
            {paidAmount > 0 && <> · Paid {fmtCurrency(paidAmount, currencySymbol)}</>}
          </p>
        </div>
        <Button
          size="xs"
          variant="outline"
          icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          onClick={() => navigate(`/orders/${encodeURIComponent(activeOrder.id)}`)}
        >
          Open in full workspace
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          ['Order Date', fmtDate(activeOrder.date || activeOrder.createdAt)],
          ['Delivery', activeOrder.deliveryDate ? fmtDate(activeOrder.deliveryDate) : '—'],
          ['Items', `${items.length}`],
          ['Subtotal', fmtCurrency(subtotal, currencySymbol)],
          ['Tax', fmtCurrency(taxTotal, currencySymbol)],
          ['Discount', discount > 0 ? fmtCurrency(discount, currencySymbol) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        {items.length ? (
          <table className="min-w-full text-xs">
            <thead className="bg-[var(--color-bg-sunken)]">
              <tr>
                {['Product', 'Qty', 'Unit Price', 'Tax %', 'Line Total'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {items.map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="px-3 py-2 text-[var(--color-text)]">{item.product || 'Custom item'}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.qty || 0} {item.unit || ''}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{fmtCurrency(Number(item.price) || 0, currencySymbol)}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{Number(item.tax) || 0}</td>
                  <td className="px-3 py-2 font-semibold text-[var(--color-text)]">{fmtCurrency((Number(item.qty) || 0) * (Number(item.price) || 0), currencySymbol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex items-center gap-2 px-3 py-5 text-xs text-[var(--color-text-muted)]">
            <Package className="h-4 w-4" /> No line items on this order.
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <div className="w-72 space-y-1.5 text-sm rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
          <div className="flex justify-between text-[var(--color-text-secondary)]"><span>Subtotal</span><span>{fmtCurrency(subtotal, currencySymbol)}</span></div>
          <div className="flex justify-between text-[var(--color-text-secondary)]"><span>GST / Tax</span><span>{fmtCurrency(taxTotal, currencySymbol)}</span></div>
          {discount > 0 && <div className="flex justify-between text-[var(--color-success-text)]"><span>Discount</span><span>- {fmtCurrency(discount, currencySymbol)}</span></div>}
          <div className="flex justify-between border-t border-[var(--color-border-subtle)] pt-1.5 font-bold text-[var(--color-text)]">
            <span>Grand Total</span><span>{fmtCurrency(total, currencySymbol)}</span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[var(--color-text-disabled)]">
        Created {activeOrder.createdAt ? fmtDate(activeOrder.createdAt) : '—'}
      </p>
    </div>
  );
}

export default function ProjectOrderWorkspace({ project }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const perms = usePermissions();
  const { company } = useAppStore();
  const keys = queryKeys.forCompany(useAppStore((s) => s.activeCompanyId));

  const { data: orders = [], isLoading } = useOrders();
  const { data: quotations = [] } = useQuotations();

  const projectOrders = useMemo(
    () => (orders as any[])
      .filter((o) => o.projectId === project.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()),
    [orders, project.id],
  );
  // Only non-converted quotations can be placed — isQuotationLocked() is the
  // real lock state the conversion service itself writes (status 'Converted
  // to Order' / convertedOrderId), so a second Order can never be placed
  // from the same quotation.
  const convertibleQuotations = useMemo(
    () => (quotations as any[])
      .filter((q) => q.projectId === project.id && !isQuotationLocked(q))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()),
    [quotations, project.id],
  );
  const [selectedQuotationId, setSelectedQuotationId] = useState<string>('');
  const [showCreateFlow, setShowCreateFlow] = useState(false);

  const selectedQuotation = convertibleQuotations.find((q) => q.id === selectedQuotationId) || convertibleQuotations[0] || null;

  // The exact existing conversion mutation (useConvertQuotationToOrder →
  // convertQuotationToOrder): creates the real Order from the quotation,
  // links + advances the project, locks the quotation, toasts + invalidates
  // on success. No parallel Order-creation logic anywhere in this workspace.
  const convertToOrder = useConvertQuotationToOrder();

  function placeOrder(quote: any) {
    if (!perms.canCreate('orders')) {
      toast.error('You do not have permission to create orders');
      return;
    }
    convertToOrder.mutate(quote, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: keys.projectsRoot });
        setShowCreateFlow(false);
        setSelectedQuotationId('');
      },
    });
  }

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  // Pagination-gap guard (same as the Quotation workspace): if the project
  // HAS linked orders but none of them are in the currently loaded page of
  // useOrders() (incremental loader), never offer a creation surface that
  // could place a duplicate order.
  const hasLinkedOrders = (project.linkedOrderIds || []).length > 0;
  if (projectOrders.length === 0 && hasLinkedOrders) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        This project has linked orders, but they have not finished loading in this view.
        Open the Orders list to view them.
      </p>
    );
  }

  // ── Order(s) exist → the real Order state/result ──
  if (projectOrders.length > 0) {
    return (
      <div className="space-y-3">
        <OrderStateView orders={projectOrders} currencySymbol={company.currencySymbol} />
        {convertibleQuotations.length > 0 && (
          <button
            type="button"
            onClick={() => setShowCreateFlow((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary-text)] hover:underline"
          >
            {showCreateFlow ? 'Hide' : 'Place another order'} <span className="text-[var(--color-text-muted)] font-normal">({convertibleQuotations.length} quotation{convertibleQuotations.length > 1 ? 's' : ''} available)</span>
          </button>
        )}
        {showCreateFlow && convertibleQuotations.length > 0 && (
          <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
            <QuotationSelectFlow
              quotations={convertibleQuotations}
              selectedQuotation={selectedQuotation}
              selectedQuotationId={selectedQuotationId}
              onSelect={setSelectedQuotationId}
              onPlace={() => selectedQuotation && placeOrder(selectedQuotation)}
              placing={convertToOrder.isPending}
              canPlace={perms.canCreate('orders')}
              currencySymbol={company.currencySymbol}
            />
          </div>
        )}
      </div>
    );
  }

  // ── No Order yet ──
  if (convertibleQuotations.length === 0) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
          <CheckCircle2 className="h-4 w-4 text-[var(--color-text-muted)]" />
          No order has been placed for this project yet.
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          An Order is created from a quotation — the quotation is the source of the Order's
          items, quantities and pricing (no manual item entry). Create a quotation at
          Stage 3 — Quotation, then come back here to place the Order.
        </p>
        <Button size="xs" variant="outline" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}>
          Open Quotation stage
        </Button>
      </div>
    );
  }

  // ── The simple creation flow: Select Quotation → Preview → Place Order ──
  return (
    <div className="space-y-3">
      <QuotationSelectFlow
        quotations={convertibleQuotations}
        selectedQuotation={selectedQuotation}
        selectedQuotationId={selectedQuotationId}
        onSelect={setSelectedQuotationId}
        onPlace={() => selectedQuotation && placeOrder(selectedQuotation)}
        placing={convertToOrder.isPending}
        canPlace={perms.canCreate('orders')}
        currencySymbol={company.currencySymbol}
      />
    </div>
  );
}

/** Step 1 (Select Quotation) + Step 2 (read-only preview) + Step 3 (Place
 * Order) — the Order stage's complete creation flow. No manual item editing
 * anywhere: the preview is the quotation's real data. */
function QuotationSelectFlow({
  quotations,
  selectedQuotation,
  selectedQuotationId,
  onSelect,
  onPlace,
  placing,
  canPlace,
  currencySymbol,
}: {
  quotations: any[];
  selectedQuotation: any;
  selectedQuotationId: string;
  onSelect: (id: string) => void;
  onPlace: () => void;
  placing: boolean;
  canPlace: boolean;
  currencySymbol: string;
}) {
  return (
    <div className="space-y-3">
      <FormSection title="Step 1 — Select Quotation">
        <Select
          label="Quotation"
          value={selectedQuotation ? selectedQuotation.id : selectedQuotationId}
          onChange={(e) => onSelect(e.target.value)}
          options={quotations.map((q) => ({
            label: `${q.quotationNumber || q.quoteNumber || q.refNo || q.id} · ${q.customer || '—'} · ${fmtCurrency(Number(q.total) || 0, currencySymbol)} · ${q.status || 'Draft'}`,
            value: q.id,
          }))}
        />
        <p className="text-xs text-[var(--color-text-muted)]">
          The Order inherits the selected quotation's items, quantities and pricing.
          To change anything, edit the quotation at Stage 3 first — this preview then
          reflects the quotation's real state.
        </p>
      </FormSection>

      {selectedQuotation ? (
        <>
          <FormSection title="Step 2 — Preview Quotation (read-only)">
            <QuotationPreview quote={selectedQuotation} currencySymbol={currencySymbol} />
          </FormSection>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              icon={<ShoppingCart className="h-4 w-4" />}
              loading={placing}
              disabled={!canPlace}
              title={canPlace ? undefined : 'You do not have permission to create orders'}
              onClick={onPlace}
            >
              Place Order
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">No convertible quotation available.</p>
      )}
    </div>
  );
}
