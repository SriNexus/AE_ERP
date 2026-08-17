// ═══════════════════════════════════════════════════════════
//  CONSTANTS — ERP SaaS
//  Single source of truth for app-wide constants.
//  Domain-specific config lives in config/company.ts
// ═══════════════════════════════════════════════════════════

// Re-export config constants so features can import from one place
export {
  LEAD_SOURCES, LEAD_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES,
  DISPATCH_STATUSES, UNITS, PAYMENT_MODES, INDIAN_STATES, ERP_ROLES,
} from '../config/company';
export type { CompanyConfig, ERPRole } from '../config/company';

// ── Pagination ─────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE  = 15;
export const PAGE_SIZE_OPTIONS  = [10, 15, 25, 50, 100] as const;

// ── Query cache ────────────────────────────────────────────
export const STALE_5M  = 1000 * 60 * 5;
export const STALE_30M = 1000 * 60 * 30;
export const STALE_1H  = 1000 * 60 * 60;
export const GC_30M    = 1000 * 60 * 30;

// ── Date range options ─────────────────────────────────────
export const DATE_RANGE_OPTIONS = [
  { label: 'All Time',   value: 'all' },
  { label: 'Today',      value: 'today' },
  { label: 'Yesterday',  value: 'yesterday' },
  { label: 'This Week',  value: 'this_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'This Year',  value: 'this_year' },
  { label: 'Custom',     value: 'custom' },
] as const;
