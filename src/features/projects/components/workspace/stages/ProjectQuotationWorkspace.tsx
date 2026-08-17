/**
 * ProjectQuotationWorkspace — the Quotation stage's full operational
 * workspace, embedded inside "Work on This Project" (Stage 3 — Quotation
 * mission, after the standalone Quotation popup was retired). Built the same
 * way ProjectSurveyWorkspace.tsx / ProjectEngineeringWorkspace.tsx were:
 * surfaces the EXISTING Quotation system verbatim, no parallel
 * implementation.
 *
 * Reuse discipline:
 *   - useQuotations() (features/sales/hooks/useSales.ts) is the exact hook
 *     the Quotations list page already uses — same data source, query-keyed
 *     and deduped, never a second quotation query.
 *   - createQuotation() / updateQuotation() / isQuotationLocked() /
 *     synchronizeQuotationProjectLink() / quotationItemsFromEngineering()
 *     (lib/quotationWorkflow.ts) are the exact services the standalone page
 *     and Customer Workspace already use. updateQuotation() carries the
 *     post-Order lock guard, so the underlying update path itself refuses to
 *     mutate a converted quotation — not just the UI.
 *   - useConvertQuotationToOrder() (features/quotations/hooks/useQuotations.ts)
 *     is the exact conversion mutation the standalone popup used — same
 *     convertQuotationToOrder business logic, same Order document shape.
 *   - <QuotationItemsEditor> is the shared line-item editor the standalone
 *     page and Customer Workspace already render — reused unmodified.
 *
 * Scope (per the migration spec): the workspace is operational only —
 * Quotation information + item selection + quantities + pricing +
 * generate/edit + order conversion/locking. The old popup's Notes /
 * Documents / email supporting sections are deliberately NOT carried in
 * here; the quotation record still gets document-default terms/notes from
 * createQuotation(), and the /quotations/:id detail page keeps its
 * Documents/Notes/Download-PDF/email surfaces.
 *
 * States:
 *   - No quotation for this project yet → the create form inline (project
 *     pre-locked, customer prefilled from the linked Customer record — the
 *     same inline-form pattern Survey's schedule form established).
 *   - Quotation(s) exist → the latest is shown with its real data; Edit
 *     (while editable) swaps to the same form in edit mode; Convert to Order
 *     is offered while the quotation is not locked; once converted
 *     (status 'Converted to Order' / convertedOrderId set — see
 *     isQuotationLocked), the workspace renders a clear locked banner with a
 *     link to the generated Order and no editing surface.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowUpRight, CornerUpRight, FileText, Lock, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../../../components/ui/Button';
import { Input, Select, FormRow, FormSection } from '../../../../../components/ui/Input';
import { statusBadge } from '../../../../../components/ui/Badge';
import { getAll, fmtCurrency } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import { useQuotations, QT_STATUSES } from '../../../../sales/hooks/useSales';
import { useConvertQuotationToOrder } from '../../../../quotations/hooks/useQuotations';
import { QuotationItemsEditor } from '../../../../quotations/components/QuotationItemsEditor';
import {
  createQuotation, isQuotationLocked, quotationItemsFromEngineering,
  synchronizeQuotationProjectLink, updateQuotation,
} from '../../../../../lib/quotationWorkflow';
import { useEngineeringDesigns } from '../../../../engineering/hooks/useEngineeringDesigns';
import { quotationDisplayNumber } from '../../../../quotations/utils/quotationEmail';
import type { ProjectStageWorkspaceProps } from './types';

const FORM0 = {
  date: new Date().toISOString().split('T')[0],
  validUntil: '',
  deliveryTimeline: '',
  installationCharges: '',
  transportCharges: '',
  specialDiscount: '',
  engineeringDesignId: '',
  status: 'Draft',
};

const EMPTY_ITEM = { productId: '', product: '', description: '', hsn: '', specs: '', warranty: '', qty: 1, price: 0, tax: 0, unit: 'Nos', discount: 0 };

/** Customer identity fields prefilled from the linked Customer record —
 * exactly the same mapping the standalone page's customerPatch() uses. */
function customerPatch(customer: any) {
  return customer ? {
    customerId: customer.id,
    customer: customer.name || customer.fullName || customer.contactPerson || customer.company || customer.companyName || '',
    customerPhone: customer.phone || customer.mobile || customer.businessPhone || '',
    customerEmail: customer.email || customer.businessEmail || '',
    customerAddress: customer.address || [customer.city, customer.state].filter(Boolean).join(', '),
    customerGst: customer.gst || '',
    customerState: customer.state || '',
  } : {};
}

