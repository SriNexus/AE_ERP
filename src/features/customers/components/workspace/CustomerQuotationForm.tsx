/**
 * CustomerQuotationForm — embedded Quotation creation for the Customer
 * Workspace Center Panel (Phase 2). Customer is locked (no re-selection);
 * everything else reuses the exact field set, calculation, and creation
 * logic already proven on the standalone Quotations page:
 *   - QuotationItemsEditor (shared component, extracted this phase)
 *   - createQuotation() (lib/quotationWorkflow.ts, extracted in Phase 0)
 * No duplicate business logic — see the Phase 2 report §6.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { Input, Textarea, FormRow, FormSection } from '../../../../components/ui/Input';
import { getAll } from '../../../../lib/firestore';
import { COLLECTIONS } from '../../../../lib/firebase';
import { useAppStore, useCurrentUser } from '../../../../store/useAppStore';
import { createQuotation } from '../../../../lib/quotationWorkflow';
import { QuotationItemsEditor } from '../../../quotations/components/QuotationItemsEditor';

const FORM0 = {
  date: new Date().toISOString().split('T')[0],
  validUntil: '',
  deliveryTimeline: '',
  installationCharges: '',
  transportCharges: '',
  specialDiscount: '',
  notes: '',
  terms: '',
};

interface Props {
  customer: any;
  /** The customer's existing Project, if one already exists — Phase 8:
   * B2C's canonical flow (Blueprint §6) says every Quotation should trace
   * to a Project. Passed through untouched when present; omitted (no
   * project yet) is a legitimate, deliberately-supported state, not an
   * error — this form never blocks creation on its absence. */
  projectId?: string;
  onCancel: () => void;
  onCreated: () => void;
}

export default function CustomerQuotationForm({ customer, projectId, onCancel, onCreated }: Props) {
  const { company } = useAppStore();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...FORM0 });
  const [items, setItems] = useState<any[]>([]);

  const { data: products = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => getAll<any>(COLLECTIONS.PRODUCTS),
    staleTime: 60000,
  });

  const subtotal = useMemo(() => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0), [items]);
  const taxTotal = useMemo(() => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0) * (Number(i.tax) || 0) / 100, 0), [items]);
  const extraCharges = (Number(form.installationCharges) || 0) + (Number(form.transportCharges) || 0);
  const totalDiscount = Number(form.specialDiscount) || 0;
  const grandTotal = subtotal + taxTotal + extraCharges - totalDiscount;

  function addItem() { setItems((prev) => [...prev, { productId: '', product: '', description: '', hsn: '', specs: '', warranty: '', qty: 1, price: 0, tax: 0, unit: 'Nos', discount: 0 }]); }
  function removeItem(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }
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

  const save = useMutation({
    mutationFn: () => createQuotation({
      form: {
        ...form,
        customer: customer.name || customer.company || customer.companyName || '',
        customerId: customer.id,
        customerPhone: customer.phone || customer.businessPhone || '',
        customerEmail: customer.email || customer.businessEmail || '',
        customerAddress: customer.address || '',
        customerGst: customer.gst || '',
        customerState: customer.state || '',
        status: 'Draft',
        projectId: projectId || '',
      },
      items, subtotal, taxTotal, totalDiscount, grandTotal,
      companyId: company.id, quotationPrefix: company.quotationPrefix, createdBy: user.id,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-kpi-quotations', customer.id] });
      qc.invalidateQueries({ queryKey: ['quotations'] });
      toast.success('Quotation created');
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    if (!items.length) return toast.error('Add at least one item');
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--color-text)]">New Quotation for {customer.name || customer.company || 'this customer'}</h3>
        <button type="button" onClick={onCancel} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <FormSection title="Quotation Details">
        <FormRow>
          <Input label="Quotation Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="Valid Until" type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
        </FormRow>
        <Input label="Delivery Timeline" placeholder="e.g. 7-10 working days after advance" value={form.deliveryTimeline} onChange={(e) => setForm({ ...form, deliveryTimeline: e.target.value })} />
      </FormSection>

      <FormSection title="Products / Items">
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

      <FormSection title="Notes & Terms">
        <Textarea label="Notes / Remarks" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes for the customer..." />
        <Textarea label="Payment Terms & Conditions" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="65% advance on order... 30% before dispatch..." />
      </FormSection>

      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Create Quotation</Button>
      </div>
    </form>
  );
}
