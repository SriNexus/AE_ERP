import { useAppStore } from '../store/useAppStore';
import type { UserRole } from '../types';
import { canAccessProjectRecord, getProjectVisibilityMode, type ProjectVisibilityRecord } from './projectVisibility';
import { isOfficialDemoCompany } from '../config/demo';

export type Permission = 'view' | 'create' | 'edit' | 'delete' | 'cancel' | 'approve' | 'disburse' | 'export' | 'import' | 'view_pricing';
export type Module =
  | 'dashboard' | 'projects' | 'leads' | 'customers' | 'quotations' | 'orders' | 'dispatch'
  | 'surveys' | 'engineering' | 'installations' | 'qc' | 'commissioning' | 'net_metering' | 'subsidy' | 'service_tickets'
  | 'inventory' | 'stock' | 'products' | 'payments' | 'invoices' | 'employees'
  | 'users' | 'roles' | 'reports' | 'categories' | 'warehouses' | 'attendance'
  | 'payroll' | 'companies' | 'settings'
  | 'partners' | 'tax_invoices' | 'vendors' | 'purchase_orders'
  | 'cases'
  | 'loan_applications'
  | 'banks'
  // Phase 0 (Channel Partner): module names reserved for the payout-request
  // queue and the Registration (Vendor Lock / Portal Registration) stage.
  // Action sets (payouts: view/create/approve/disburse/edit/export;
  // scheme_registration: view/create/edit/approve/delete) are seeded in Phase 2.
  | 'payouts'
  | 'scheme_registration';
export type Visibility = 'all' | 'team' | 'self';
export type VisibilityScope = {
  userId?: string | null;
  record: ProjectVisibilityRecord;
};

export type ModulePermissionMap = { [K in Permission]: boolean } & { visibility: Visibility };
export type FirestoreRoleDocument = {
  id?: string;
  name: string;
  schemaVersion: 1;
  description?: string;
  /** Data-driven section/department this role belongs to (e.g. 'Sales', 'Warehouse', 'Channel Partner'). */
  department?: string;
  /** Managerial responsibility within the role's section (NOT a global manager). */
  isManager?: boolean;
  /** System-defined role: protected from modification/deletion by non-super-admins. */
  isSystem?: boolean;
  permissions: Partial<Record<Module, Partial<ModulePermissionMap>>>;
};

export const ALL_MODULES: Module[] = [
  'dashboard', 'projects', 'leads', 'customers', 'quotations', 'orders', 'dispatch',
  'surveys', 'engineering', 'installations', 'qc', 'commissioning', 'net_metering', 'subsidy', 'service_tickets',
  'inventory', 'stock', 'products', 'payments', 'invoices', 'employees',
  'users', 'roles', 'reports', 'categories', 'warehouses', 'attendance',
  'payroll', 'companies', 'settings',
  'partners', 'tax_invoices', 'vendors', 'purchase_orders',
  'cases',
  'loan_applications',
  'banks',
  // Phase 0 (Channel Partner) — reserved module names; role seeds in Phase 2.
  'payouts',
  'scheme_registration',
];

const ALL_PERMISSIONS: Permission[] = ['view', 'create', 'edit', 'delete', 'cancel', 'approve', 'disburse', 'export', 'import', 'view_pricing'];

const EXACT_ROLE_COMPATIBILITY: Record<string, string> = {
  admin: 'Admin',
  director: 'Director',
  sales: 'Sales',
  accounts: 'Accounts',
  warehouse: 'Warehouse',
  hr: 'HR',
  operations: 'Operations',
  partner: 'Partner',
  manager: 'Manager',
  // Phase 2 (G7 fix, LOCKED per the Channel Partner spec §8): `TL` is the
  // legacy alias for the single Manager/TL layer — Manager is the canonical
  // role doc (isManager:true, department 'Management'); a distinct TL role
  // doc is created only if the business later defines distinct TL duties.
  // Without this alias a user with role 'TL' resolved to unknown-role and
  // every canDo() returned false (RoleRoute redirect loops).
  tl: 'Manager',
  management: 'Admin',
  'sales executive': 'Sales',
  bdm: 'Sales',
  bde: 'Sales',
  acc: 'Acc',
  'demo operator': 'Admin',
  'demo admin': 'Admin',
};

