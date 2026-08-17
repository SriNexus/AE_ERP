// ═══════════════════════════════════════════════════════════
//  DATE FILTER ENGINE — reusable across all modules
// ═══════════════════════════════════════════════════════════

export type DateRange = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'custom' | 'all';

/** Type guard for arbitrary filter-state strings (e.g. '' meaning "all") —
 * pages keep `dateF` as a plain string so clearing the filter works, then
 * narrow to DateRange at the isInDateRange boundary without a raw cast. */
export function isDateRangeValue(value: string): value is DateRange {
  return value === 'all' || value === 'today' || value === 'yesterday'
    || value === 'this_week' || value === 'this_month' || value === 'this_year' || value === 'custom';
}

export const DATE_RANGE_OPTIONS = [
  { label: 'All Time',    value: 'all' },
  { label: 'Today',       value: 'today' },
  { label: 'Yesterday',   value: 'yesterday' },
  { label: 'This Week',   value: 'this_week' },
  { label: 'This Month',  value: 'this_month' },
  { label: 'This Year',   value: 'this_year' },
  { label: 'Custom',      value: 'custom' },
] as const;

export function getDateRangeBounds(range: DateRange, customFrom?: string, customTo?: string): { from: Date; to: Date } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

  switch (range) {
    case 'all': return null;
    case 'today':
      return { from: today, to: tomorrow };
    case 'yesterday': {
      const yest = new Date(today); yest.setDate(today.getDate() - 1);
      return { from: yest, to: today };
    }
    case 'this_week': {
      const dow = today.getDay();
      const mon = new Date(today); mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
      return { from: mon, to: tomorrow };
    }
    case 'this_month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: first, to: tomorrow };
    }
    case 'this_year': {
      const first = new Date(now.getFullYear(), 0, 1);
      return { from: first, to: tomorrow };
    }
    case 'custom': {
      if (!customFrom && !customTo) return null;
      const from = customFrom ? new Date(customFrom) : new Date(0);
      const to   = customTo   ? new Date(new Date(customTo).setDate(new Date(customTo).getDate() + 1)) : tomorrow;
      return { from, to };
    }
    default: return null;
  }
}

export function isInDateRange(
  dateStr: string | null | undefined,
  range: DateRange,
  customFrom?: string,
  customTo?: string
): boolean {
  if (!dateStr) return range === 'all';
  const bounds = getDateRangeBounds(range, customFrom, customTo);
  if (!bounds) return true;
  const d = new Date(dateStr);
  return d >= bounds.from && d < bounds.to;
}

export function countInRange(items: any[], dateField: string, range: DateRange): number {
  return items.filter(i => isInDateRange(i[dateField], range)).length;
}

export function sumInRange(items: any[], dateField: string, valueField: string, range: DateRange): number {
  return items.filter(i => isInDateRange(i[dateField], range)).reduce((s, i) => s + (Number(i[valueField]) || 0), 0);
}
