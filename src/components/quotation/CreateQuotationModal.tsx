import { useEffect, useMemo, useState } from 'react';
import { Camera, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore, useCurrentUser } from '../../store/useAppStore';
import { useCreateQuotation, useSalesProducts } from '../../features/sales/hooks/useSales';
import { Button, FormRow, FormSection, Input, Modal, Select, Textarea } from '../ui';
import { ProductPicker } from '../products/ProductPicker';

type LineItem = {
  productId: string;
  product: string;
  category: string;
  photo: string;
  specs: string;
  qty: number;
  price: number;
  tax: number;
  total: number;
};

function createEmptyLineItem(): LineItem {
  return {
    productId: '',
    product: '',
    category: '',
    photo: '',
    specs: '',
    qty: 1,
    price: 0,
    tax: 0,
    total: 0,
  };
}

function customerName(customer: any) {
  return customer?.name || customer?.fullName || customer?.contactPerson || 'Customer';
}

function customerPhone(customer: any) {
  return customer?.phone || customer?.mobile || customer?.businessPhone || '';
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function itemTotal(item: LineItem) {
  const base = (Number(item.qty) || 0) * (Number(item.price) || 0);
  return Math.round((base + (base * (Number(item.tax) || 0) / 100)) * 100) / 100;
}

function formatSpecs(specs: Record<string, unknown>) {
  return Object.entries(specs || {}).map(([key, value]) => `${key}: ${String(value)}`).join(', ');
}

export function CreateQuotationModal({
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
  const validityDays = Number((company as any)?.quotationValidityDays || (company as any)?.validityDays || 7);
  const createQuotation = useCreateQuotation();
  const { data: products = [] } = useSalesProducts();
  const [projectType, setProjectType] = useState(customer?.projectType || '');
  const [validUntil, setValidUntil] = useState(addDays(validityDays));
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [items, setItems] = useState<LineItem[]>([createEmptyLineItem()]);

  useEffect(() => {
    if (!open) return;
    setProjectType(customer?.projectType || '');
    setValidUntil(addDays(validityDays));
    setNotes('');
    setTerms('');
    setItems([createEmptyLineItem()]);
  }, [customer?.id, customer?.projectType, open, validityDays]);

  const categories = useMemo(() => Array.from(new Set((products as any[]).map((p) => p.category).filter(Boolean))), [products]);
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.price) || 0)), 0), [items]);
  const taxTotal = useMemo(() => items.reduce((sum, item) => sum + (itemTotal(item) - ((Number(item.qty) || 0) * (Number(item.price) || 0))), 0), [items]);
  const total = useMemo(() => items.reduce((sum, item) => sum + itemTotal(item), 0), [items]);

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, ...patch };
      if (patch.productId) {
        const product = (products as any[]).find((p) => p.id === patch.productId);
        if (product) {
          next.product = product.name || product.product || '';
          next.category = product.category || '';
          next.photo = product.photo || product.image || product.imageUrl || '';
          next.specs = product.specs || product.specification || product.description || '';
          next.price = Number(product.price || product.sellingPrice || 0);
          next.tax = Number(product.tax || product.gst || 0);
        }
      }
      next.total = itemTotal(next);
      return next;
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!customer) return;
    const validItems = items.filter((item) => item.product || item.productId);
    if (!validItems.length) return toast.error('Add at least one product');
    createQuotation.mutate({
        customerId: customer.id,
        customer: customerName(customer),
        customerPhone: customerPhone(customer),
        customerEmail: customer.email || customer.businessEmail || '',
        customerAddress: customer.address || '',
        customerGst: customer.gst || '',
        projectType,
        date: new Date().toISOString().split('T')[0],
        validUntil,
        status: 'Draft',
        notes,
        terms,
        items: validItems,
        subtotal,
        taxTotal,
        discount: 0,
        total,
        sourceCustomerId: customer.id,
        companyId,
        createdBy: user.id,
      }, { onSuccess: onClose });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Create Quotation: ${customer ? customerName(customer) : ''}`} size="2xl">
      <form onSubmit={submit} className="space-y-5">
        <FormSection title="Customer">
          <FormRow>
            <Input label="Customer" value={customer ? customerName(customer) : ''} disabled />
            <Input label="Project Type" value={projectType} onChange={(e) => setProjectType(e.target.value)} />
          </FormRow>
          <FormRow>
            <Input label="Valid Until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            <Input label="Validity Days" value={String(validityDays)} disabled />
          </FormRow>
        </FormSection>

        <FormSection title="Products">
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="rounded-lg border border-[var(--color-border)] p-3">
                <FormRow cols={3}>
                  <Select
                    label="Category"
                    value={item.category}
                    options={[{ label: 'All Categories', value: '' }, ...categories.map((category) => ({ label: String(category), value: String(category) }))]}
                    onChange={(e) => updateItem(index, { category: e.target.value })}
                  />
                  <div className="sm:col-span-1">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Product</p>
                    <ProductPicker
                      value={item.productId}
                      category={item.category}
                      onSelect={(selected) => updateItem(index, {
                        productId: selected.productId,
                        product: selected.product,
                        category: selected.category,
                        photo: selected.photos[0] || '',
                        specs: formatSpecs(selected.specs),
                        price: selected.price,
                        tax: selected.tax,
                      })}
                    />
                  </div>
                  <Input label="Specs" value={item.specs} onChange={(e) => updateItem(index, { specs: e.target.value })} />
                </FormRow>
                <FormRow cols={4}>
                  <Input label="Qty" type="number" min="1" value={String(item.qty)} onChange={(e) => updateItem(index, { qty: Number(e.target.value) })} />
                  <Input label="Price" type="number" min="0" value={String(item.price)} onChange={(e) => updateItem(index, { price: Number(e.target.value) })} />
                  <Input label="Tax %" type="number" min="0" value={String(item.tax)} onChange={(e) => updateItem(index, { tax: Number(e.target.value) })} />
                  <Input label="Total" value={String(itemTotal(item))} disabled />
                </FormRow>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    {item.photo ? (
                      <img src={item.photo} alt={item.product || 'Product'} className="h-10 w-10 rounded-md border border-[var(--color-border)] object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)]">
                        <Camera className="h-4 w-4" />
                      </span>
                    )}
                    <span>{item.photo ? 'Product photo' : 'No product photo'}</span>
                  </div>
                  <Button type="button" size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== index) : [createEmptyLineItem()])}>Remove</Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setItems((prev) => [...prev, createEmptyLineItem()])}>Add Product</Button>
          </div>
        </FormSection>

        <FormSection title="Totals">
          <FormRow cols={3}>
            <Input label="Subtotal" value={String(Math.round(subtotal * 100) / 100)} disabled />
            <Input label="Tax" value={String(Math.round(taxTotal * 100) / 100)} disabled />
            <Input label="Total" value={String(Math.round(total * 100) / 100)} disabled />
          </FormRow>
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Textarea label="Terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
        </FormSection>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={createQuotation.isPending}>Create Quotation</Button>
        </div>
      </form>
    </Modal>
  );
}
