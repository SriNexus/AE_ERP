/**
 * Server-side permission checker
 *
 * Mirrors the client-side permission logic in src/lib/permissions.ts
 * for server-side enforcement. Reads role documents from Firestore.
 */

import { getAdminDb } from './firebase';
import type { AuthenticatedUser } from './auth';

// ── Permission types (mirrors client-side) ────────────────────

export type Permission = 'view' | 'create' | 'edit' | 'delete' | 'cancel' | 'approve' | 'export' | 'import' | 'view_pricing';
export type Visibility = 'all' | 'team' | 'self';

export type Module =
  | 'dashboard' | 'projects' | 'leads' | 'customers' | 'quotations' | 'orders' | 'dispatch'
  | 'surveys' | 'engineering' | 'installations' | 'qc' | 'commissioning' | 'net_metering' | 'subsidy' | 'service_tickets'
  | 'inventory' | 'stock' | 'products' | 'payments' | 'invoices' | 'employees'
  | 'users' | 'roles' | 'reports' | 'categories' | 'warehouses' | 'attendance'
  | 'payroll' | 'companies' | 'settings'
  | 'partners' | 'tax_invoices' | 'vendors' | 'purchase_orders'
  // RBAC Phase 1 (AUTH-D6): these 5 keys exist on the client Module type
  // (src/lib/permissions.ts) but were missing here, so a server-side
  // canDo()/requirePermission() call against any of them always failed
  // isModule() and returned false regardless of role. No ENTITY_REGISTRY
  // entry exposes them over the REST API yet, so this is purely additive —
  // it changes no current request's outcome.
  | 'cases'
  | 'loan_applications'
  | 'banks'
  | 'payouts'
  | 'scheme_registration';

// ── Role cache (in-memory, refreshed per request) ─────────────

interface RoleDocument {
  name: string;
  schemaVersion: number;
  permissions: Record<string, Record<string, boolean | string> | undefined>;
}

const ALL_PERMISSIONS: Permission[] = ['view', 'create', 'edit', 'delete', 'cancel', 'approve', 'export', 'import', 'view_pricing'];
const ALL_MODULES: Module[] = [
  'dashboard', 'projects', 'leads', 'customers', 'quotations', 'orders', 'dispatch',
  'surveys', 'engineering', 'installations', 'qc', 'commissioning', 'net_metering', 'subsidy', 'service_tickets',
  'inventory', 'stock', 'products', 'payments', 'invoices', 'employees',
  'users', 'roles', 'reports', 'categories', 'warehouses', 'attendance',
  'payroll', 'companies', 'settings',
  'partners', 'tax_invoices', 'vendors', 'purchase_orders',
  // AUTH-D6 — see the Module type above for why these were added.
  'cases', 'loan_applications', 'banks', 'payouts', 'scheme_registration',
];

function isModule(value: string): value is Module {
  return ALL_MODULES.includes(value as Module);
}

function isPermission(value: string): value is Permission {
  return ALL_PERMISSIONS.includes(value as Permission);
}

/**
 * Fetch a role document from Firestore by role name.
 */
async function getRoleDocument(roleName: string): Promise<RoleDocument | null> {
  try {
    const db = getAdminDb();
    const normalizedKey = roleName.trim().toLowerCase();
    const snap = await db.collection('roles')
      .where('name', '==', normalizedKey)
      .limit(1)
      .get();

    if (snap.empty) {
      // Try case-insensitive match
      const allDocs = await db.collection('roles').get();
      const matched = allDocs.docs.find((d) => d.data().name?.toLowerCase() === normalizedKey);
      if (!matched) return null;
      return matched.data() as RoleDocument;
    }

    return snap.docs[0].data() as RoleDocument;
  } catch {
    return null;
  }
}

const EXACT_ROLE_COMPATIBILITY: Record<string, string> = {
  admin: 'Admin',
  // RBAC Phase 1 (AUTH-D4): GroupAdmin was missing from this table entirely,
  // so resolveCompatibleRole('GroupAdmin') returned null and every /api/*
  // request from a GroupAdmin 403'd regardless of module/action — a false
  // DENY, not an intentional restriction (the client's EXACT_ROLE_COMPATIBILITY
  // in src/lib/permissions.ts has always mapped it to 'Admin': GroupAdmin is a
  // SCOPE extension, not a distinct permission set — its grants are the target
  // company's own Admin role document). Mirroring that single mapping here
  // does not grant anything new: it only lets the SAME per-company Admin
  // template GroupAdmin already receives everywhere else (UI, Firestore
  // rules) also resolve on this server-side path. It does not touch company
  // or group scoping — the API's tenant boundary (resolveApiCompanyScope /
  // canAccessApiResource in api/_lib/registry.ts, and the .where('companyId',
  // ...) query in api/[entity].ts) is untouched by this file and still
  // confines every request — GroupAdmin included — to its own companyId.
  groupadmin: 'Admin',
  director: 'Director',
  sales: 'Sales',
  accounts: 'Accounts',
  warehouse: 'Warehouse',
  hr: 'HR',
  operations: 'Operations',
  partner: 'Partner',
  manager: 'Manager',
  // RBAC Phase 1 (AUTH-D4): 'TL' is the legacy alias for the Manager/TL layer
  // on the client (src/lib/permissions.ts) — added here for the same reason
  // as groupadmin above: a stored role of exactly 'TL' otherwise resolves to
  // nothing server-side and 403s on every API call.
  tl: 'Manager',
  management: 'Admin',
  'sales executive': 'Sales',
  bdm: 'Sales',
  bde: 'Sales',
  acc: 'Acc',
  // RBAC Phase 1 (AUTH-D4): demo-environment aliases, present on the client
  // table but missing here — same false-DENY pattern as groupadmin/tl.
  'demo operator': 'Admin',
  'demo admin': 'Admin',
};

/**
 * Resolve a user's role name to a canonical role document.
 */
function resolveCompatibleRole(rawRole: string): string | null {
  const key = rawRole.trim().toLowerCase();
  return EXACT_ROLE_COMPATIBILITY[key] ?? null;
}

/**
 * Server-side canDo check.
 *
 * Mirrors the client-side canDo() but reads role documents from
 * Firestore directly (no Zustand cache).
 */
export async function canDo(
  user: AuthenticatedUser,
  action: Permission | string,
  module: Module | string,
): Promise<boolean> {
  // Super-admin bypass
  if (user.isSuperAdmin) return true;

  if (!isPermission(action)) return false;
  if (!isModule(module)) return false;

  const resolvedRole = resolveCompatibleRole(user.role);
  if (!resolvedRole) return false;

  const roleDoc = await getRoleDocument(resolvedRole);
  if (!roleDoc) return false;

  const modulePermissions = roleDoc.permissions[module];
  if (!modulePermissions) return false;

  return modulePermissions[action] === true;
}

/**
 * Server-side permission check for API endpoints.
 * Throws an error object that the handler can use.
 */
export async function requirePermission(
  user: AuthenticatedUser,
  action: Permission | string,
  module: Module | string,
): Promise<void> {
  const allowed = await canDo(user, action, module);
  if (!allowed) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    (err as any).code = 'FORBIDDEN';
    throw err;
  }
}
