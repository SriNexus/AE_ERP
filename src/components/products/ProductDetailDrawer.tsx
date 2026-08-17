import { useMemo, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { assertTenantSafeUploadPath } from '../../lib/demoUploadPolicy';
import { Camera, PackagePlus, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../lib/firebase';
import { fmtCurrency, getAll, updateDocById } from '../../lib/firestore';
import { stockIn } from '../../lib/stockWorkflow';
import { queryKeys } from '../../lib/queryKeys';
import { useAppStore } from '../../store/useAppStore';
import type { Product } from '../../types';
import { Button, Input, Select, Textarea } from '../ui';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';

type Props = {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onEdit: (product: Product) => void;
};

function specsEntries(specs?: Record<string, unknown>) {
  return Object.entries(specs || {}).filter(([, value]) => value !== undefined && value !== '');
}

function stockErrorMessage(error: any) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) return 'Permission denied';
  if (lower.includes('active company')) return 'Company missing';
  if (lower.includes('quantity') || lower.includes('product') || lower.includes('warehouse')) return message;
  return 'Stock update failed';
}

export function ProductDetailDrawer({ product, open, onClose, onEdit }: Props) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const [showStockIn, setShowStockIn] = useState(false);
  const [stockForm, setStockForm] = useState({ warehouseId: '', qty: '', unit: 'PCS', sourceType: 'adjustment' as 'purchase' | 'return' | 'adjustment', sourceId: '', notes: '' });

  const { data: stock = [] } = useQuery({
    queryKey: [...keys.stock, product?.id || 'none'],
    enabled: Boolean(product?.id),
    queryFn: () => getAll(COLLECTIONS.STOCK),
    staleTime: 30_000,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: keys.warehouses,
    queryFn: () => getAll(COLLECTIONS.WAREHOUSES),
    staleTime: 300_000,
  });

  const productStock = useMemo(() => (stock as any[]).filter((row) => row.productId === product?.id && row.isDeleted !== true), [product?.id, stock]);
  const photos = (product?.photos || []).slice(0, 5);
  const specs = specsEntries(product?.specs);

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      if (!product) throw new Error('Product not selected');
      const storage = getStorage();
      const companyId=product.companyId||activeCompanyId;
      if(!companyId)throw new Error('Your company identity is unavailable. Please sign in again.');
      const path = `companies/${companyId}/products/${product.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'-')}`;
      assertTenantSafeUploadPath(path, product.companyId || activeCompanyId);
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      await updateDocById(COLLECTIONS.PRODUCTS, product.id, { photos: [...(product.photos || []), url] });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.productsRoot });
      toast.success('Photo uploaded');
    },
    onError: (error: any) => toast.error(error.message || 'Photo upload failed'),
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      if (!product) return;
      await updateDocById(COLLECTIONS.PRODUCTS, product.id, { status: 'Inactive' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.productsRoot });
      toast.success('Product deactivated');
      onClose();
    },
    onError: (error: any) => toast.error(error.message || 'Deactivate failed'),
  });

  const addStock = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error('Product not selected');
      await stockIn({
        productId: product.id,
        warehouseId: stockForm.warehouseId,
        qty: Number(stockForm.qty),
        unit: stockForm.unit || product.unit || 'PCS',
        sourceType: stockForm.sourceType,
        sourceId: stockForm.sourceId,
        notes: stockForm.notes,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.stock });
      qc.invalidateQueries({ queryKey: keys.stockLedger });
      setShowStockIn(false);
      setStockForm({ warehouseId: '', qty: '', unit: product?.unit || 'PCS', sourceType: 'adjustment', sourceId: '', notes: '' });
      toast.success('Stock added');
    },
    onError: (error: any) => toast.error(stockErrorMessage(error)),
  });

  if (!open || !product) return null;

  return (
    <>
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-[var(--color-overlay)]" onClick={onClose} />
        <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Product</p>
              <h2 className="text-lg font-bold text-[var(--color-text)]">{product.name}</h2>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-5 p-5">
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Info label="Category" value={product.category} />
                <Info label="SKU" value={product.sku || '-'} />
                <Info label="Unit" value={product.unit || 'PCS'} />
                <Info label="Price" value={fmtCurrency(product.price || 0)} />
                <Info label="Tax" value={`${product.tax || 0}%`} />
                <Info label="Status" value={<Badge variant={product.status === 'Inactive' ? 'danger' : 'success'}>{product.status || 'Active'}</Badge>} />
              </div>
              {product.description && <p className="mt-4 text-sm text-[var(--color-text-secondary)]">{product.description}</p>}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Photos</h3>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]">
                  <Upload className="h-3.5 w-3.5" />
                  Upload
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => event.target.files?.[0] && uploadPhoto.mutate(event.target.files[0])} />
                </label>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {photos.length ? photos.map((photo) => (
                  <img key={photo} src={photo} alt={product.name} className="aspect-square rounded-lg border border-[var(--color-border)] object-cover" />
                )) : (
                  <div className="col-span-5 flex h-24 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]">
                    <Camera className="h-5 w-5" />
                  </div>
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Specs</h3>
              {specs.length ? (
                <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                  {specs.map(([key, value]) => (
                    <div key={key} className="grid grid-cols-2 border-b border-[var(--color-border)] last:border-b-0">
                      <div className="bg-[var(--color-bg-sunken)] px-3 py-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">{key}</div>
                      <div className="px-3 py-2 text-sm text-[var(--color-text)]">{String(value)}</div>
                    </div>
                  ))}
                </div>
              ) : <p className="rounded-lg border border-[var(--color-border)] px-3 py-4 text-sm text-[var(--color-text-muted)]">No specs added.</p>}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Stock</h3>
                <Button size="sm" variant="outline" icon={<PackagePlus className="h-4 w-4" />} onClick={() => { setStockForm((current) => ({ ...current, unit: product.unit || 'PCS' })); setShowStockIn(true); }}>Add Stock</Button>
              </div>
              <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                {productStock.length ? productStock.map((row) => (
                  <div key={row.id} className="grid grid-cols-3 border-b border-[var(--color-border)] px-3 py-2 text-sm last:border-b-0">
                    <span className="text-[var(--color-text)]">{row.warehouse || row.warehouseId || 'Default'}</span>
                    <span className="font-semibold text-[var(--color-text)]">{row.availableQty ?? row.available ?? 0}</span>
                    <span className="text-[var(--color-text-muted)]">{row.unit || product.unit || 'PCS'}</span>
                  </div>
                )) : <p className="px-3 py-4 text-sm text-[var(--color-text-muted)]">No stock records.</p>}
              </div>
            </section>

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
              <Button variant="outline" onClick={() => onEdit(product)}>Edit</Button>
              <Button variant="danger" loading={deactivate.isPending} onClick={() => deactivate.mutate()}>Deactivate</Button>
            </div>
          </div>
        </aside>
      </div>

      <Modal open={showStockIn} onClose={() => setShowStockIn(false)} title={`Add Stock: ${product.name}`} size="md">
        <form onSubmit={(event) => { event.preventDefault(); addStock.mutate(); }} className="space-y-4">
          <Select label="Warehouse" required value={stockForm.warehouseId} onChange={(e) => setStockForm({ ...stockForm, warehouseId: e.target.value })} options={[{ label: 'Select Warehouse', value: '' }, ...(warehouses as any[]).map((w) => ({ label: w.name, value: w.id }))]} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Qty" type="number" min="1" required value={stockForm.qty} onChange={(e) => setStockForm({ ...stockForm, qty: e.target.value })} />
            <Input label="Unit" value={stockForm.unit} onChange={(e) => setStockForm({ ...stockForm, unit: e.target.value })} />
          </div>
          <Select label="Source Type" value={stockForm.sourceType} onChange={(e) => setStockForm({ ...stockForm, sourceType: e.target.value as 'purchase' | 'return' | 'adjustment' })} options={[{ label: 'Purchase', value: 'purchase' }, { label: 'Return', value: 'return' }, { label: 'Adjustment', value: 'adjustment' }]} />
          <Input label="Reference No" value={stockForm.sourceId} onChange={(e) => setStockForm({ ...stockForm, sourceId: e.target.value })} />
          <Textarea label="Notes" value={stockForm.notes} onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowStockIn(false)}>Cancel</Button>
            <Button type="submit" loading={addStock.isPending}>Add Stock</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)]">{value}</div>
    </div>
  );
}