// GAP-02 remediation (independent Vendor Lock audit, 2026-08-14): the loan
// module's RBAC permission key was renamed from `registrations` to
// `loan_applications` (a pre-existing, unrelated rebrand), but the Vendor
// Lock spec's Tier C mandate requires the loan module's persisted contracts
// — including its permission key — to be retained unchanged for existing
// companies. A company's persisted role document created before the rebrand
// may still carry only `permissions.registrations`; without this alias,
// `canDo()`/`getModuleVisibility()` would silently deny every loan-module
// action for that role until a (partial, Admin-gated) migration runs in
// useGlobalBoot.ts. This is a read-time compatibility fallback only — it
// never writes to Firestore and never migrates data. Do NOT add entries here
// for `scheme_registration` — Vendor Lock has no legacy key to alias.
const LEGACY_MODULE_READ_ALIASES: Partial<Record<Module, string>> = {
  loan_applications: 'registrations',
};

function resolveModulePermissions(
  permissions: FirestoreRoleDocument['permissions'],
  module: Module,
): Partial<ModulePermissionMap> | undefined {
  const direct = permissions[module];
  if (direct) return direct;
  const legacyKey = LEGACY_MODULE_READ_ALIASES[module];
  if (!legacyKey) return undefined;
  return (permissions as Record<string, Partial<ModulePermissionMap> | undefined>)[legacyKey];
}

const loggedDiagnostics = new Set<string>();

function diagnostic(key: string, detail: string) {
  const message = `[permissions] ${key}: ${detail}`;
  if (loggedDiagnostics.has(message)) return;
  loggedDiagnostics.add(message);
  // Only log to console for non-demo diagnostic types — missing-role-document is
  // expected in demo environments and should not produce console output.
  if (key !== 'missing-role-document') {
    console.warn(message);
  }
}

function normalizedKey(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function resolveCompatibleRole(role?: string | UserRole | null): string | null {
  const key = normalizedKey(role);
  if (!key) return null;
  const cache = useAppStore.getState().permissionCache;
  if (cache.ready) {
    const cachedRole = cache.roles[key];
    if (cachedRole && isRoleDocument(cachedRole)) {
      return cachedRole.name;
    }
  }
  return EXACT_ROLE_COMPATIBILITY[key] ?? null;
}

function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && ALL_PERMISSIONS.includes(value as Permission);
}

function isModule(value: unknown): value is Module {
  return typeof value === 'string' && ALL_MODULES.includes(value as Module);
}

function isRoleDocument(value: unknown): value is FirestoreRoleDocument {
  if (!value || typeof value !== 'object') return false;
  const role = value as FirestoreRoleDocument;
  return typeof role.name === 'string' && role.schemaVersion === 1 && Boolean(role.permissions) && typeof role.permissions === 'object';
}

function getCachedRole(roleName: string) {
  const cache = useAppStore.getState().permissionCache;
  if (!cache.ready) {
    diagnostic('cache-not-ready', `role=${roleName}`);
    return null;
  }

  const role = cache.roles[normalizedKey(roleName)];
  if (!role) {
    // Fallback: provide full Admin permissions when role document is missing
    // ONLY for the demo company — never grant full access to production tenants.
    const state = useAppStore.getState();
    const companyId = state.user?.companyId || state.activeCompanyId;
    if (isOfficialDemoCompany(companyId)) {
      return {
        name: roleName,
        schemaVersion: 1 as const,
        description: 'Demo fallback role definition',
        permissions: ALL_MODULES.reduce((acc, module) => {
          acc[module] = {
            view: true, create: true, edit: true, delete: true,
            cancel: true, approve: true, disburse: true, export: true, import: true,
            view_pricing: true,
            visibility: 'all' as const,
          };
          return acc;
        }, {} as Record<string, any>),
      } as FirestoreRoleDocument;
    }
    return null;
  }

  if (!isRoleDocument(role)) {
    diagnostic('malformed-role-document', `role=${roleName}`);
    return null;
  }

  return role;
}

