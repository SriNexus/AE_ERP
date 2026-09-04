// features/inventory/hooks/useInventory.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAll, createDocWithId, updateDocById, deleteDocById, genId, fmtDate,
} from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
// INVENTORY-05a: single canonical stock-summary identity — the local copy was
// a byte-identical duplicate of this one; deleted so there is ONE source.
import { stockSummaryId } from '../../../lib/workflow';
import { useCurrentUser, useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { UNITS } from '../../../config/company';
import toast from 'react-hot-toast';
import { NotificationType, type Product } from '../../../types';
import { notifyRoleUsers } from '../../../lib/notifications';

// ── Products ────────────────────────────────────────────────

export const PRODUCT_FORM_DEFAULT = {
  name: '', sku: '', category: '', price: '', mrp: '', cost: '',
  discount: '', tax: '', unit: 'PCS', hsn: '', description: '',
  trackingType: 'none', company: '', status: 'Active', lowStockThreshold: '5', specs: '',
};
export type ProductForm = typeof PRODUCT_FORM_DEFAULT;

export const UNIT_OPTIONS = UNITS.map(u => ({ label: u, value: u }));

export const TRACKING_OPTIONS = [
  { label: 'No Verification Required (Qty Only)',   value: 'none' },
  { label: 'Barcode Scan Required',                 value: 'barcode' },
  { label: 'Serial Number Required',                value: 'serial' },
  { label: 'Both Barcode & Serial Required',        value: 'barcode_serial' },
];

export function useProducts() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const result = useQuery({
    queryKey: keys.productsRoot,
    queryFn: () => getAll<Product>(COLLECTIONS.PRODUCTS),
    staleTime: 60_000,
  });

  return {
    ...result,
    data: (result.data || []) as Product[],
    loadMore: async () => undefined,
    hasMore: false,
    loadingMore: false,
  };
}

export function useSaveProduct(editId: string | null, onSuccess: () => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (data: ProductForm) => {
      const payload = {
        ...data,
        price:    Number(data.price)    || 0,
        mrp:      Number(data.mrp)      || 0,
        cost:     Number(data.cost)     || 0,
        discount: Number(data.discount) || 0,
        tax:      Number(data.tax)      || 0,
        lowStockThreshold: Number(data.lowStockThreshold) || 5,
        specs: data.specs ? (() => { try { return JSON.parse(data.specs); } catch { return {}; } })() : {},
      };
      if (editId) {
        await updateDocById(COLLECTIONS.PRODUCTS, editId, payload);
        await notifyRoleUsers(['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Product updated', `Product ${data.name || editId} was updated.`, 'stock', editId, activeCompanyId);
      } else {
        const id = genId.generic('PRD');
        await createDocWithId(COLLECTIONS.PRODUCTS, id, { ...payload, id, companyId: activeCompanyId, status: data.status || 'Active', photos: (data as any).photos || [], isDeleted: false, createdBy: user.id });
        await notifyRoleUsers(['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Product created', `Product ${data.name || id} was created.`, 'stock', id, activeCompanyId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.productsRoot });
      qc.invalidateQueries({ queryKey: keys.productsAll });
      toast.success(editId ? 'Product updated' : 'Product added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteProduct() {
  const qc              = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.PRODUCTS, id);
      await notifyRoleUsers(['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Product deleted', `Product ${id} was deleted.`, 'stock', id, activeCompanyId);
    },
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: keys.productsRoot });
      qc.invalidateQueries({ queryKey: keys.productsAll });
      toast.success('Product deleted');
    },
    onError:    (e: any) => toast.error(e.message),
  });
}

export function exportProductsCSV(products: any[]) {
  const rows = [
    ['ID', 'Name', 'SKU', 'Category', 'Price', 'MRP', 'Cost', 'Discount', 'Tax', 'Unit', 'HSN'],
    ...products.map((p: any) => [p.id, p.name, p.sku, p.category, p.price, p.mrp, p.cost, p.discount, p.tax, p.unit, p.hsn]),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'products.csv';
  a.click();
  toast.success('Exported!');
}

// ── Stock ────────────────────────────────────────────────────

export const STOCK_FORM_DEFAULT = {
  productId: '', product: '', warehouseId: '', warehouse: '',
  type: 'IN', qty: '', unit: 'PCS', reference: '', notes: '',
  date: new Date().toISOString().split('T')[0],
};
export type StockForm = typeof STOCK_FORM_DEFAULT;

function stockErrorMessage(error: any) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) return 'Permission denied';
  if (lower.includes('active company')) return 'Company missing';
  if (lower.includes('quantity') || lower.includes('product') || lower.includes('warehouse') || lower.includes('insufficient stock')) return message;
  return 'Stock update failed';
}

