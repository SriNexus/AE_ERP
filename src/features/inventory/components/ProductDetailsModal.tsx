import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { assertTenantSafeUploadPath } from '../../../lib/demoUploadPolicy';
import { Archive, Camera, Copy, Edit2, ImagePlus, PackagePlus, Trash2, Upload, Warehouse, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { COLLECTIONS } from '../../../lib/firebase';
import { fmtCurrency, getAll, updateDocById } from '../../../lib/firestore';
import { getMovementsByProduct } from '../../../lib/inventoryMovements';
import { queryKeys } from '../../../lib/queryKeys';
import { stockIn } from '../../../lib/stockWorkflow';
import { useAppStore } from '../../../store/useAppStore';
import type { Product } from '../../../types';
import { Button } from '../../../components/ui/Button';
import { Badge, statusBadge } from '../../../components/ui/Badge';
import { Input, Select, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatProductDate(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString('en-GB') : '—';
}

function formatProductTime(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
}

function daysAgoText(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'Not available';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function recencyDotClass(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const created = new Date(date); created.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

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
export function ProductDetailsModal({
  open,
  product,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  currencySymbol,
}: {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onEdit: (product: Product) => void;
  onDuplicate?: (product: Product) => void;
  onDelete?: (product: Product) => void;
  currencySymbol: string;
}) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'inventory' | 'pricing' | 'media' | 'notes' | 'documents' | 'history'>('overview');
  const [showStockIn, setShowStockIn] = useState(false);
  const [stockForm, setStockForm] = useState({
    warehouseId: '',
    qty: '',
    unit: product?.unit || 'PCS',
    sourceType: 'adjustment' as 'purchase' | 'return' | 'adjustment',
    sourceId: '',
    notes: '',
  });
  const [mediaPhotos, setMediaPhotos] = useState<string[]>([]);
  const [pendingUpload, setPendingUpload] = useState<{
    file: File;
    previewUrl: string;
    mode: 'add' | 'replace';
    index: number | null;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<{ mode: 'add' | 'replace'; index: number | null }>({ mode: 'add', index: null });
  const mediaPhotosRef = useRef<string[]>([]);

  const { data: stock = [] } = useQuery({
    queryKey: [...qkeys.stock, product?.id || 'none'],
    enabled: Boolean(open && product?.id),
    queryFn: () => getAll(COLLECTIONS.STOCK),
    staleTime: 30_000,
  });
  const { data: movements = [] } = useQuery({
    queryKey: [...qkeys.stockLedger, product?.id || 'none'],
    enabled: Boolean(open && product?.id),
    queryFn: () => getMovementsByProduct(product!.id),
    staleTime: 30_000,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: qkeys.warehouses,
    enabled: open,
    queryFn: () => getAll(COLLECTIONS.WAREHOUSES),
    staleTime: 300_000,
  });

  const productStock = useMemo(
    () => (stock as any[]).filter((row) => row.productId === product?.id && row.isDeleted !== true),
    [product?.id, stock]
  );
  const warehouseRows = useMemo(() => {
    const map = new Map<string, { id: string; name: string; available: number; reserved: number; unit: string }>();
    productStock.forEach((row: any) => {
      const key = String(row.warehouseId || row.warehouse || 'default');
      const existing = map.get(key) || {
        id: key,
        name: row.warehouse || row.warehouseName || 'Default',
        available: 0,
        reserved: 0,
        unit: row.unit || product?.unit || 'PCS',
      };
      existing.available += Number(row.availableQty ?? row.available) || 0;
      existing.reserved += Number(row.reservedQty ?? row.reserved) || 0;
      existing.unit = row.unit || existing.unit;
      map.set(key, existing);
    });
    return Array.from(map.values());
  }, [product?.unit, productStock]);
  const photos = mediaPhotos.slice(0, 5);
  const specs = specsEntries(product?.specs);
  const productStatus = String(product?.status || 'Active');
  const activeCompanyLabel = (product as any)?.companyName || (product as any)?.company || '—';
  const totalAvailable = productStock.reduce((sum, row) => sum + (Number(row.availableQty ?? row.available) || 0), 0);
  const totalReserved = productStock.reduce((sum, row) => sum + (Number(row.reservedQty ?? row.reserved) || 0), 0);
  const totalOnHand = totalAvailable + totalReserved;
  const basePrice = Number((product as any)?.cost) || 0;
  const sellingPrice = Number(product?.price) || 0;
  const discountAmt = Number((product as any)?.discount) || 0;
  const taxRate = Number(product?.tax) || 0;
  const marginValue = Math.max(0, sellingPrice - basePrice);
  const marginPct = sellingPrice > 0 ? (marginValue / sellingPrice) * 100 : 0;
  const movementSummary = useMemo(() => {
    return (movements as any[]).reduce((summary, movement) => {
      const qty = Number(movement.qty) || 0;
      const type = String(movement.movementType || movement.type || '').toUpperCase();
      if (type === 'OUT') summary.out += qty;
      else if (type === 'ADJUSTMENT') summary.adjust += qty;
      else summary.in += qty;
      summary.count += 1;
      return summary;
    }, { in: 0, out: 0, adjust: 0, count: 0 });
  }, [movements]);

  useEffect(() => {
    const nextPhotos = Array.isArray(product?.photos) ? product.photos.filter(Boolean).slice(0, 5) : [];
    setMediaPhotos(nextPhotos);
    mediaPhotosRef.current = nextPhotos;
    setDetailsTab('overview');
    setPendingUpload(null);
    setUploadProgress(0);
    setUploadError('');
    setUploading(false);
    setStockForm((current) => ({
      ...current,
      unit: product?.unit || 'PCS',
    }));
  }, [product?.id]);

  useEffect(() => {
    mediaPhotosRef.current = mediaPhotos;
  }, [mediaPhotos]);

  useEffect(() => () => {
    if (pendingUpload?.previewUrl) {
      URL.revokeObjectURL(pendingUpload.previewUrl);
    }
  }, [pendingUpload?.previewUrl]);

  const uploadPhoto = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error('Product not selected');
      if (!pendingUpload) throw new Error('No file selected');
      const storage = getStorage();
      const path = `products/${product.companyId || activeCompanyId}/${product.id}/${Date.now()}-${pendingUpload.file.name}`;
      assertTenantSafeUploadPath(path, product.companyId || activeCompanyId);
      const fileRef = ref(storage, path);
      setUploading(true);
      setUploadProgress(0);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(fileRef, pendingUpload.file, { contentType: pendingUpload.file.type });
        task.on('state_changed', (snapshot) => {
          const total = Math.max(1, snapshot.totalBytes || pendingUpload.file.size || 1);
          setUploadProgress(Math.round((snapshot.bytesTransferred / total) * 100));
        }, reject, () => resolve());
      });
      const url = await getDownloadURL(fileRef);
      const currentPhotos = [...mediaPhotosRef.current];
      if (pendingUpload.mode === 'replace' && pendingUpload.index !== null && pendingUpload.index >= 0 && pendingUpload.index < currentPhotos.length) {
        currentPhotos[pendingUpload.index] = url;
      } else {
        if (currentPhotos.length >= 5) throw new Error('You can upload up to 5 images');
        currentPhotos.push(url);
      }
      const nextPhotos = currentPhotos.slice(0, 5);
      await updateDocById(COLLECTIONS.PRODUCTS, product.id, { photos: nextPhotos });
      setMediaPhotos(nextPhotos);
      mediaPhotosRef.current = nextPhotos;
      return nextPhotos;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.productsRoot });
      qc.invalidateQueries({ queryKey: qkeys.productsAll });
      setPendingUpload(null);
      setUploading(false);
      setUploadProgress(0);
      setUploadError('');
      toast.success('Image saved');
    },
    onError: (error: any) => {
      setUploading(false);
      setUploadProgress(0);
      const message = error?.message || 'Photo upload failed';
      setUploadError(String(message));
      toast.error(message);
    },
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      if (!product) return;
      await updateDocById(COLLECTIONS.PRODUCTS, product.id, { status: 'Inactive' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.productsRoot });
      qc.invalidateQueries({ queryKey: qkeys.productsAll });
      toast.success('Product archived');
      onClose();
    },
    onError: (error: any) => toast.error(error.message || 'Archive failed'),
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
      qc.invalidateQueries({ queryKey: qkeys.stock });
      qc.invalidateQueries({ queryKey: qkeys.stockLedger });
      setShowStockIn(false);
      setStockForm({
        warehouseId: '',
        qty: '',
        unit: product?.unit || 'PCS',
        sourceType: 'adjustment',
        sourceId: '',
        notes: '',
      });
      toast.success('Stock added');
    },
    onError: (error: any) => toast.error(stockErrorMessage(error)),
  });

  if (!open || !product) return null;

  const createdBy = (product as any).createdByName || 'System';
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'media', label: 'Media' },
    { key: 'notes', label: 'Notes' },
    { key: 'documents', label: 'Documents' },
    { key: 'history', label: 'History' },
  ] as const;
  const logs = [
    { type: 'Created', desc: 'Product record created', date: product.createdAt, userName: createdBy },
    ...(product.updatedAt ? [{ type: 'Updated', desc: 'Product was updated', date: product.updatedAt, userName: createdBy }] : []),
    ...(productStatus.toLowerCase() === 'inactive' ? [{ type: 'Archived', desc: 'Product was archived', date: product.updatedAt || product.createdAt, userName: createdBy }] : []),
    ...(Array.isArray(movements) ? (movements as any[]).slice(0, 8).map((movement) => ({
      type: String(movement.movementType || movement.type || movement.sourceType || 'Movement'),
      desc: `${movement.warehouseName || movement.warehouse || 'Warehouse'} · ${Number(movement.qty) || 0} ${movement.unit || product.unit || 'PCS'}`,
      date: movement.date || movement.createdAt,
      userName: movement.performedByName || movement.raw?.performedByName || 'System',
    })) : []),
  ];

  function triggerMediaPicker(mode: 'add' | 'replace', index: number | null = null) {
    uploadTargetRef.current = { mode, index };
    if (mode === 'add' && mediaPhotosRef.current.length >= 5) {
      toast.error('You can upload up to 5 images');
      return;
    }
    uploadInputRef.current?.click();
  }

  function onMediaInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Only JPG, JPEG, PNG and WEBP images are allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5 MB or smaller');
      return;
    }

    if (pendingUpload?.previewUrl) {
      URL.revokeObjectURL(pendingUpload.previewUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    setUploadError('');
    setUploadProgress(0);
    setPendingUpload({
      file,
      previewUrl,
      mode: uploadTargetRef.current.mode,
      index: uploadTargetRef.current.index,
    });
  }

  function cancelPendingUpload() {
    if (pendingUpload?.previewUrl) URL.revokeObjectURL(pendingUpload.previewUrl);
    setPendingUpload(null);
    setUploadProgress(0);
    setUploadError('');
  }

  function removePhoto(index: number) {
    const next = mediaPhotosRef.current.filter((_, idx) => idx !== index);
    setMediaPhotos(next);
    mediaPhotosRef.current = next;
    void updateDocById(COLLECTIONS.PRODUCTS, product!.id, { photos: next }).then(() => {
      qc.invalidateQueries({ queryKey: qkeys.productsRoot });
      qc.invalidateQueries({ queryKey: qkeys.productsAll });
      toast.success('Image removed');
    }).catch((error: any) => {
      toast.error(error?.message || 'Image removal failed');
    });
  }

  async function copyQuoteItem() {
    const p = product!;
    const payload = {
      productId: p.id,
      product: p.name,
      category: p.category,
      price: Number(p.price) || 0,
      tax: Number(p.tax) || 0,
      unit: p.unit || 'PCS',
      specs: p.specs || {},
      photos: mediaPhotosRef.current,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success('Quote item copied');
    } catch {
      toast.success('Quote item prepared');
    }
  }

  const primaryPhoto = mediaPhotos[0];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="2xl"
        footer={<div className="desktop-detail-only"><div className="flex w-full items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-text-muted)]">Product management workspace</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => { onClose(); onEdit(product); }}>Edit Product</Button>
              <Button variant="outline" size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => { onClose(); onDuplicate?.(product); }}>Duplicate Product</Button>
              <Button variant="outline" size="sm" icon={<Archive className="h-3.5 w-3.5" />} loading={deactivate.isPending} disabled={productStatus.toLowerCase() === 'inactive'} onClick={() => deactivate.mutate()}>
                {productStatus.toLowerCase() === 'inactive' ? 'Archived' : 'Archive'}
              </Button>
              {onDelete && <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { onClose(); onDelete(product); }}>Delete</Button>}
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            </div>
          </div></div>}
      >
        {/* ── Desktop Detail View ──────────────────────────────────── */}
        <div className="desktop-detail-only flex h-[78vh] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
          <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                {primaryPhoto ? (
                  <img src={primaryPhoto} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <span>{((product as any).name || (product as any).productName || product.sku || 'P')[0].toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{product.name}</h2>
                  {statusBadge(productStatus)}
                  <Badge variant="gray">{product.unit || 'PCS'}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  <span>SKU: {product.sku || '—'}</span>
                  <span>Category: {product.category || '—'}</span>
                  <span>Company: {activeCompanyLabel}</span>
                  <span>Created: {formatProductDate(product.createdAt)}</span>
                  <span>Updated: {formatProductDate(product.updatedAt || product.createdAt)}</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-start gap-2" data-action>
              <Button variant="outline" size="sm" icon={<PackagePlus className="h-3.5 w-3.5" />} onClick={() => setShowStockIn(true)}>Stock Adjustment</Button>
              <Button variant="outline" size="sm" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => triggerMediaPicker('add')}>Add Photo</Button>
              <Button variant="outline" size="sm" icon={<Warehouse className="h-3.5 w-3.5" />} onClick={() => setDetailsTab('inventory')}>Open Warehouse</Button>
              <Button variant="outline" size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={copyQuoteItem}>Generate Quote Item</Button>
              <button onClick={onClose} aria-label="Close product details" className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-7">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setDetailsTab(tab.key as any)}
                className={[
                  'rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
                  detailsTab === tab.key
                    ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {tab.label}
                </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
            {detailsTab === 'overview' && (
              <div className="space-y-5 pt-5">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Product Information</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Info label="Product Code" value={product.sku || '—'} />
                    <Info label="Brand" value={(product as any).brand || '—'} />
                    <Info label="Category" value={product.category || '—'} />
                    <Info label="Company" value={activeCompanyLabel} />
                    <Info label="Warehouse Summary" value={`${warehouseRows.length} warehouse${warehouseRows.length === 1 ? '' : 's'}`} />
                    <Info label="Stock" value={totalAvailable} />
                    <Info label="Reserved" value={totalReserved} />
                    <Info label="Available" value={totalOnHand} />
                    <Info label="Pricing" value={fmtCurrency(sellingPrice, currencySymbol)} />
                    <Info label="Margin" value={`${fmtCurrency(marginValue, currencySymbol)} (${marginPct.toFixed(1)}%)`} />
                    <Info label="Status" value={statusBadge(productStatus)} />
                    <Info label="Description" value={product.description ? 'Available' : '—'} />
                  </div>
                </section>
              </div>
            )}

            {detailsTab === 'inventory' && (
              <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Warehouse Balances</h3>
                  <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
                    <div className="grid grid-cols-4 gap-2 bg-[var(--color-bg-sunken)] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                      <span>Warehouse</span>
                      <span>Available</span>
                      <span>Reserved</span>
                      <span>Unit</span>
                    </div>
                    {warehouseRows.length ? warehouseRows.map((row) => (
                      <div key={row.id} className="grid grid-cols-4 border-t border-[var(--color-border-subtle)] px-3 py-3 text-sm text-[var(--color-text)]">
                        <span className="truncate">{row.name}</span>
                        <span className="font-semibold">{row.available}</span>
                        <span>{row.reserved}</span>
                        <span>{row.unit}</span>
                      </div>
                    )) : (
                      <div className="px-3 py-4 text-sm text-[var(--color-text-muted)]">No warehouse balances recorded.</div>
                    )}
                  </div>
                </section>

                <aside className="space-y-4">
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Movement Summary</h3>
                    <div className="mt-3 space-y-2">
                      <Info label="In" value={movementSummary.in} />
                      <Info label="Out" value={movementSummary.out} />
                      <Info label="Adjustments" value={movementSummary.adjust} />
                      <Info label="Events" value={movementSummary.count} />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Stock Movement</h3>
                    <Button className="mt-3 w-full justify-start" variant="outline" size="sm" icon={<PackagePlus className="h-3.5 w-3.5" />} onClick={() => setShowStockIn(true)}>Stock Adjustment</Button>
                  </section>
                </aside>
              </div>
            )}

            {detailsTab === 'pricing' && (
              <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Pricing</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Info label="Base" value={fmtCurrency(basePrice, currencySymbol)} />
                    <Info label="Selling" value={fmtCurrency(sellingPrice, currencySymbol)} />
                    <Info label="Tax" value={`${taxRate}%`} />
                    <Info label="Discount" value={`${discountAmt}%`} />
                    <Info label="Margin" value={fmtCurrency(marginValue, currencySymbol)} />
                    <Info label="Margin %" value={`${marginPct.toFixed(1)}%`} />
                  </div>
                </section>
                <aside className="space-y-4">
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Pricing Notes</h3>
                    <p className="mt-3 rounded-xl bg-[var(--color-bg-sunken)] p-4 text-sm text-[var(--color-text)]">
                      Company pricing, margin and tax are kept in the same product record so quotation and invoice flows can reuse the same product data.
                    </p>
                  </section>
                </aside>
              </div>
            )}

            {detailsTab === 'media' && (
              <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="space-y-4">
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Primary Image</h3>
                    <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]">
                      {primaryPhoto ? (
                        <img src={primaryPhoto} alt={product.name} className="h-64 w-full object-cover" />
                      ) : (
                        <div className="flex h-64 flex-col items-center justify-center text-[var(--color-text-muted)]">
                          <Camera className="h-8 w-8" />
                          <p className="mt-2 text-sm">No primary image</p>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => triggerMediaPicker('add')} disabled={mediaPhotos.length >= 5}>Upload Image</Button>
                      <Button size="sm" variant="outline" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => triggerMediaPicker('add')} disabled={mediaPhotos.length >= 5}>Replace / Add</Button>
                    </div>
                  </div>

                  {pendingUpload && (
                    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Pending Upload</h3>
                      <div className="mt-3 flex gap-3">
                        <img src={pendingUpload.previewUrl} alt="Pending upload preview" className="h-24 w-24 rounded-xl border border-[var(--color-border)] object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{pendingUpload.file.name}</p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{(pendingUpload.file.size / 1024 / 1024).toFixed(2)} MB</p>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
                            <div className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={cancelPendingUpload} disabled={uploading}>Cancel</Button>
                            <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} loading={uploading} onClick={() => uploadPhoto.mutate()} disabled={uploading}>Save Image</Button>
                          </div>
                          {uploadError && <p className="mt-2 text-xs text-[var(--color-danger)]">{uploadError}</p>}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Gallery</h3>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {photos.length ? photos.map((photo, index) => (
                        <div key={photo} className="group relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)]">
                          <img src={photo} alt={`${product.name} ${index + 1}`} className="aspect-square w-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/65 to-transparent px-2 py-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button size="xs" variant="ghost" className="h-7 rounded-lg bg-white/90 text-slate-900 hover:bg-white" icon={<Upload className="h-3 w-3" />} onClick={() => triggerMediaPicker('replace', index)}>Replace</Button>
                            <Button size="xs" variant="ghost" className="h-7 rounded-lg bg-white/90 text-slate-900 hover:bg-white" icon={<Trash2 className="h-3 w-3" />} onClick={() => removePhoto(index)}>Remove</Button>
                          </div>
                        </div>
                      )) : (
                        <div className="col-span-2 flex h-28 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] sm:col-span-3">
                          <Camera className="h-6 w-6" />
                          <p className="mt-2 text-xs">No images uploaded</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <aside className="space-y-4">
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Media Actions</h3>
                    <div className="mt-3 space-y-2">
                      <Button className="w-full justify-start" variant="outline" size="sm" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => triggerMediaPicker('add')} disabled={mediaPhotos.length >= 5}>Upload / Add Photo</Button>
                      <Button className="w-full justify-start" variant="outline" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={copyQuoteItem}>Generate Quote Item</Button>
                    </div>
                  </section>
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Upload Rules</h3>
                    <div className="mt-3 space-y-2 text-sm text-[var(--color-text-secondary)]">
                      <p>Supported: JPG, JPEG, PNG, WEBP</p>
                      <p>Maximum: 5 images</p>
                      <p>Persistence is immediate after save.</p>
                    </div>
                  </section>
                </aside>
              </div>
            )}

            {detailsTab === 'documents' && (
              <div className="pt-5">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Documents</h3>
                  <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-4 py-12 text-center">
                    <Camera className="mx-auto h-8 w-8 text-[var(--color-text-muted)] opacity-40" />
                    <p className="mt-3 text-sm font-medium text-[var(--color-text-muted)]">No documents attached</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">Product documents and datasheets will appear here.</p>
                  </div>
                </section>
              </div>
            )}

            {detailsTab === 'history' && (
              <div className="pt-5">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">History</h3>
                  <div className="mt-3 space-y-3">
                    {logs.length ? logs.map((log: any, idx: number) => (
                      <div key={`${log.type}-${idx}`} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-[var(--color-text)]">{log.type}</p>
                            <time className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">{formatProductDate(log.date)} {formatProductTime(log.date)}</time>
                          </div>
                          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{log.desc}</p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{log.userName || 'System'}</p>
                        </div>
                      </div>
                    )) : <span className="text-[var(--color-text-muted)]">No history recorded yet.</span>}
                  </div>
                </section>
              </div>
            )}

            {detailsTab === 'notes' && (
              <div className="pt-5">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</h3>
                  {product.description ? (
                    <div className="mt-3 space-y-3">
                      <p className="whitespace-pre-wrap rounded-xl bg-[var(--color-bg-sunken)] p-4 text-[var(--color-text)]">{product.description}</p>
                      <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                        <span>{createdBy}</span>
                        <span>{formatProductDate(product.updatedAt || product.createdAt)}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="mt-3 block text-[var(--color-text-muted)]">No notes have been recorded.</span>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={showStockIn} onClose={() => setShowStockIn(false)} title={`Add Stock: ${product.name}`} size="md">
        <form onSubmit={(event) => { event.preventDefault(); addStock.mutate(); }} className="space-y-4">
          <Select
            label="Warehouse"
            required
            value={stockForm.warehouseId}
            onChange={(e) => setStockForm({ ...stockForm, warehouseId: e.target.value })}
            options={[{ label: 'Select Warehouse', value: '' }, ...(warehouses as any[]).map((w) => ({ label: w.name, value: w.id }))]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Qty" type="number" min="1" required value={stockForm.qty} onChange={(e) => setStockForm({ ...stockForm, qty: e.target.value })} />
            <Input label="Unit" value={stockForm.unit} onChange={(e) => setStockForm({ ...stockForm, unit: e.target.value })} />
          </div>
          <Select
            label="Source Type"
            value={stockForm.sourceType}
            onChange={(e) => setStockForm({ ...stockForm, sourceType: e.target.value as 'purchase' | 'return' | 'adjustment' })}
            options={[{ label: 'Purchase', value: 'purchase' }, { label: 'Return', value: 'return' }, { label: 'Adjustment', value: 'adjustment' }]}
          />
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
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{value}</div>
    </div>
  );
}