export function canDo(action: Permission, module: Module, role?: UserRole | string, visibilityScope?: VisibilityScope): boolean;
export function canDo(module: Module, action: Permission, role?: UserRole | string, visibilityScope?: VisibilityScope): boolean;
export function canDo(first: Permission | Module, second: Permission | Module, role?: UserRole | string, visibilityScope?: VisibilityScope): boolean {
  const action = isPermission(first) && isModule(second) ? first : second as Permission;
  const module = isPermission(first) && isModule(second) ? second : first as Module;
  const state = useAppStore.getState();

  if (state.user?.isSuperAdmin === true) return true;

  if (!isPermission(action)) {
    diagnostic('unknown-action', `action=${String(action)}`);
    return false;
  }

  if (!isModule(module)) {
    diagnostic('unknown-module', `module=${String(module)}`);
    return false;
  }

  const rawRole = role ?? state.user?.role;
  const resolvedRole = resolveCompatibleRole(rawRole);
  if (!resolvedRole) {
    diagnostic('unknown-role', `role=${String(rawRole || '')}; key=${normalizedKey(rawRole)}`);
    return false;
  }

  const roleDocument = getCachedRole(resolvedRole);
  if (!roleDocument) return false;

  const modulePermissions = resolveModulePermissions(roleDocument.permissions, module);
  if (!modulePermissions) {
    // For demo companies, unknown modules default to full access
    // This handles modules added after the role documents were seeded in Firestore
    if (isOfficialDemoCompany(state.user?.companyId)) {
      return ALL_PERMISSIONS.includes(action as Permission);
    }
    diagnostic('missing-module-permission', `role=${resolvedRole}; module=${module}`);
    return false;
  }

  if (modulePermissions[action] !== true) return false;

  if (module === 'projects' && visibilityScope) {
    return canAccessProjectRecord(
      visibilityScope.record,
      visibilityScope.userId ?? state.user?.id,
      rawRole,
      roleDocument,
    );
  }

  return true;
}

/**
 * Phase 2 (G11 fix): whether a user may enter the Partner Portal (`/partner/*`).
 * The portal is a Partner-facing surface — it must NOT be open to every role
 * that happens to hold `partners:view` (Sales/Manager/Accounts/Warehouse).
 * Only the Partner role itself is admitted, plus super-admin oversight (the
 * codebase-wide administrative bypass). The resolved role is used so custom
 * role documents named like 'Partner' (permission-cache keys) also resolve.
 */
export function isPartnerPortalUser(role?: string | UserRole | null, isSuperAdmin?: boolean): boolean {
  if (isSuperAdmin === true) return true;
  const resolved = resolveCompatibleRole(role);
  return resolved === 'Partner';
}

export function getModuleVisibility(module: Module, role?: UserRole | string): Visibility {
  const state = useAppStore.getState();
  const rawRole = role ?? state.user?.role;
  const resolvedRole = resolveCompatibleRole(rawRole);
  if (!resolvedRole) {
    return 'all';
  }

  const roleDocument = getCachedRole(resolvedRole);
  if (module === 'projects') {
    return getProjectVisibilityMode(rawRole, roleDocument) === 'assigned' ? 'self' : 'all';
  }

  if (!roleDocument) {
    return 'all';
  }

  return resolveModulePermissions(roleDocument.permissions, module)?.visibility ?? 'all';
}

export function usePermissions() {
  const cacheReady = useAppStore((state) => state.permissionCache.ready);
  const cacheLoadedAt = useAppStore((state) => state.permissionCache.loadedAt);
  void cacheLoadedAt;
  const resolveWhenReady = (module: Module, action: Permission) => (cacheReady ? canDo(action, module) : false);
  return {
    ready: cacheReady,
    can: (module: Module, action: Permission) => resolveWhenReady(module, action),
    canView: (module: Module) => resolveWhenReady(module, 'view'),
    canCreate: (module: Module) => resolveWhenReady(module, 'create'),
    canEdit: (module: Module) => resolveWhenReady(module, 'edit'),
    canDelete: (module: Module) => resolveWhenReady(module, 'delete'),
    canCancel: (module: Module) => resolveWhenReady(module, 'cancel'),
    canExport: (module: Module) => resolveWhenReady(module, 'export'),
    canImport: (module: Module) => resolveWhenReady(module, 'import'),
    canApprove: (module: Module) => resolveWhenReady(module, 'approve'),
    canViewPricing: (module: Module) => resolveWhenReady(module, 'view_pricing'),
    getVisibility: (module: Module = 'projects'): Visibility => getModuleVisibility(module),
  };
}
