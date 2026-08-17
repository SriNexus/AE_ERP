import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Calendar, Copy, Download, Edit2, ImagePlus, Mail, MessageCircle, Package, Phone, Trash2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { UNITS } from '../../../config/company';
import {
  exportProductsCSV,
  PRODUCT_FORM_DEFAULT,
  TRACKING_OPTIONS,
  UNIT_OPTIONS,
  useDeleteProduct,
  useProducts,
  useSaveProduct,
  type ProductForm,
} from '../../../features/inventory/hooks/useInventory';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtCurrency, fmtDate, getAll, toInputDate, updateDocById } from '../../../lib/firestore';
import { compressImageBase64 } from '../../../lib/imageUtils';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import type { Product } from '../../../types';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';

type Mode = 'records' | 'create';
type MobileProduct = Product & Record<string, any>;
type ProductFilters = {
  search: string;
  status: string;
  stock: string;
  date: string;
};
type MobileProductForm = ProductForm & {
  barcode?: string;
  brand?: string;
  photos?: string[];
  notes?: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function productName(product: MobileProduct) {
  return product.name || product.productName || product.title || product.id || 'Untitled Product';
}

function productCode(product: MobileProduct) {
  return product.sku || product.productCode || product.code || product.barcode || 'SKU not set';
}

function cleanPhone(phone?: string) {
  return String(phone || '').replace(/\D/g, '');
}

function whatsappHref(phone?: string) {
  const value = cleanPhone(phone);
  return value ? `https://wa.me/${value}` : undefined;
}

function stockFor(product: MobileProduct, stockRows: any[]) {
  const rows = stockRows.filter((row) => row.productId === product.id && row.isDeleted !== true);
  const available = rows.reduce((sum, row) => sum + (Number(row.availableQty ?? row.available) || 0), Number(product.availableQty ?? product.currentStock ?? product.stock ?? 0) || 0);
  const reserved = rows.reduce((sum, row) => sum + (Number(row.reservedQty ?? row.reserved) || 0), Number(product.reservedQty ?? product.reservedStock ?? 0) || 0);
  const threshold = Number(product.lowStockThreshold ?? 5) || 5;
  const status = available <= 0 ? 'Out Of Stock' : available <= threshold ? 'Low Stock' : 'In Stock';
  return { available, reserved, threshold, status, rows };
}

function isInDateRange(value: any, range: string) {
  if (range === 'all' || range === ALL) return true;
  const date = toDate(value);
  if (!date) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return date >= start;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  return days ? date >= new Date(Date.now() - days * 86400000) : true;
}

function filterProducts(products: MobileProduct[], filters: ProductFilters, stockRows: any[]) {
  const term = filters.search.trim().toLowerCase();
  return products
    .filter((product) => {
      if (filters.status !== ALL && (product.status || 'Active') !== filters.status) return false;
      if (!isInDateRange(product.updatedAt || product.createdAt, filters.date)) return false;
      if (filters.stock !== ALL) {
        const currentStock = stockFor(product, stockRows).status;
        if (currentStock !== filters.stock) return false;
      }
      if (!term) return true;
      return [
        product.id,
        product.name,
        product.productName,
        product.sku,
        product.productCode,
        product.barcode,
        product.category,
        product.brand,
        product.hsn,
        product.description,
      ].some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
}

function formFromProduct(product: MobileProduct): MobileProductForm {
  return {
    ...PRODUCT_FORM_DEFAULT,
    name: product.name || '',
    sku: product.sku || product.productCode || '',
    category: product.category || '',
    price: String(product.price ?? product.sellingPrice ?? ''),
    mrp: String(product.mrp ?? ''),
    cost: String(product.cost ?? product.purchasePrice ?? ''),
    discount: String(product.discount ?? ''),
    tax: String(product.tax ?? ''),
    unit: product.unit || 'PCS',
    hsn: product.hsn || '',
    description: product.description || '',
    trackingType: product.trackingType || 'none',
    company: product.company || '',
    status: product.status || 'Active',
    lowStockThreshold: String(product.lowStockThreshold ?? 5),
    specs: product.specs ? JSON.stringify(product.specs, null, 2) : '',
    barcode: product.barcode || '',
    brand: product.brand || '',
    photos: Array.isArray(product.photos) ? product.photos.filter(Boolean) : [],
    notes: product.notes || '',
  };
}

function downloadProducts(rows: MobileProduct[]) {
  exportProductsCSV(rows);
}

export function MobileProductWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const company = useAppStore((state) => state.company);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: products = [], isLoading, error, refetch } = useProducts();
  const { data: categories = [] } = useQuery({ queryKey: keys.categories, queryFn: () => getAll(COLLECTIONS.PRODUCT_CATEGORIES), staleTime: 300000 });
  const { data: stockRows = [] } = useQuery({ queryKey: keys.stock, queryFn: () => getAll(COLLECTIONS.STOCK), staleTime: 30000 });
  const { data: warehouses = [] } = useQuery({ queryKey: keys.warehouses, queryFn: () => getAll(COLLECTIONS.WAREHOUSES), staleTime: 300000 });
  const { data: quotations = [] } = useQuery({ queryKey: keys.quotationsAll, queryFn: () => getAll(COLLECTIONS.QUOTATIONS), staleTime: 60000 });
  const { data: orders = [] } = useQuery({ queryKey: keys.ordersAll, queryFn: () => getAll(COLLECTIONS.ORDERS), staleTime: 60000 });
  const { data: invoices = [] } = useQuery({ queryKey: keys.invoices, queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES), staleTime: 60000 });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<MobileProduct | null>(null);
  const [viewProduct, setViewProduct] = useState<MobileProduct | null>(null);
  const [form, setForm] = useState<MobileProductForm>({ ...PRODUCT_FORM_DEFAULT, photos: [] });
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MobileProduct | null>(null);
  const [statusTarget, setStatusTarget] = useState<MobileProduct | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('Active');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createParam = params.get('create') || '';

  const canCreate = perms.canCreate('products');
  const canEdit = perms.canEdit('products');
  const canDelete = perms.canDelete('products');
  const canExport = perms.canExport('products') || canEdit || canCreate;
  const currencySymbol = company?.currencySymbol || '₹';
  const contactPhone = company?.phone || '';
  const contactEmail = company?.email || '';

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingProduct(null);
    setForm({ ...PRODUCT_FORM_DEFAULT, photos: [] });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  useEffect(() => {
    const openId = params.get('open');
    if (!openId || viewProduct || !products.length) return;
    const product = (products as MobileProduct[]).find((entry) => entry.id === openId);
    if (product) setViewProduct(product);
  }, [params, products, viewProduct]);

  const filters = useMemo<ProductFilters>(() => ({
    search: params.get('q') || params.get('search') || '',
    status: params.get('status') || ALL,
    stock: params.get('stock') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredProducts = useMemo(() => filterProducts(products as MobileProduct[], filters, stockRows as any[]), [products, filters, stockRows]);
  const paginatedProducts = useMemo(() => filteredProducts.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredProducts, page]);
  const selectedRows = useMemo(() => (products as MobileProduct[]).filter((product) => selected.has(product.id)), [products, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredProducts.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredProducts.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const valid = new Set((products as MobileProduct[]).map((product) => product.id));
      const next = new Set(Array.from(current).filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [products]);

  const saveProduct = useSaveProduct(editingProduct?.id || null, () => {
    closeForm();
    void refetch();
  });
  const deleteProduct = useDeleteProduct();

  const statusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => Promise.all(ids.map((id) => updateDocById(COLLECTIONS.PRODUCTS, id, { status }))),
    onSuccess: (_, variables) => {
      void qc.invalidateQueries({ queryKey: keys.productsRoot });
      void qc.invalidateQueries({ queryKey: keys.productsAll });
      toast.success(`Marked ${variables.ids.length} product${variables.ids.length === 1 ? '' : 's'} ${variables.status}`);
      setSelected(new Set());
      setBulkStatusOpen(false);
      setStatusTarget(null);
    },
    onError: (e: any) => toast.error(e.message || 'Status update failed'),
  });

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function openProduct(product: MobileProduct) {
    setViewProduct(product);
    const next = new URLSearchParams(params);
    next.set('open', product.id);
    setParams(next, { replace: true });
  }

  function closeProduct() {
    setViewProduct(null);
    if (params.get('open')) {
      const next = new URLSearchParams(params);
      next.delete('open');
      setParams(next, { replace: true });
    }
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function updateForm(patch: Partial<MobileProductForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingProduct(null);
    setForm({ ...PRODUCT_FORM_DEFAULT, photos: [] });
    setDirty(false);
    if (mode === 'create') navigate('/app', { replace: true });
    if (createParam === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function requestCloseForm() {
    if (dirty) return setConfirmClose(true);
    closeForm();
  }

  function openCreate() {
    setEditingProduct(null);
    setForm({ ...PRODUCT_FORM_DEFAULT, photos: [] });
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(product: MobileProduct) {
    closeProduct();
    setEditingProduct(product);
    setForm(formFromProduct(product));
    setDirty(false);
    setFormOpen(true);
  }

  function openDuplicate(product: MobileProduct) {
    closeProduct();
    const copy = formFromProduct(product);
    setEditingProduct(null);
    setForm({ ...copy, name: `${copy.name} Copy`, sku: copy.sku ? `${copy.sku}-COPY` : '', status: 'Active' });
    setDirty(true);
    setFormOpen(true);
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files).slice(0, Math.max(0, 5 - (form.photos?.length || 0)));
    if (!incoming.length) return toast.error('You can upload up to 5 images');
    const compressed: string[] = [];
    for (const file of incoming) {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image`);
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} must be 5 MB or smaller`);
        continue;
      }
      compressed.push(await compressImageBase64(file, 700, 700, 0.78));
    }
    updateForm({ photos: [...(form.photos || []), ...compressed].slice(0, 5) });
  }

  function removePhoto(index: number) {
    updateForm({ photos: (form.photos || []).filter((_, idx) => idx !== index) });
  }

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return toast.error('Product name is required');
    if (Number(form.price) < 0 || Number(form.mrp) < 0 || Number(form.cost) < 0) return toast.error('Pricing cannot be negative');
    saveProduct.mutate({
      ...form,
      sku: form.sku || `sku_${Date.now()}`,
      photos: form.photos || [],
    } as ProductForm);
  }

  function deleteRows(rows: MobileProduct[]) {
    rows.forEach((product) => deleteProduct.mutate(product.id));
    setSelected(new Set());
    setDeleteTarget(null);
    closeProduct();
  }

  function archiveRows(rows: MobileProduct[]) {
    statusMutation.mutate({ ids: rows.map((row) => row.id), status: 'Inactive' });
  }

  if (mode === 'create') {
    return (
      <ProductDialogs
        formOpen={formOpen}
        form={form}
        categories={categories as any[]}
        dirty={dirty}
        saving={saveProduct.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onSubmit={submitForm}
        onUpload={uploadImages}
        onRemovePhoto={removePhoto}
        fileInputRef={fileInputRef}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Products</h1>
          </div>
        </div>

        {selected.size > 0 ? (
          <Card className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-bold text-[var(--color-primary-text)]">{selected.size} selected</p>
              {canExport ? <Button size="xs" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadProducts(selectedRows)}>Export</Button> : null}
              {canEdit ? <Button size="xs" variant="outline" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => archiveRows(selectedRows)}>Archive</Button> : null}
              {canEdit ? <Button size="xs" variant="outline" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => setBulkStatusOpen(true)}>Status</Button> : null}
              {canDelete ? <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleteTarget(selectedRows[0])}>Delete</Button> : null}
              <button type="button" className="text-xs font-medium text-[var(--color-text-muted)]" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </Card>
        ) : null}

        {error ? (
          <Card className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Products could not be loaded. <button type="button" className="font-bold underline" onClick={() => refetch()}>Retry</button>
          </Card>
        ) : null}

        <div className="space-y-2">
          {isLoading ? Array.from({ length: 5 }).map((_, index) => <ProductSkeletonCard key={index} />) : null}
          {!isLoading && !paginatedProducts.length ? (
            <Card className="rounded-xl p-6 text-center">
              <Package className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
              <p className="mt-3 text-sm font-bold text-[var(--color-text)]">{params.get('q') || params.get('status') || params.get('stock') || params.get('date') ? 'No products found' : 'No products yet'}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{params.get('q') || params.get('status') || params.get('stock') || params.get('date') ? 'Clear search or filters to view the full product catalog.' : 'Add your first product to start tracking inventory.'}</p>
              {!params.get('q') && !params.get('status') && !params.get('stock') && !params.get('date') && canCreate ? (
                <Button size="sm" icon={<Package className="h-4 w-4" />} onClick={openCreate} className="mt-3">Add First Product</Button>
              ) : null}
            </Card>
          ) : null}
          {paginatedProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              selected={selected.has(product.id)}
              currencySymbol={currencySymbol}
              stock={stockFor(product, stockRows as any[])}
              contactPhone={contactPhone}
              contactEmail={contactEmail}
              onSelect={() => toggleSelect(product.id)}
              onView={() => openProduct(product)}
            />
          ))}
        </div>

        <Pagination page={page} total={filteredProducts.length} perPage={PER_PAGE} onChange={changePage} />
      </div>

      <ProductDialogs
        formOpen={formOpen}
        form={form}
        categories={categories as any[]}
        dirty={dirty}
        saving={saveProduct.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onSubmit={submitForm}
        onUpload={uploadImages}
        onRemovePhoto={removePhoto}
        fileInputRef={fileInputRef}
      />

      <ProductViewModal
        product={viewProduct}
        stock={viewProduct ? stockFor(viewProduct, stockRows as any[]) : null}
        warehouses={warehouses as any[]}
        quotations={quotations as any[]}
        orders={orders as any[]}
        invoices={invoices as any[]}
        currencySymbol={currencySymbol}
        canEdit={canEdit}
        canDelete={canDelete}
        companyPhone={contactPhone}
        companyEmail={contactEmail}
        onClose={closeProduct}
        onEdit={openEdit}
        onDuplicate={openDuplicate}
        onDelete={(product) => setDeleteTarget(product)}
        onStatus={(product) => setStatusTarget(product)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteRows(selected.size ? selectedRows : deleteTarget ? [deleteTarget] : [])}
        loading={deleteProduct.isPending}
        title="Delete Product"
        message={selected.size > 1 ? `Delete ${selected.size} selected products? Stock entries will not be removed.` : 'Delete this product? Stock entries will not be removed.'}
      />

      <Modal open={bulkStatusOpen || Boolean(statusTarget)} onClose={() => { setBulkStatusOpen(false); setStatusTarget(null); }} title="Status Change" size="sm">
        <div className="space-y-4">
          <Select label="Product Status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} options={[{ label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }]} />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setBulkStatusOpen(false); setStatusTarget(null); }}>Cancel</Button>
            <Button
              className="flex-1"
              loading={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ ids: statusTarget ? [statusTarget.id] : Array.from(selected), status: bulkStatus })}
            >
              Apply
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ProductCard({ product, selected, currencySymbol, stock, contactPhone, contactEmail, onSelect, onView }: {
  product: MobileProduct;
  selected: boolean;
  currencySymbol: string;
  stock: ReturnType<typeof stockFor>;
  contactPhone: string;
  contactEmail: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const primaryPhoto = product.photos?.[0];
  return (
    <Card className={cn('rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]', selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40', stock.status === 'Low Stock' && 'border-l-4 border-l-amber-500', stock.status === 'Out Of Stock' && 'border-l-4 border-l-red-500')}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect} className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]" aria-label={`Select ${productName(product)}`} />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <div className="flex items-start gap-2.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]">
              {primaryPhoto ? <img src={primaryPhoto} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-[var(--color-text-muted)]" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{productName(product)}</p>
              <p className="mt-0.5 truncate font-mono text-xs font-medium text-[var(--color-text-muted)]">{productCode(product)}</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{product.category || 'Uncategorized'}</p>
            <p className="truncate">{product.brand || product.unit || 'Brand not set'}</p>
            <p className="truncate font-semibold text-[var(--color-text)]">{fmtCurrency(Number(product.price) || 0, currencySymbol)}</p>
            <p className="truncate">Stock {stock.available} {product.unit || ''}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(product.status || 'Active')}
            <Badge variant={stock.status === 'In Stock' ? 'success' : stock.status === 'Low Stock' ? 'warning' : 'danger'}>{stock.status}</Badge>
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsappHref(contactPhone)} target="_blank" rel="noreferrer" aria-label="WhatsApp product" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !contactPhone && 'pointer-events-none opacity-40')}><MessageCircle className="h-4 w-4" /></a>
          <a href={contactEmail ? `mailto:${contactEmail}?subject=${encodeURIComponent(productName(product))}` : undefined} aria-label="Email product" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !contactEmail && 'pointer-events-none opacity-40')}><Mail className="h-4 w-4" /></a>
          <a href={contactPhone ? `tel:${contactPhone}` : undefined} aria-label="Call product" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !contactPhone && 'pointer-events-none opacity-40')}><Phone className="h-4 w-4" /></a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function ProductSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="h-11 w-11 rounded-lg bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

