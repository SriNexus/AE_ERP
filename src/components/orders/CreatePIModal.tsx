import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore, useCurrentUser } from '../../store/useAppStore';
import { useCreatePI, useSalesProducts } from '../../features/sales/hooks/useSales';
import { Button, FormRow, FormSection, Input, Modal, Select, Textarea } from '../ui';

type PIItem = {
  productId: string;
  product: string;
  specs: string;
  qty: number;
  price: number;
  tax: number;
  discount: number;
  total: number;
};

function createEmptyPIItem(): PIItem {
  return {
    productId: '',
    product: '',
    specs: '',
    qty: 1,
    price: 0,
    tax: 0,
    discount: 0,
    total: 0,
  };
}

function customerName(customer: any) {
  return customer?.name || customer?.fullName || customer?.contactPerson || 'Customer';
}

function lineTotal(item: PIItem) {
  const base = (Number(item.qty) || 0) * (Number(item.price) || 0);
  const afterDiscount = Math.max(0, base - (Number(item.discount) || 0));
  return Math.round((afterDiscount + (afterDiscount * (Number(item.tax) || 0) / 100)) * 100) / 100;
}

export function CreatePIModal({
  customer,
  open,
  onClose,
}: {
  customer: any;
  open: boolean;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const company = useAppStore((state) => state.company);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = company?.id || user.companyId;
  const createPI = useCreatePI();
  const { data: products = [] } = useSalesProducts();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PIItem[]>([createEmptyPIItem()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(new Date().toISOString().split('T')[0]);
    setDueDate('');
    setNotes('');
    setItems([createEmptyPIItem()]);
    setSaving(false);
  }, [customer?.id, open]);

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.price) || 0)), 0), [items]);
  const discount = useMemo(() => items.reduce((sum, item) => sum + (Number(item.discount) || 0), 0), [items]);
  const taxAmount = useMemo(() => items.reduce((sum, item) => {
    const base = Math.max(0, ((Number(item.qty) || 0) * (Number(item.price) || 0)) - (Number(item.discount) || 0));
    return sum + (base * (Number(item.tax) || 0) / 100);
  }, 0), [items]);
  const total = useMemo(() => items.reduce((sum, item) => sum + lineTotal(item), 0), [items]);

  function updateItem(index: number, patch: Partial<PIItem>) {
    setItems((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, ...patch };
      if (patch.productId) {
        const product = (products as any[]).find((p) => p.id === patch.productId);
        if (product) {
          next.product = product.name || product.product || '';
          next.specs = product.specs || product.specification || product.description || '';
          next.price = Number(product.price || product.sellingPrice || 0);
          next.tax = Number(product.tax || product.gst || 0);
        }
      }
      next.total = lineTotal(next);
      return next;
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!customer) return;
    const validItems = items.filter((item) => item.product || item.productId);
    if (!validItems.length) return toast.error('Add at least one product');
    if (total <= 0) return toast.error('PI total must be greater than zero');
    setSaving(true);
    createPI.mutate({
        customerId: customer.id,
        customer: customerName(customer),
        date,
        dueDate,
        status: 'Draft',
        paymentStatus: 'Pending',
        items: validItems,
        subtotal,
        taxAmount,
        discount,
        total,
        notes,
        sourceCustomerId: customer.id,
        // useCreatePI's createPI() (useSales.ts) derives the actual
        // templateUsed value from the resolved company's own companyCode —
        // this payload field is not read there and is left off deliberately.
        companyId,
        generatedBy: user.id,
        createdBy: user.id,
        approvalStatus: 'Pending',
      }, { onSuccess: onClose, onSettled: () => setSaving(false) });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Create PI: ${customer ? customerName(customer) : ''}`} size="2xl">
      <form onSubmit={submit} className="space-y-5">
        <FormSection title="Customer">
          <FormRow>
            <Input label="Customer" value={customer ? customerName(customer) : ''} disabled />
            <Input label="Template" value={company?.companyCode || '—'} disabled />
          </FormRow>
          <FormRow>
            <Input label="PI Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input label="Due Date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormRow>
        </FormSection>

        <FormSection title="Line Items">
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="rounded-lg border border-[var(--color-border)] p-3">
                <FormRow cols={3}>
                  <Select
                    label="Product"
                    value={item.productId}
                    options={[{ label: 'Select Product', value: '' }, ...(products as any[]).map((p) => ({ label: p.name || p.product || p.id, value: p.id }))]}
                    onChange={(e) => updateItem(index, { productId: e.target.value })}
                  />
                  <Input label="Specs" value={item.specs} onChange={(e) => updateItem(index, { specs: e.target.value })} />
                  <Input label="Product Name" value={item.product} onChange={(e) => updateItem(index, { product: e.target.value })} />
                </FormRow>
                <FormRow cols={4}>
                  <Input label="Qty" type="number" min="1" value={String(item.qty)} onChange={(e) => updateItem(index, { qty: Number(e.target.value) })} />
                  <Input label="Price" type="number" min="0" value={String(item.price)} onChange={(e) => updateItem(index, { price: Number(e.target.value) })} />
                  <Input label="Tax %" type="number" min="0" value={String(item.tax)} onChange={(e) => updateItem(index, { tax: Number(e.target.value) })} />
                  <Input label="Discount" type="number" min="0" value={String(item.discount)} onChange={(e) => updateItem(index, { discount: Number(e.target.value) })} />
                </FormRow>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="font-semibold text-[var(--color-text)]">Line total: {lineTotal(item)}</span>
                  <Button type="button" size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== index) : [createEmptyPIItem()])}>Remove</Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setItems((prev) => [...prev, createEmptyPIItem()])}>Add Item</Button>
          </div>
        </FormSection>

        <FormSection title="Totals">
          <FormRow cols={4}>
            <Input label="Subtotal" value={String(Math.round(subtotal * 100) / 100)} disabled />
            <Input label="Discount" value={String(Math.round(discount * 100) / 100)} disabled />
            <Input label="Tax" value={String(Math.round(taxAmount * 100) / 100)} disabled />
            <Input label="Total" value={String(Math.round(total * 100) / 100)} disabled />
          </FormRow>
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormSection>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Create PI</Button>
        </div>
      </form>
    </Modal>
  );
}
