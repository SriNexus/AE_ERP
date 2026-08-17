import { fmtDate, fmtDateTime } from '../../../lib/firestore';

export function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function daysAgoText(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'Not available';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const then = new Date(date);
  then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function recencyDotClass(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const created = new Date(date);
  created.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

export function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Number(value).toLocaleString('en-IN');
}

export function parseCapacity(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const text = String(raw ?? '').replace(/,/g, '');
  const match = text.match(/(\d+(\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function warehouseCompany(row: any): string {
  return row.companyName || row.company || '—';
}

export function warehouseType(row: any): string {
  return row.warehouseType || row.type || row.category || 'General';
}

export function warehouseLocation(row: any): string {
  const parts = [row.city, row.state].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export function matchesWarehouseEntity(warehouse: any, candidate: any): boolean {
  const warehouseTokens = [warehouse?.id, warehouse?.name, warehouse?.code]
    .map(normalizeText)
    .filter(Boolean);
  const candidateTokens = [candidate?.warehouseId, candidate?.warehouseName, candidate?.warehouse]
    .map(normalizeText)
    .filter(Boolean);
  return candidateTokens.some((token) => warehouseTokens.includes(token));
}

export function downloadFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadWarehouseCsv(rows: any[]) {
  const headers = [
    'Warehouse',
    'Code',
    'Company',
    'Location',
    'Manager',
    'Manager Phone',
    'Capacity',
    'Used',
    'Available',
    'Products',
    'Status',
    'Created',
  ];
  const lines = rows.map((row) => [
    row.name || '',
    row.code || '',
    warehouseCompany(row),
    warehouseLocation(row),
    row.managerName || '',
    row.managerPhone || '',
    row.capacity || '',
    row.usedLabel || '',
    row.availableLabel || '',
    row.productCount ?? '',
    row.status || '',
    fmtDate(row.createdAt),
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
  downloadFile('warehouses.csv', ['\uFEFF' + headers.join(','), ...lines].join('\r\n'), 'text/csv;charset=utf-8');
}

export function downloadWarehouseReport(warehouse: any, stats: any, products: any[], movements: any[]) {
  const lines = [
    `Warehouse Report`,
    `Name: ${warehouse?.name || '—'}`,
    `Code: ${warehouse?.code || '—'}`,
    `Company: ${warehouseCompany(warehouse)}`,
    `Location: ${warehouseLocation(warehouse)}`,
    `Manager: ${warehouse?.managerName || '—'}`,
    `Manager Phone: ${warehouse?.managerPhone || '—'}`,
    `Capacity: ${warehouse?.capacity || '—'}`,
    `Used: ${stats.usedLabel || '—'}`,
    `Available: ${stats.availableLabel || '—'}`,
    `Products: ${stats.productCount || 0}`,
    `Status: ${warehouse?.status || '—'}`,
    `Created: ${fmtDateTime(warehouse?.createdAt)}`,
    `Updated: ${fmtDateTime(warehouse?.updatedAt)}`,
    ``,
    `Products in warehouse:`,
    ...products.map((row) => `- ${row.productName || row.product || '—'} | Available: ${formatNumber(row.available)} | Reserved: ${formatNumber(row.reserved)} | Unit: ${row.unit || 'PCS'}`),
    ``,
    `Recent movements:`,
    ...movements.map((move) => `- ${fmtDateTime(move.date || move.createdAt)} | ${move.type || move.movementType || 'Movement'} | ${move.productName || move.product || '—'} | Qty: ${move.qty || 0}`),
  ];
  downloadFile(`warehouse-${warehouse?.code || warehouse?.id || 'report'}.txt`, lines.join('\r\n'));
}

export function formatCapacityLabel(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (typeof raw === 'number' && Number.isFinite(raw)) return formatNumber(raw);
  return String(raw);
}