function stockSummaryKey(row: any) {
  return `${row.companyId || ''}|${row.productId || ''}|${row.warehouseId || ''}`;
}

function canonicalizeStockSummary(rows: any[]) {
  const byKey = new Map<string, any>();
  rows.forEach((row) => {
    const key = stockSummaryKey(row);
    const canonicalId = stockSummaryId(row.companyId, row.productId, row.warehouseId);
    const current = byKey.get(key);
    if (!current || row.id === canonicalId) {
      byKey.set(key, row);
    }
  });
  return Array.from(byKey.values());
}

export function useStock() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({ queryKey: keys.stockLedger, queryFn: () => getAll(COLLECTIONS.STOCK_LEDGER), staleTime: 30_000 });
}

export function useStockSummary() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({ queryKey: keys.stock, queryFn: async () => canonicalizeStockSummary(await getAll(COLLECTIONS.STOCK)), staleTime: 30_000 });
}

export function useSaveStockEntry(onSuccess: () => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (data: StockForm) => {
      const qty = Number(data.qty);
      if (!data.productId) throw new Error('Product is required');
      if (!data.warehouseId) throw new Error('Warehouse is required');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be greater than zero');

      // INVENTORY-05d: manual Add / Adjust Stock now goes through the shared
      // movement engine — the single stock writer (P1-4). Manual entries have
      // never been idempotent (INVENTORY-00 baseline), so a fresh idempotency
      // key is minted on every submission.
      const { applyStockMovement } = await import('../../../lib/inventory/stockMovementEngine');
      const movementType = data.type === 'OUT' ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';
      const reference = String(data.reference || '').trim();
      const reasonCode = reference || String(data.notes || '').trim() || `Manual stock ${String(data.type).toLowerCase()}`;

      const result = await applyStockMovement({
        movementType,
        productId: data.productId,
        warehouseId: data.warehouseId,
        qty,
        unit: data.unit,
        sourceType: 'manual',
        sourceId: reference || genId.generic('STK'),
        idempotencyKey: `${movementType}:manual:${genId.generic('STK')}`,
        companyId: activeCompanyId,
        actorId: user.id,
        reasonCode,
        notes: data.notes,
        ledgerExtra: {
          reference, product: data.product || '', warehouse: data.warehouse || '', date: data.date,
        },
      });

      await notifyRoleUsers(
        ['Warehouse', 'Operations'],
        NotificationType.INVENTORY_UPDATED,
        'Inventory updated',
        `Stock ${data.type} entry ${result.ledgerId} was recorded for ${data.product || data.productId}.`,
        'stock',
        result.ledgerId,
        activeCompanyId
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.stockLedger });
      qc.invalidateQueries({ queryKey: keys.stock });
      toast.success('Stock entry saved');
      onSuccess();
    },
    onError: (e: any) => toast.error(stockErrorMessage(e)),
  });
}

export function useDeleteStockEntry() {
  const qc              = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.STOCK_LEDGER, id);
      await notifyRoleUsers(['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Inventory entry deleted', `Stock entry ${id} was deleted.`, 'stock', id, activeCompanyId);
    },
    onSuccess:  () => { qc.invalidateQueries({ queryKey: keys.stockLedger }); toast.success('Entry deleted'); },
    onError:    (e: any) => toast.error(stockErrorMessage(e)),
  });
}

export function exportStockCSV(entries: any[]) {
  const rows = [
    ['Date', 'Product', 'Warehouse', 'Type', 'Qty', 'Unit', 'Reference'],
    ...entries.map((s: any) => [fmtDate(s.createdAt), s.product, s.warehouse, s.type, s.qty, s.unit, s.reference]),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'stock.csv';
  a.click();
  toast.success('Exported!');
}
