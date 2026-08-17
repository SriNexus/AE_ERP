/**
 * CustomerOrderForm — embedded Order creation for the Customer Workspace
 * Center Panel (Phase 2). Customer is locked (no re-selection); everything
 * else reuses the exact field set, calculation, and creation logic already
 * proven on the standalone Orders page:
 *   - OrderItemsEditor (already a clean, reusable component — no changes)
 *   - createOrder() (lib/orderWorkflow.ts, extracted in Phase 0)
 * No duplicate business logic — see the Phase 2 report §6.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../../components/ui/Input';
import { getAll } from '../../../../lib/firestore';
import { COLLECTIONS } from '../../../../lib/firebase';
import { useAppStore, useCurrentUser } from '../../../../store/useAppStore';
import { createOrder } from '../../../../lib/orderWorkflow';
import { OrderItemsEditor } from '../../../orders/components/OrderItemsEditor';

const FORM0 = {
  date: new Date().toISOString().split('T')[0],
  deliveryDate: '',
  paymentMode: '',
  discount: '0',
  notes: '',
  shippingAddress: '',
  warehouseId: '',
};

interface Props {
  customer: any;
  onCancel: () => void;
  onCreated: () => void;
}

export default function CustomerOrderForm({ customer, onCancel, onCreated }: Props) {
  const { company, activeCompanyId } = useAppStore();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...FORM0, shippingAddress: customer.address || '' });
  const [items, setItems] = useState<any[]>([]);

  const { data: products = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => getAll<any>(COLLECTIONS.PRODUCTS),
    staleTime: 60000,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses-all'],
    queryFn: () => getAll<any>(COLLECTIONS.WAREHOUSES),
    staleTime: 300000,
  });

  const subtotal = useMemo(() => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0), [items]);
  const taxTotal = useMemo(() => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0) * (Number(i.tax) || 0) / 100, 0), [items]);
  const discount = Number(form.discount) || 0;
  const grandTotal = subtotal + taxTotal - discount;

  function addItem() { setItems((prev) => [...prev, { productId: '', product: '', qty: 1, price: 0, tax: 0, unit: 'PCS', total: 0 }]); }
  function removeItem(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }
  function updateItem(idx: number, key: string, val: any) {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [key]: val };
      if (key === 'productId') {
        const pr = products.find((p: any) => p.id === val) as any;
        if (pr) { updated.product = pr.name; updated.price = pr.price || 0; updated.tax = pr.tax || 0; updated.unit = pr.unit || 'PCS'; }
      }
      return updated;
    }));
  }

  const save = useMutation({
    mutationFn: () => createOrder({
      form: {
        ...form,
        customer: customer.name || customer.company || customer.companyName || '',
        customerId: customer.id,
        orderType: (customer.type || 'B2B') as 'B2B' | 'B2C',
        status: 'Pending',
        paymentStatus: 'Pending',
      },
      items, subtotal, taxTotal, discount, grandTotal,
      companyId: company.id, orderPrefix: company.orderPrefix, createdBy: user.id,
      activeCompanyId,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-kpi-orders', customer.id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Order created');
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
        <h3 className="text-sm font-bold text-[var(--color-text)]">New Order for {customer.name || customer.company || 'this customer'}</h3>
        <button type="button" onClick={onCancel} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <FormSection title="Order Details">
        <FormRow>
          <Input label="Order Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="Delivery Date" type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
        </FormRow>
        <FormRow>
          <Input label="Payment Mode" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })} placeholder="e.g. Bank Transfer" />
          <Select label="Warehouse" value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} options={[{ label: 'Select Warehouse', value: '' }, ...warehouses.map((w: any) => ({ label: w.name, value: w.id }))]} />
        </FormRow>
        <Textarea label="Shipping Address" value={form.shippingAddress} onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })} />
      </FormSection>

      <FormSection title="Products / Items">
        <OrderItemsEditor
          items={items}
          products={products}
          currencySymbol={company.currencySymbol}
          subtotal={subtotal}
          taxTotal={taxTotal}
          discount={discount}
          grandTotal={grandTotal}
          onAddItem={addItem}
          onRemoveItem={removeItem}
          onUpdateItem={updateItem}
          onDiscountChange={(v) => setForm({ ...form, discount: v })}
        />
      </FormSection>

      <FormSection title="Notes">
        <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </FormSection>

      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Create Order</Button>
      </div>
    </form>
  );
}