function ProductDialogs({ formOpen, form, categories, dirty, saving, confirmClose, onCloseForm, onDiscard, onKeepEditing, onFormChange, onSubmit, onUpload, onRemovePhoto, fileInputRef }: {
  formOpen: boolean;
  form: MobileProductForm;
  categories: any[];
  dirty: boolean;
  saving: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onFormChange: (patch: Partial<MobileProductForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
  onUpload: (files: FileList | null) => void;
  onRemovePhoto: (index: number) => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
}) {
  const categoryOptions = [
    { label: 'Select category...', value: '' },
    ...categories.map((category) => ({ label: category.name || category.title || category.id, value: category.name || category.title || category.id })),
  ];
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title="Product" size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Section title="Basic Information">
            <Input label="Product Name" required value={form.name} onChange={(event) => onFormChange({ name: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="SKU / Code" value={form.sku} onChange={(event) => onFormChange({ sku: event.target.value })} />
              <Input label="Barcode" value={form.barcode || ''} onChange={(event) => onFormChange({ barcode: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Category" value={form.category} onChange={(event) => onFormChange({ category: event.target.value })} options={categoryOptions} />
              <Input label="Brand" value={form.brand || ''} onChange={(event) => onFormChange({ brand: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Unit" value={form.unit} onChange={(event) => onFormChange({ unit: event.target.value })} options={UNIT_OPTIONS.length ? UNIT_OPTIONS : UNITS.map((unit) => ({ label: unit, value: unit }))} />
              <Select label="Status" value={form.status} onChange={(event) => onFormChange({ status: event.target.value })} options={[{ label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }]} />
            </div>
          </Section>

          <Section title="Pricing & Tax">
            <div className="grid grid-cols-3 gap-3">
              <Input label="Selling" inputMode="decimal" value={form.price} onChange={(event) => onFormChange({ price: event.target.value })} />
              <Input label="MRP" inputMode="decimal" value={form.mrp} onChange={(event) => onFormChange({ mrp: event.target.value })} />
              <Input label="Cost" inputMode="decimal" value={form.cost} onChange={(event) => onFormChange({ cost: event.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Tax %" inputMode="decimal" value={form.tax} onChange={(event) => onFormChange({ tax: event.target.value })} />
              <Input label="Discount" inputMode="decimal" value={form.discount} onChange={(event) => onFormChange({ discount: event.target.value })} />
              <Input label="HSN" value={form.hsn} onChange={(event) => onFormChange({ hsn: event.target.value })} />
            </div>
          </Section>

          <Section title="Inventory">
            <Input label="Low Stock Threshold" inputMode="numeric" value={form.lowStockThreshold} onChange={(event) => onFormChange({ lowStockThreshold: event.target.value })} />
            <Select label="Dispatch Verification" value={form.trackingType} onChange={(event) => onFormChange({ trackingType: event.target.value })} options={TRACKING_OPTIONS} />
          </Section>

          <Section title="Images">
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { void onUpload(event.target.files); event.target.value = ''; }} />
            <div className="grid grid-cols-3 gap-2">
              {(form.photos || []).map((photo, index) => (
                <div key={index} className="relative aspect-square overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sunken)]">
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => onRemovePhoto(index)} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white" aria-label="Remove photo"><X className="h-3 w-3" /></button>
                </div>
              ))}
              {(form.photos || []).length < 5 ? (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-xs font-medium text-[var(--color-text-muted)]">
                  <ImagePlus className="mb-1 h-5 w-5" />Upload
                </button>
              ) : null}
            </div>
          </Section>

          <Section title="Description & Specs">
            <Textarea label="Description" value={form.description} onChange={(event) => onFormChange({ description: event.target.value })} />
            <Textarea label="Specs JSON" value={form.specs} onChange={(event) => onFormChange({ specs: event.target.value })} placeholder='{"wattage":"550W","brand":"Neozy"}' />
            <Textarea label="Notes" value={form.notes || ''} onChange={(event) => onFormChange({ notes: event.target.value })} />
          </Section>

          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function ProductViewModal({ product, stock, warehouses, quotations, orders, invoices, currencySymbol, canEdit, canDelete, companyPhone, companyEmail, onClose, onEdit, onDuplicate, onDelete, onStatus }: {
  product: MobileProduct | null;
  stock: ReturnType<typeof stockFor> | null;
  warehouses: any[];
  quotations: any[];
  orders: any[];
  invoices: any[];
  currencySymbol: string;
  canEdit: boolean;
  canDelete: boolean;
  companyPhone: string;
  companyEmail: string;
  onClose: () => void;
  onEdit: (product: MobileProduct) => void;
  onDuplicate: (product: MobileProduct) => void;
  onDelete: (product: MobileProduct) => void;
  onStatus: (product: MobileProduct) => void;
}) {
  if (!product) return null;
  const relatedQuotations = quotations.filter((row) => row.items?.some((item: any) => item.productId === product.id));
  const relatedOrders = orders.filter((row) => row.items?.some((item: any) => item.productId === product.id));
  const relatedInvoices = invoices.filter((row) => row.items?.some((item: any) => item.productId === product.id));
  const purchasePrice = Number(product.cost ?? product.purchasePrice) || 0;
  const sellingPrice = Number(product.price ?? product.sellingPrice) || 0;
  const margin = sellingPrice > 0 ? ((sellingPrice - purchasePrice) / sellingPrice) * 100 : 0;
  const photos = Array.isArray(product.photos) ? product.photos.filter(Boolean) : [];
  const warehouseRows = stock?.rows || [];
  const activity = [
    { type: 'Created', desc: 'Product record created', date: product.createdAt, userName: product.createdByName || product.createdBy || 'System' },
    ...(product.updatedAt ? [{ type: 'Updated', desc: 'Product was updated', date: product.updatedAt, userName: product.updatedByName || product.updatedBy || 'System' }] : []),
    ...warehouseRows.slice(0, 5).map((row) => ({ type: 'Stock', desc: `${row.warehouse || row.warehouseName || 'Warehouse'} · ${Number(row.availableQty ?? row.available) || 0} available`, date: row.updatedAt || row.createdAt, userName: row.updatedByName || 'System' })),
  ];

  return (
    <Modal open={!!product} onClose={onClose} title={productName(product)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(product.status || 'Active')}
            {stock ? <Badge variant={stock.status === 'In Stock' ? 'success' : stock.status === 'Low Stock' ? 'warning' : 'danger'}>{stock.status}</Badge> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="SKU" value={productCode(product)} />
            <Detail label="Selling Price" value={fmtCurrency(sellingPrice, currencySymbol)} />
          </div>
        </section>

        <Section title="Product Information">
          <Detail label="Product Name" value={productName(product)} />
          <Detail label="SKU" value={productCode(product)} />
          <Detail label="Barcode" value={product.barcode || 'Not available'} />
          <Detail label="Category" value={product.category || 'Uncategorized'} />
          <Detail label="Brand" value={product.brand || 'Not available'} />
          <Detail label="Unit" value={product.unit || 'PCS'} />
          <Detail label="Tracking" value={product.trackingType || 'none'} />
        </Section>

        <Section title="Pricing">
          <Detail label="Purchase Price" value={fmtCurrency(purchasePrice, currencySymbol)} />
          <Detail label="Selling Price" value={fmtCurrency(sellingPrice, currencySymbol)} />
          <Detail label="MRP" value={fmtCurrency(Number(product.mrp) || 0, currencySymbol)} />
          <Detail label="Margin" value={`${margin.toFixed(1)}%`} />
        </Section>

        <Section title="Tax Information">
          <Detail label="GST / Tax" value={`${Number(product.tax) || 0}%`} />
          <Detail label="HSN Code" value={product.hsn || 'Not available'} />
        </Section>

        <Section title="Inventory">
          <Detail label="Current Stock" value={`${stock?.available ?? 0} ${product.unit || ''}`} />
          <Detail label="Reserved Stock" value={`${stock?.reserved ?? 0} ${product.unit || ''}`} />
          <Detail label="Low Stock Threshold" value={`${stock?.threshold ?? product.lowStockThreshold ?? 5} ${product.unit || ''}`} />
        </Section>

        <Section title="Warehouse Information">
          {warehouseRows.length ? warehouseRows.map((row) => {
            const warehouse = warehouses.find((entry) => entry.id === row.warehouseId);
            return <Detail key={row.id || row.warehouseId} label={warehouse?.name || row.warehouse || row.warehouseName || row.warehouseId || 'Warehouse'} value={`${Number(row.availableQty ?? row.available) || 0} available · ${Number(row.reservedQty ?? row.reserved) || 0} reserved`} />;
          }) : <p className="text-sm text-[var(--color-text-muted)]">No warehouse stock available.</p>}
        </Section>

        <Section title="Description">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{product.description || 'No description recorded.'}</p>
        </Section>

        <Section title="Images">
          {photos.length ? <div className="grid grid-cols-3 gap-2">{photos.map((photo, index) => <img key={index} src={photo} alt="" className="aspect-square rounded-lg border border-[var(--color-border)] object-cover" />)}</div> : <p className="text-sm text-[var(--color-text-muted)]">No images uploaded.</p>}
        </Section>

        <Section title="Attachments">
          <p className="text-sm text-[var(--color-text-muted)]">{product.attachmentName || product.fileName || 'No attachments available.'}</p>
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{product.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${productName(product)} Timeline`} entries={activity} />
        </Section>

        <RelatedRows title="Related Quotations" rows={relatedQuotations} />
        <RelatedRows title="Related Orders" rows={relatedOrders} />
        <RelatedRows title="Related Invoices" rows={relatedInvoices} />

        <Section title="Audit Information">
          <Detail label="Created By" value={product.createdByName || product.createdBy || 'System'} />
          <Detail label="Created" value={product.createdAt ? fmtDate(product.createdAt) : 'Not available'} />
          <Detail label="Updated" value={product.updatedAt ? fmtDate(product.updatedAt) : 'Not available'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {companyPhone ? <a className={linkButtonClass} href={`tel:${companyPhone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {companyPhone ? <a className={linkButtonClass} href={whatsappHref(companyPhone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {companyEmail ? <a className={linkButtonClass} href={`mailto:${companyEmail}?subject=${encodeURIComponent(productName(product))}`}><Mail className="h-4 w-4" />Email</a> : null}
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(product)}>Edit</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => onDuplicate(product)}>Duplicate</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Archive className="h-4 w-4" />} onClick={() => onStatus(product)}>Status</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(product)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function RelatedRows({ title, rows }: { title: string; rows: any[] }) {
  return (
    <Section title={title}>
      {rows.length ? rows.slice(0, 6).map((row) => (
        <div key={row.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
          <p className="text-sm font-semibold text-[var(--color-text)]">{row.quotationNumber || row.orderNumber || row.invoiceNumber || row.piNumber || row.id}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.customer || row.customerName || row.status || 'Related record'}</p>
        </div>
      )) : <p className="text-sm text-[var(--color-text-muted)]">No related records.</p>}
    </Section>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3><div className="mt-3 space-y-3">{children}</div></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p></div>;
}

export default MobileProductWorkspace;
