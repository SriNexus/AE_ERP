import type { Product } from '../../../types';

export type StockView = 'summary' | 'ledger';
export type DateRange = 'all' | 'today' | '7d' | '30d' | '90d' | 'custom';

export type SummaryFilterState = {
  search: string;
  createdBy: string;
  product: string;
  warehouse: string;
  category: string;
  company: string;
  movement: string;
  status: string;
  dateRange: DateRange;
  customFrom: string;
  customTo: string;
  sortKey: string;
  sortDesc: boolean;
  kpi: string;
  activeKpi: string;
  page: number;
  perPage: number;
};

export type AddStockForm = {
  productId: string;
  warehouseId: string;
  qty: string;
  unit: string;
  sourceType: 'purchase' | 'return' | 'adjustment';
  sourceId: string;
  notes: string;
};

export const PER_PAGE_OPTIONS = [10, 20, 50] as const;
export const DEFAULT_PER_PAGE = 10;
export const DATE_RANGE_OPTIONS = [
  { label: 'All Time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
  { label: 'Custom', value: 'custom' },
];
export const ALL = 'All';

export function normalize(value?: string) {
  return String(value || '').trim().toLowerCase();
}

export function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isToday(value: any): boolean {
  const date = toDateValue(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function isInDateRange(value: any, range: DateRange, from: string, to: string): boolean {
  if (range === 'all') return true;
  const date = toDateValue(value);
  if (!date) return false;
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === '7d') {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === '30d') {
    start.setDate(now.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === '90d') {
    start.setDate(now.getDate() - 89);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (fromDate && !Number.isNaN(fromDate.getTime())) start.setTime(fromDate.getTime());
    if (toDate && !Number.isNaN(toDate.getTime())) end.setTime(toDate.getTime());
    if (fromDate) start.setHours(0, 0, 0, 0);
    if (toDate) end.setHours(23, 59, 59, 999);
  }
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

export function stockSummaryMatchesKpi(row: any, kpi: string): boolean {
  const available = Number(row.availableQty ?? row.available) || 0;
  const reserved = Number(row.reservedQty ?? row.reserved) || 0;
  const minStock = Number(row.min_stock ?? row.lowStockThreshold ?? 5) || 5;
  switch (kpi) {
    case 'total':
    case '':
      return true;
    case 'instock':
      return available > 0;
    case 'low':
      return available > 0 && available <= minStock;
    case 'out':
      return available <= 0;
    case 'reserved':
      return reserved > 0;
    case 'available':
      return available > 0 && reserved === 0;
    default:
      return true;
  }
}

export function stockLedgerMatchesKpi(row: any, kpi: string): boolean {
  const type = String(row.type || row.movementType || row.sourceType || 'IN').toUpperCase();
  switch (kpi) {
    case 'total':
    case '':
      return true;
    case 'in':
      return type === 'IN';
    case 'out':
      return type === 'OUT';
    case 'transfer':
      return String(row.sourceType || '').toLowerCase().includes('dispatch') || String(row.sourceType || '').toLowerCase().includes('order');
    case 'adjust':
      return type === 'ADJUSTMENT';
    default:
      return true;
  }
}

export function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
}

export function stockErrorMessage(error: any) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) return 'Permission denied';
  if (lower.includes('active company')) return 'Company missing';
  if (lower.includes('quantity') || lower.includes('product') || lower.includes('warehouse')) return message;
  return 'Stock update failed';
}

export function defaultSummaryFilters(params: URLSearchParams): SummaryFilterState {
  return {
    search: params.get('q') || '',
    createdBy: params.get('createdBy') || '',
    product: params.get('product') || ALL,
    warehouse: params.get('warehouse') || ALL,
    category: params.get('category') || ALL,
    company: params.get('company') || ALL,
    movement: params.get('movement') || ALL,
    status: params.get('status') || '',
    dateRange: (params.get('date') as DateRange) || 'all',
    customFrom: params.get('from') || '',
    customTo: params.get('to') || '',
    sortKey: params.get('sort') || '',
    sortDesc: params.get('sortDesc') === '1',
    kpi: params.get('kpi') || '',
    activeKpi: params.get('kpi') || '',
    page: Math.max(1, Number(params.get('page')) || 1),
    perPage: Math.max(1, Number(params.get('perPage')) || DEFAULT_PER_PAGE),
  };
}

export function blankSummaryFilters(): SummaryFilterState {
  return {
    search: '',
    createdBy: '',
    product: ALL,
    warehouse: ALL,
    category: ALL,
    company: ALL,
    movement: ALL,
    status: '',
    dateRange: 'all',
    customFrom: '',
    customTo: '',
    sortKey: '',
    sortDesc: false,
    kpi: '',
    activeKpi: '',
    page: 1,
    perPage: DEFAULT_PER_PAGE,
  };
}

export function blankAddStockForm(): AddStockForm {
  return {
    productId: '',
    warehouseId: '',
    qty: '',
    unit: 'PCS',
    sourceType: 'adjustment',
    sourceId: '',
    notes: '',
  };
}

export function currentRowDate(row: any) {
  return row.date || row.createdAt || row.updatedAt;
}

export function userDisplayName(row: any, userMap: Map<string, any>) {
  const userId = row.performedBy || row.performedById || row.createdBy || row.createdById || row.updatedBy || row.updatedById;
  const user = userId ? userMap.get(userId) : null;
  return row.performedByName || row.createdByName || row.updatedByName || user?.name || user?.displayName || user?.email || 'System';
}

export function rowCompany(row: any, productMap: Map<string, Product>, warehouseMap: Map<string, any>) {
  return row.companyName || row.company || (productMap.get(row.productId) as any)?.companyName || warehouseMap.get(row.warehouseId)?.company || '—';
}

export function rowSearchText(row: any, mode: StockView, productMap: Map<string, Product>, warehouseMap: Map<string, any>, userMap: Map<string, any>) {
  const product = productMap.get(row.productId);
  const warehouse = warehouseMap.get(row.warehouseId);
  return [
    row.id,
    row.productId,
    row.product,
    row.productName,
    product?.name,
    product?.sku,
    row.warehouseId,
    row.warehouse,
    row.warehouseName,
    warehouse?.name,
    rowCompany(row, productMap, warehouseMap),
    userDisplayName(row, userMap),
    row.movementType,
    row.type,
    mode,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

export function matchesRow(row: any, mode: StockView, filter: SummaryFilterState, productMap: Map<string, Product>, warehouseMap: Map<string, any>, userMap: Map<string, any>) {
  if (filter.search && !rowSearchText(row, mode, productMap, warehouseMap, userMap).includes(normalize(filter.search))) return false;
  if (filter.createdBy && normalize(row.createdBy || row.performedBy || row.performedById || '') !== normalize(filter.createdBy)) return false;
  if (filter.product !== ALL && normalize(row.productId || row.product || row.productName || productMap.get(row.productId)?.name) !== normalize(filter.product)) return false;
  if (filter.warehouse !== ALL && normalize(row.warehouseId || row.warehouse || row.warehouseName || warehouseMap.get(row.warehouseId)?.name) !== normalize(filter.warehouse)) return false;
  if (filter.category !== ALL && normalize(row.category || productMap.get(row.productId)?.category) !== normalize(filter.category)) return false;
  if (filter.company !== ALL && normalize(rowCompany(row, productMap, warehouseMap)) !== normalize(filter.company)) return false;
  if (filter.movement !== ALL && normalize(row.movementType || row.type) !== normalize(filter.movement)) return false;
  if (filter.status && normalize(row.status) !== normalize(filter.status)) return false;
  if (filter.activeKpi && mode === 'summary' && !stockSummaryMatchesKpi(row, filter.activeKpi)) return false;
  if (filter.activeKpi && mode === 'ledger' && !stockLedgerMatchesKpi(row, filter.activeKpi)) return false;
  return isInDateRange(currentRowDate(row), filter.dateRange, filter.customFrom, filter.customTo);
}

export function makeParams(view: StockView, filter: SummaryFilterState, openId: string) {
  const next = new URLSearchParams();
  if (view !== 'summary') next.set('tab', view);
  if (filter.search) next.set('q', filter.search);
  if (filter.createdBy) next.set('createdBy', filter.createdBy);
  if (filter.product !== ALL) next.set('product', filter.product);
  if (filter.warehouse !== ALL) next.set('warehouse', filter.warehouse);
  if (filter.company !== ALL) next.set('company', filter.company);
  if (filter.category !== ALL) next.set('category', filter.category);
  if (filter.movement !== ALL) next.set('movement', filter.movement);
  if (filter.status) next.set('status', filter.status);
  if (filter.dateRange !== 'all') next.set('date', filter.dateRange);
  if (filter.customFrom) next.set('from', filter.customFrom);
  if (filter.customTo) next.set('to', filter.customTo);
  if (filter.sortKey) next.set('sort', filter.sortKey);
  if (filter.sortDesc) next.set('sortDesc', '1');
  if (filter.activeKpi) next.set('kpi', filter.activeKpi);
  if (filter.page > 1) next.set('page', String(filter.page));
  if (filter.perPage !== DEFAULT_PER_PAGE) next.set('perPage', String(filter.perPage));
  if (openId) next.set('open', openId);
  return next;
}

export function makeTableSelections(rows: any[], selected: Set<string>) {
  return rows.filter((row) => selected.has(row.id));
}

export function selectTableOptions(mode: StockView, rows: any[], products: Product[], warehouses: any[]) {
  const productOptions = Array.from(new Set(rows.map((row) => row.productId || row.product || row.productName).filter(Boolean)))
    .map((value) => ({ label: String(value), value: String(value) }));
  const warehouseOptions = Array.from(new Set(rows.map((row) => row.warehouseId || row.warehouse || row.warehouseName).filter(Boolean)))
    .map((value) => ({ label: String(value), value: String(value) }));
  const companies = Array.from(new Set(rows.map((row) => row.companyName || row.company).filter(Boolean)));
  const categoryOptions = Array.from(new Set(products.map((product) => product.category).filter(Boolean)));
  const statusOptions = Array.from(new Set(rows.map((row) => row.status).filter(Boolean)))
    .map((value) => ({ label: String(value), value: String(value) }));
  const movementOptions = Array.from(new Set(rows.map((row) => row.movementType || row.type).filter(Boolean)));
  return {
    companies,
    categoryOptions,
    productOptions: productOptions.length ? productOptions : products.map((product) => ({ label: product.name, value: product.id || product.name })).filter((option) => option.value),
    warehouseOptions: warehouseOptions.length ? warehouseOptions : warehouses.map((warehouse: any) => ({ label: warehouse.name, value: warehouse.id || warehouse.name })).filter((option: any) => option.value),
    statusOptions,
    movementOptions: mode === 'ledger' ? movementOptions : [],
  };
}

export function getProductImage(product?: Product | null) {
  return Array.isArray(product?.photos) && product.photos.length ? product.photos[0] : '';
}
