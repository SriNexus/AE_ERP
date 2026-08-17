/**
 * types.ts — Shared mobile-specific TypeScript types
 *
 * These types are for mobile-only concerns. Business entity types
 * are imported from src/types/index.ts as needed.
 */

/** The 5 bottom navigation tabs */
export type MobileTab = 'home' | 'tasks' | 'create' | 'recent' | 'settings';

/** Represents a module in the App tab's ModuleGrid */
export interface MobileModule {
  id: string;
  label: string;
  icon: string;
  route: string;
  group: 'sales' | 'field' | 'inventory' | 'finance' | 'hr' | 'productivity' | 'system';
}

/** Action type for recent activity tracking */
export type RecentActionType = 'viewed' | 'edited' | 'created' | 'generated' | 'visited';

/** Entry shape for sessionStorage recent tracking */
export interface RecentEntry {
  entityType: string;
  entityId: string;
  module: string;
  actionType: RecentActionType;
  label: string;
  route: string;
  timestamp: number;
}

/** Offline sync status */
export type SyncStatus = 'online' | 'offline' | 'syncing' | 'synced';

/** Breakpoint constant shared between mobile detection and CSS */
export const MOBILE_BREAKPOINT = 1024;

/** Mobile shell dimension constants */
export const MOBILE_SHELL = {
  TOPBAR_HEIGHT: 56,
  BOTTOM_NAV_HEIGHT: 64,
} as const;

/** App tab module route paths — routes that belong to the App workspace tab */
export const APP_MODULE_ROUTES = new Set([
  '/leads', '/customers', '/projects', '/quotations', '/orders', '/invoices',
  '/surveys', '/engineering-designs', '/installations',
  '/products', '/categories', '/warehouses', '/stock', '/dispatch',
  '/payments', '/reports',
  '/employees', '/attendance', '/payroll',
  '/tasks', '/users', '/roles', '/companies', '/performance',
  '/qc',
  '/commissioning',
  '/handovers',
  '/partners', '/commission-rules', '/commission-approvals', '/settlements',
  '/vendors', '/purchase-orders', '/goods-receipts',
  '/net-metering', '/subsidy', '/tax-invoices',
  '/amc-contracts', '/service-tickets', '/monitoring',
  '/cases',
  '/vendors/:id',
  '/purchase-orders/:id',
  '/goods-receipts/:id',
]);

/**
 * Module routes that are read-only — they don't support create actions.
 * When the BottomNav Create/FAB tab is pressed on these modules,
 * navigation stays on the records view instead of appending ?create=1.
 */
export const READ_ONLY_MODULES = new Set([
  '/performance',
  '/reports',
  // Commission approvals are workflow artifacts — no create action in Desktop
  '/commission-approvals',
]);
