export type DispatchMode = 'view' | 'edit' | 'verify' | 'execute';
export type PageSection = 'overview' | 'operations' | 'timeline';
export type DateRange = 'all' | 'today' | '7d' | '30d' | '90d' | 'custom';
export type EditDraft = {
  id: string;
  vehicleNo: string;
  driverName: string;
  driverPhone: string;
  transporterId: string;
  lrNumber: string;
  notes: string;
  assignedToId: string;
  assignedToName: string;
  priority: string;
  date: string;
};

export const PER_PAGE_OPTIONS = [10, 20, 50] as const;
export const DEFAULT_FORM = { orderId: '', customerId: '', customer: '', warehouseId: '', warehouse: '', vehicleNo: '', driverName: '', driverPhone: '', transporterId: '', lrNumber: '', notes: '', projectId: '', projectName: '' };

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
    if (fromDate && !Number.isNaN(fromDate.getTime())) {
      start.setTime(fromDate.getTime());
    }
    if (toDate && !Number.isNaN(toDate.getTime())) {
      end.setTime(toDate.getTime());
    }
    if (fromDate) start.setHours(0, 0, 0, 0);
    if (toDate) end.setHours(23, 59, 59, 999);
  }
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

export function getPageNumbers(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, '…', pages];
  if (page >= pages - 3) return [1, '…', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, '…', page - 1, page, page + 1, '…', pages];
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Number(value).toLocaleString('en-IN');
}

export function dispatchCustomer(row: any): string {
  return row.customerName || row.customer || '—';
}

export function dispatchWarehouse(row: any): string {
  return row.warehouseName || row.warehouse || '—';
}

export function dispatchAssigned(row: any): string {
  return row.assignedToName || row.ownerName || row.createdByName || row.updatedByName || 'System';
}

export function dispatchType(row: any): string {
  return row.dispatchType || row.type || (String(row.orderId || '').startsWith('PI-') ? 'Proforma' : 'Standard');
}

export function dispatchPriority(row: any): string {
  return row.priority || 'Normal';
}

export function dispatchOwner(row: any): string {
  return row.ownerName || row.assignedToName || row.createdByName || row.updatedByName || 'System';
}

export function dispatchDisplayNumber(row: any): string {
  return String(row?.dispatchNumber || row?.dispatchNo || row?.dispatchId || row?.id || '').trim() || '—';
}

export function orderDisplayNumber(row: any): string {
  return String(row?.orderNumber || row?.orderNo || '').trim() || '—';
}

export function dispatchProgress(row: any): number {
  const status = String(row.status || '').toLowerCase();
  const approval = String(row.approvalStatus || '').toLowerCase();
  if (status === 'closed') return 100;
  if (status === 'delivered') return 90;
  if (status === 'dispatched' || status === 'in_transit' || status === 'intransit') return 70;
  if (approval === 'approved') return 40;
  if (approval === 'pending') return 20;
  return 10;
}

export function dispatchWorkflowState(row: any): 'pending' | 'approved' | 'in_transit' | 'delivered' | 'closed' {
  const status = String(row.status || '').toLowerCase();
  const approval = String(row.approvalStatus || '').toLowerCase();
  if (status === 'closed') return 'closed';
  if (status === 'delivered') return 'delivered';
  if (status === 'dispatched' || status === 'in_transit' || status === 'intransit') return 'in_transit';
  if (approval === 'approved') return 'approved';
  return 'pending';
}

export function workflowMatchesKpi(row: any, kpi: string): boolean {
  const status = String(row.status || '').toLowerCase();
  const approval = String(row.approvalStatus || '').toLowerCase();
  switch (kpi) {
    case '':
    case 'total':
      return true;
    case 'pending':
      return approval === 'pending';
    case 'verified':
      return approval === 'approved' && !['dispatched', 'in_transit', 'intransit', 'delivered', 'closed'].includes(status);
    case 'executed':
      return ['dispatched', 'in_transit', 'intransit'].includes(status);
    case 'completed':
      return status === 'delivered';
    case 'closed':
      return status === 'closed';
    default:
      return true;
  }
}

export function statusMatches(row: any, value: string): boolean {
  if (!value) return true;
  const status = String(row.status || row.approvalStatus || '').toLowerCase();
  return status === value.toLowerCase();
}

export function openTargetMatches(row: any, value: string, normalizer: (row: any) => string): boolean {
  if (!value) return true;
  return normalizeText(normalizer(row)) === normalizeText(value);
}

export function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
}

export function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportDispatchCsv(rows: any[]) {
  const headers = ['Dispatch No', 'Customer', 'Order No', 'Type', 'Warehouse', 'Assigned', 'Approval Status', 'Status', 'Date', 'Vehicle', 'Driver', 'LR', 'Priority'];
  const lines = rows.map((row) => [
    dispatchDisplayNumber(row),
    dispatchCustomer(row),
    orderDisplayNumber(row),
    dispatchType(row),
    dispatchWarehouse(row),
    dispatchAssigned(row),
    row.approvalStatus || '',
    row.status || '',
    row.date || row.createdAt || '',
    row.vehicleNo || '',
    row.driverName || '',
    row.lrNumber || '',
    dispatchPriority(row),
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
  downloadTextFile(`dispatch-${new Date().toISOString().slice(0, 10)}.csv`, ['\uFEFF' + headers.join(','), ...lines].join('\r\n'));
}

export function dispatchErrorMessage(error: any) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) return 'Permission denied';
  if (lower.includes('invalid otp')) return 'Invalid OTP';
  if (lower.includes('already consumed')) return 'OTP already used';
  if (lower.includes('delivered or closed') || lower.includes('already closed')) return 'Dispatch already delivered';
  if (lower.includes('active company')) return 'Company missing';
  return message || 'Dispatch update failed';
}