export default function ProjectQuotationWorkspace({ project, customer }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const perms = usePermissions();
  const { company } = useAppStore();
  const user = useCurrentUser();
  const keys = queryKeys.forCompany(useAppStore((s) => s.activeCompanyId));

  const { data: quotations = [], isLoading } = useQuotations();
  const { data: designs = [] } = useEngineeringDesigns();
  const { data: orders = [] } = useQuery({
    queryKey: keys.ordersAll,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });
  const { data: products = [] } = useQuery({
    queryKey: keys.productsAll,
    queryFn: () => getAll(COLLECTIONS.PRODUCTS),
    staleTime: 60_000,
  });

  const projectQuotations = useMemo(
    () => (quotations as any[])
      .filter((q) => q.projectId === project.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()),
    [quotations, project.id],
  );
  const latest = projectQuotations[0] || null;

  const approvedDesigns = useMemo(
    () => (designs as any[]).filter((d) => d.projectId === project.id && d.status === 'Approved'),
    [designs, project.id],
  );
  const projectOrders = useMemo(
    () => (orders as any[]).filter((o) => o.projectId === project.id),
    [orders, project.id],
  );

  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...FORM0 });
  const [items, setItems] = useState<any[]>([]);
  const [orderId, setOrderId] = useState('');

  const activeQuotation = projectQuotations.find((q) => q.id === activeId) || latest;

  function startEdit(q: any) {
    setForm({
      date: q.date?.split('T')[0] || '',
      validUntil: q.validUntil?.split('T')[0] || '',
      deliveryTimeline: q.deliveryTimeline || '',
      installationCharges: String(q.installationCharges || ''),
      transportCharges: String(q.transportCharges || ''),
      specialDiscount: String(q.specialDiscount || ''),
      engineeringDesignId: q.engineeringDesignId || '',
      status: q.status || 'Draft',
    });
    setItems(Array.isArray(q.items) ? q.items.map((i: any) => ({ ...i })) : []);
    setOrderId(String(q.orderId || ''));
    setEditing(true);
  }

  function handleOrderSelect(selectedId: string) {
    setOrderId(selectedId);
    if (!selectedId) return;
    const order = projectOrders.find((o) => o.id === selectedId) as any;
    if (!order) { toast.error('Order not found'); return; }
    setItems((order.items || []).map((oi: any) => {
      const pd = products.find((p: any) => p.id === oi.productId) as any;
      return {
        productId: oi.productId || '',
        product: oi.product || pd?.name || '',
        description: pd?.description || oi.description || '',
        hsn: pd?.hsn || oi.hsn || '',
        specs: pd?.specifications || oi.specs || '',
        warranty: pd?.warranty || oi.warranty || '',
        qty: Number(oi.qty) || 1,
        unit: oi.unit || pd?.unit || 'Nos',
        price: Number(oi.price) || Number(pd?.price) || 0,
        tax: Number(oi.tax) || Number(pd?.tax) || 0,
        discount: Number(oi.discount) || 0,
      };
    }));
    toast.success(`Order ${order.id} auto-populated`);
  }

  const subtotal = useMemo(() => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0), [items]);
  const taxTotal = useMemo(() => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0) * (Number(i.tax) || 0) / 100, 0), [items]);
  const extraCharges = (Number(form.installationCharges) || 0) + (Number(form.transportCharges) || 0);
  const totalDiscount = Number(form.specialDiscount) || 0;
  const grandTotal = subtotal + taxTotal + extraCharges - totalDiscount;

  function updateItem(idx: number, key: string, val: any) {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [key]: val };
      if (key === 'productId') {
        const pr = products.find((p: any) => p.id === val) as any;
        if (pr) {
          updated.product = pr.name; updated.description = pr.description || '';
          updated.hsn = pr.hsn || ''; updated.specs = pr.specifications || '';
          updated.warranty = pr.warranty || ''; updated.price = pr.price || 0;
          updated.tax = pr.tax || 0; updated.unit = pr.unit || 'Nos';
        }
      }
      return updated;
    }));
  }
  function addItem() { setItems((prev) => [...prev, { ...EMPTY_ITEM }]); }
  function removeItem(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }

  const save = useMutation({
    mutationFn: async () => {
      const customerFields = customerPatch(customer);
      if (editing && activeQuotation) {
        // Edit branch — the exact payload shape the standalone page's edit
        // branch wrote, now routed through the lock-guarded updateQuotation()
        // so a converted quotation can never be mutated at the service layer.
        const { engineeringDesignId, ...quotationFields } = { ...form, ...customerFields };
        const payload = {
          ...quotationFields, items, subtotal, taxTotal,
          installationCharges: Number(form.installationCharges) || 0,
          transportCharges: Number(form.transportCharges) || 0,
          specialDiscount: Number(form.specialDiscount) || 0,
          discount: totalDiscount,
          total: grandTotal,
          createdBy: user.id,
        };
        await updateQuotation(activeQuotation.id, payload);
        await synchronizeQuotationProjectLink(activeQuotation.id, project.id, form.engineeringDesignId || '');
        return activeQuotation.id;
      }
      return createQuotation({
        form: { ...form, ...customerFields, status: form.status || 'Draft', projectId: project.id },
        items, subtotal, taxTotal, totalDiscount, grandTotal,
        companyId: company.id, quotationPrefix: company.quotationPrefix, createdBy: user.id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.quotationsRoot });
      qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success(editing ? 'Quotation updated' : 'Quotation created');
      setEditing(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const convertToOrder = useConvertQuotationToOrder();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    if (!customer) return toast.error('Linked customer could not be loaded');
    if (!items.length) return toast.error('Add at least one item');
    save.mutate();
  }

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  // ── No quotation loaded yet ──
  // The project's own authoritative link list guards the create form against
  // a pagination gap: if the project HAS linked quotations but none of them
  // are in the currently loaded page of useQuotations() (incremental loader),
  // the create form is NOT offered — inventing a second quotation would
  // create a duplicate record (Phase 12 of the migration spec).
  const hasLinkedQuotations = (project.linkedQuotationIds || []).length > 0;
  if (!activeQuotation && hasLinkedQuotations) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        This project has linked quotations, but they have not finished loading in this view.
        Open a quotation from the Quotations list to work on it.
      </p>
    );
  }

  // ── No quotation yet → the create form inline (Survey's own pattern) ──
  if (!activeQuotation) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          No quotation has been created for this project yet.
        </p>

        {approvedDesigns.length > 0 && (
          <FormSection title="Approved Engineering Design (prefill)">
            <Select
              label="Design"
              value={form.engineeringDesignId || ''}
              onChange={(e) => {
                const design = designs.find((d: any) => d.id === e.target.value) as any;
                setForm({ ...form, engineeringDesignId: e.target.value });
                if (design) setItems(quotationItemsFromEngineering(design));
              }}
              options={[{ label: 'No engineering prefill', value: '' }, ...approvedDesigns.map((d: any) => ({ label: `${d.designId} · ${d.systemCapacityKw} kW`, value: d.id }))]}
            />
            <p className="text-xs text-[var(--color-text-muted)]">Approved engineering data creates editable, zero-priced module and inverter lines.</p>
          </FormSection>
        )}

        {projectOrders.length > 0 && (
          <FormSection title="Link to Order (Auto-Fill)">
            <div className="relative">
              <select
                value={orderId}
                onChange={(e) => handleOrderSelect(e.target.value)}
                className="w-full text-sm border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              >
                <option value="">— Select Order to auto-populate (optional) —</option>
                {projectOrders.map((o: any) => (
                  <option key={o.id} value={o.id}>{o.id} — {o.customer} ({fmtCurrency(o.total, company.currencySymbol)})</option>
                ))}
              </select>
            </div>
          </FormSection>
        )}

        <FormSection title="Quotation Details">
          <FormRow>
            <Input label="Quotation Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Input label="Valid Until" type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
          </FormRow>
          <FormRow>
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={QT_STATUSES.map((s) => ({ label: s, value: s }))} />
            <Input label="Delivery Timeline" placeholder="e.g. 7-10 working days after advance" value={form.deliveryTimeline} onChange={(e) => setForm({ ...form, deliveryTimeline: e.target.value })} />
          </FormRow>
        </FormSection>

        <FormSection title="Quotation Items">
          <QuotationItemsEditor
            items={items}
            products={products}
            currencySymbol={company.currencySymbol}
            subtotal={subtotal}
            taxTotal={taxTotal}
            installationCharges={Number(form.installationCharges) || 0}
            transportCharges={Number(form.transportCharges) || 0}
            specialDiscount={Number(form.specialDiscount) || 0}
            grandTotal={grandTotal}
            onAddItem={addItem}
            onRemoveItem={removeItem}
            onUpdateItem={updateItem}
          />
        </FormSection>

        <FormSection title="Additional Charges & Discounts">
          <FormRow>
            <Input label="Installation Charges (₹)" type="number" min="0" value={form.installationCharges} onChange={(e) => setForm({ ...form, installationCharges: e.target.value })} placeholder="0" />
            <Input label="Transport Charges (₹)" type="number" min="0" value={form.transportCharges} onChange={(e) => setForm({ ...form, transportCharges: e.target.value })} placeholder="0" />
          </FormRow>
          <Input label="Special Discount (₹)" type="number" min="0" value={form.specialDiscount} onChange={(e) => setForm({ ...form, specialDiscount: e.target.value })} placeholder="0" />
        </FormSection>

        <div className="flex justify-end gap-2">
          <Button type="submit" loading={save.isPending} icon={<FileText className="h-4 w-4" />} disabled={!perms.canCreate('quotations')} title={perms.canCreate('quotations') ? undefined : 'You do not have permission to create quotations'}>
            Create Quotation
          </Button>
        </div>
      </form>
    );
  }

  const locked = isQuotationLocked(activeQuotation);

  // ── Edit mode — same form as create, prefilled with the real quotation ──
  if (editing && !locked) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Edit Quotation {quotationDisplayNumber(activeQuotation)}</p>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
        </div>

        {approvedDesigns.length > 0 && (
          <FormSection title="Approved Engineering Design (prefill)">
            <Select
              label="Design"
              value={form.engineeringDesignId || ''}
              onChange={(e) => {
                const design = designs.find((d: any) => d.id === e.target.value) as any;
                setForm({ ...form, engineeringDesignId: e.target.value });
                if (design) setItems(quotationItemsFromEngineering(design));
              }}
              options={[{ label: 'No engineering prefill', value: '' }, ...approvedDesigns.map((d: any) => ({ label: `${d.designId} · ${d.systemCapacityKw} kW`, value: d.id }))]}
            />
          </FormSection>
        )}

        <FormSection title="Quotation Details">
          <FormRow>
            <Input label="Quotation Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Input label="Valid Until" type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
          </FormRow>
          <FormRow>
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={QT_STATUSES.map((s) => ({ label: s, value: s }))} />
            <Input label="Delivery Timeline" placeholder="e.g. 7-10 working days after advance" value={form.deliveryTimeline} onChange={(e) => setForm({ ...form, deliveryTimeline: e.target.value })} />
          </FormRow>
        </FormSection>

        <FormSection title="Quotation Items">
          <QuotationItemsEditor
            items={items}
            products={products}
            currencySymbol={company.currencySymbol}
            subtotal={subtotal}
            taxTotal={taxTotal}
            installationCharges={Number(form.installationCharges) || 0}
            transportCharges={Number(form.transportCharges) || 0}
            specialDiscount={Number(form.specialDiscount) || 0}
            grandTotal={grandTotal}
            onAddItem={addItem}
            onRemoveItem={removeItem}
            onUpdateItem={updateItem}
          />
        </FormSection>

        <FormSection title="Additional Charges & Discounts">
          <FormRow>
            <Input label="Installation Charges (₹)" type="number" min="0" value={form.installationCharges} onChange={(e) => setForm({ ...form, installationCharges: e.target.value })} placeholder="0" />
            <Input label="Transport Charges (₹)" type="number" min="0" value={form.transportCharges} onChange={(e) => setForm({ ...form, transportCharges: e.target.value })} placeholder="0" />
          </FormRow>
          <Input label="Special Discount (₹)" type="number" min="0" value={form.specialDiscount} onChange={(e) => setForm({ ...form, specialDiscount: e.target.value })} placeholder="0" />
        </FormSection>

        <div className="flex justify-end gap-2">
          <Button type="submit" loading={save.isPending} icon={<FileText className="h-4 w-4" />} disabled={!perms.canEdit('quotations')} title={perms.canEdit('quotations') ? undefined : 'You do not have permission to edit quotations'}>
            Update Quotation
          </Button>
        </div>
      </form>
    );
  }

  // ── View mode — the latest (or selected) real quotation ──
  const total = Number(activeQuotation.total) || 0;
  const extraDisplay = (Number(activeQuotation.installationCharges) || 0) + (Number(activeQuotation.transportCharges) || 0);
  const discountDisplay = Number(activeQuotation.discount || activeQuotation.specialDiscount || 0);

  return (
    <div className="space-y-3">
      {projectQuotations.length > 1 && (
        <Select
          label="Quotation"
          value={activeQuotation.id}
          onChange={(e) => setActiveId(e.target.value)}
          options={projectQuotations.map((q) => ({ label: `${quotationDisplayNumber(q)} · ${q.status || 'Draft'}`, value: q.id }))}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{quotationDisplayNumber(activeQuotation)}</p>
            {statusBadge(activeQuotation.status || 'Draft')}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {activeQuotation.customer || '—'} · {fmtCurrency(total, company.currencySymbol)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!locked && perms.canEdit('quotations') && (
            <Button size="xs" variant="outline" onClick={() => startEdit(activeQuotation)}>Edit</Button>
          )}
          {!locked && perms.canCreate('orders') && activeQuotation.status !== 'Converted to Order' && (
            <Button
              size="xs"
              icon={<CornerUpRight className="h-3.5 w-3.5" />}
              loading={convertToOrder.isPending}
              onClick={() => convertToOrder.mutate(activeQuotation, {
                onSuccess: (orderId) => {
                  qc.invalidateQueries({ queryKey: keys.projectsRoot });
                  setEditing(false);
                  navigate(`/orders/${encodeURIComponent(String(orderId))}`);
                },
              })}
            >
              Convert to Order
            </Button>
          )}
        </div>
      </div>

      {locked && (
        <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-light)] px-3 py-2.5">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger-text)]" />
          <div className="min-w-0 text-xs text-[var(--color-danger-text)]">
            <p className="font-semibold">This quotation has been converted to an Order and is locked.</p>
            <p className="mt-0.5">
              It can no longer be edited.
              {activeQuotation.convertedOrderId && (
                <a href={`/orders/${encodeURIComponent(String(activeQuotation.convertedOrderId))}`} onClick={(e) => { e.preventDefault(); navigate(`/orders/${encodeURIComponent(String(activeQuotation.convertedOrderId))}`); }} className="ml-1 inline-flex items-center gap-1 font-semibold underline">
                  View Order {String(activeQuotation.convertedOrderId)} <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        {Array.isArray(activeQuotation.items) && activeQuotation.items.length ? (
          <table className="min-w-full text-xs">
            <thead className="bg-[var(--color-bg-sunken)]">
              <tr>
                {['Product', 'Qty', 'Unit Price', 'Tax %', 'Line Total'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {activeQuotation.items.map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="px-3 py-2 text-[var(--color-text)]">{item.product || 'Custom item'}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.qty || 0}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{fmtCurrency(Number(item.price) || 0, company.currencySymbol)}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{Number(item.tax) || 0}</td>
                  <td className="px-3 py-2 font-semibold text-[var(--color-text)]">{fmtCurrency((Number(item.qty) || 0) * (Number(item.price) || 0), company.currencySymbol)}</td>
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
          <div className="flex justify-between text-[var(--color-text-secondary)]"><span>Subtotal</span><span>{fmtCurrency(Number(activeQuotation.subtotal) || 0, company.currencySymbol)}</span></div>
          <div className="flex justify-between text-[var(--color-text-secondary)]"><span>GST / Tax</span><span>{fmtCurrency(Number(activeQuotation.taxTotal || activeQuotation.taxAmount) || 0, company.currencySymbol)}</span></div>
          {extraDisplay > 0 && <div className="flex justify-between text-[var(--color-text-secondary)]"><span>Charges</span><span>{fmtCurrency(extraDisplay, company.currencySymbol)}</span></div>}
          {discountDisplay > 0 && <div className="flex justify-between text-[var(--color-success-text)]"><span>Discount</span><span>- {fmtCurrency(discountDisplay, company.currencySymbol)}</span></div>}
          <div className="flex justify-between border-t border-[var(--color-border-subtle)] pt-1.5 font-bold text-[var(--color-text)]">
            <span>Grand Total</span><span>{fmtCurrency(total, company.currencySymbol)}</span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[var(--color-text-disabled)]">
        Created {new Date(activeQuotation.createdAt || Date.now()).toLocaleDateString()}
      </p>
    </div>
  );
}
