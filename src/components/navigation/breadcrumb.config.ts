// ═══════════════════════════════════════════════════════════
//  BREADCRUMB CONFIG
//  Centralized route → label mapping for the ERP.
//  Add new routes here; Breadcrumbs.tsx reads this automatically.
// ═══════════════════════════════════════════════════════════

export interface BreadcrumbEntry {
  /** Display label shown in the breadcrumb */
  label: string;
  /** Parent section (used for grouping in future multi-level breadcrumbs) */
  section?: string;
}

export const BREADCRUMB_CONFIG: Record<string, BreadcrumbEntry> = {
  // ── Core ──────────────────────────────────────────────────
  '/':             { label: 'Home',       section: 'main' },
  '/dashboards':   { label: 'Dashboards', section: 'main' },
  '/tasks':        { label: 'Tasks',      section: 'main' },

  // ── Sales ─────────────────────────────────────────────────
  '/leads':        { label: 'Leads',      section: 'Sales' },
  '/customers':    { label: 'Customers',  section: 'Sales' },
  '/projects':     { label: 'Projects',   section: 'Sales' },
  '/quotations':   { label: 'Quotations', section: 'Sales' },
  '/orders':       { label: 'Orders',     section: 'Sales' },
  '/invoices':     { label: 'Invoices',   section: 'Sales' },

  // ── Field Operations ─────────────────────────────────────
  '/surveys':      { label: 'Surveys', section: 'Field Operations' },
  '/engineering-designs': { label: 'Engineering Designs', section: 'Field Operations' },

  // ── Inventory ─────────────────────────────────────────────
  '/products':     { label: 'Products',   section: 'Inventory' },
  '/categories':   { label: 'Categories', section: 'Inventory' },
  '/warehouses':   { label: 'Warehouses', section: 'Inventory' },
  '/stock':        { label: 'Stock',      section: 'Inventory' },
  '/dispatch':     { label: 'Dispatch',   section: 'Inventory' },

  // ── Accounts ──────────────────────────────────────────────
  '/payments':     { label: 'Payments',   section: 'Accounts' },
  '/tax-invoices': { label: 'Tax Invoices', section: 'Accounts' },
  '/reports':      { label: 'Reports',    section: 'Accounts' },
  '/notifications': { label: 'Notifications', section: 'Accounts' },

  // ── HR ────────────────────────────────────────────────────
  '/employees':    { label: 'Employees',  section: 'HR' },
  '/attendance':   { label: 'Attendance', section: 'HR' },
  '/payroll':      { label: 'Payroll',    section: 'HR' },

  // ── Settings ──────────────────────────────────────────────
  '/users':        { label: 'Users',      section: 'Settings' },
  '/roles':        { label: 'Roles',      section: 'Settings' },
  '/companies':    { label: 'Companies',  section: 'Settings' },
  '/settings':     { label: 'Settings',   section: 'Settings' },
};

/** Resolve a pathname to a BreadcrumbEntry (fallback to capitalised path segment) */
export function resolveBreadcrumb(pathname: string): BreadcrumbEntry {
  if (BREADCRUMB_CONFIG[pathname]) return BREADCRUMB_CONFIG[pathname];

  // Dynamic segment fallback (e.g. /orders/ORD-001 → 'Orders')
  const base = '/' + pathname.split('/')[1];
  if (BREADCRUMB_CONFIG[base]) {
    return {
      label: BREADCRUMB_CONFIG[base].label,
      section: BREADCRUMB_CONFIG[base].section,
    };
  }

  const segment = pathname.replace('/', '').split('/')[0];
  return {
    label: segment
      ? segment.charAt(0).toUpperCase() + segment.slice(1)
      : 'Dashboard',
  };
}
