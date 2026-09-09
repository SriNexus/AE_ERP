/**
 * Server-side permission checker
 *
 * Mirrors the client-side permission logic in src/lib/permissions.ts
 * for server-side enforcement. Reads role documents from Firestore.
 */

import { getAdminDb } from './firebase.js';
import type { AuthenticatedUser } from './auth.js';
import { isApiGroupAdmin } from './registry.js';

// Per-company system-role document id — `{companyId}_{RoleName}`, the exact
// deterministic scheme `roleDocumentId()` in `src/lib/roleBootstrap.ts` and the
// role-seeding code use. Inlined here (rather than imported) so this server
// module stays free of the client `src/lib/*` import graph (`roleBootstrap`
// pulls in `src/lib/permissions` → `src/store/useAppStore` → …), keeping the
// Vercel function bundle small and Node-safe (BRAIN.md §21).
const roleDocumentId = (companyId: string, roleName: string): string =>
  `${companyId}_${roleName}`;

// ── Permission types (mirrors client-side) ────────────────────

// RBAC Phase 6 (AUTH-D7): 'disburse' exists on the client Permission type
// (src/lib/permissions.ts, used for Accounts' payout-disbursement grant)
// but was missing here — a server-side canDo(user,'disburse',...) call
// always failed isPermission() and returned false regardless of role.
// Additive only: no ENTITY_REGISTRY entry exposes 'payouts' over the REST
// API yet (confirmed unchanged since Phase 1), so this changes no current
// request's outcome.
export type Permission = 'view' | 'create' | 'edit' | 'delete' | 'cancel' | 'approve' | 'disburse' | 'export' | 'import' | 'view_pricing';
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

const ALL_PERMISSIONS: Permission[] = ['view', 'create', 'edit', 'delete', 'cancel', 'approve', 'disburse', 'export', 'import', 'view_pricing'];
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
 * Fetch the CALLER'S OWN company's role document by deterministic id.
 *
 * RBAC Phase 6 (AUTH-D1): the previous implementation queried
 * `where('name', '==', roleName.trim().toLowerCase())` — every seeded role
 * is stored with a CAPITALIZED `name` (e.g. 'Sales'), so this primary query
 * always returned empty, on every single request, for every role. The
 * "fallback" it fell through to on every miss — an unscoped
 * `db.collection('roles').get()` reading every role document across every
 * company, matched case-insensitively, first-match-wins with no guaranteed
 * order — was therefore not an edge case: it was the only code path that
 * had ever executed, and it could resolve a DIFFERENT company's
 * same-named role document (e.g. Company A's customized "Sales" grants
 * evaluating a Company B caller's request).
 *
 * Fixed by using the exact same deterministic id scheme the client and the
 * role-seeding code already use (`roleDocumentId`, `src/lib/roleBootstrap.ts`
 * — `{companyId}_{RoleName}`) for a single, direct `.doc(id).get()`. This
 * is O(1), requires no scan of any kind, and is scoped by construction to
 * the company the CALLER authenticated as — never a client-supplied value,
 * since `companyId` comes from `AuthenticatedUser` (resolved server-side
 * from the verified token/mapping, see api/_lib/auth.ts). A missing role
 * document (including an unknown/malformed companyId) fails closed —
 * `snap.exists` is false, this returns null, and canDo() below already
 * treats a null role document as `false`.
 */
async function getRoleDocument(companyId: string, roleName: string): Promise<RoleDocument | null> {
  try {
    const db = getAdminDb();
    const docId = roleDocumentId(companyId, roleName);
    const snap = await db.collection('roles').doc(docId).get();
    if (!snap.exists) return null;
    return snap.data() as RoleDocument;
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
 * RBAC Master Plan §5.2 — which company's role document authorizes THIS
 * request. A GroupAdmin is a SCOPE extension whose grants are the TARGET
 * company's own Admin role document, not their home company's — so a
 * GroupAdmin creating/editing/deleting in a legitimate same-group sibling
 * company must be gated by that sibling's role template, exactly as the
 * client already does (companyScopedQuery re-fetches the focused company's
 * role docs, resolveActiveRoleDocument picks from those).
 *
 * The handlers group-vet the effective target BEFORE calling canDo()/
 * requirePermission():
 *   - api/[entity].ts handleCreate -> resolveApiCreateTenant() (throws
 *     ApiTenantScopeError for an out-of-group company; returns an in-group
 *     companyId otherwise),
 *   - api/[entity]/[id].ts handlers -> canAccessApiResource() on the fetched
 *     document (true only for own-company OR a doc whose groupId == the
 *     GroupAdmin's group).
 * So a non-home `targetCompanyId` reaching here for a GroupAdmin is already
 * proven in-group. For every other role the only legitimate target is their
 * own company (the scope layer 404s a cross-company id first), so a stray
 * non-home value is ignored — never a widening.
 */
function permissionCompanyId(user: AuthenticatedUser, targetCompanyId?: string): string {
  const home = String(user.companyId || '');
  const target = String(targetCompanyId || '').trim();
  if (!target || target === home) return home;
  return isApiGroupAdmin(user) ? target : home;
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
  targetCompanyId?: string,
): Promise<boolean> {
  // Super-admin bypass
  if (user.isSuperAdmin) return true;

  if (!isPermission(action)) return false;
  if (!isModule(module)) return false;

  // RBAC Phase 6 (AUTH-D1): fail closed on a missing companyId rather than
  // let getRoleDocument build a malformed doc id — every real
  // AuthenticatedUser has one (api/_lib/auth.ts's validateProfile requires
  // it), so this only guards a genuinely broken/forged identity.
  if (!user.companyId) return false;

  const resolvedRole = resolveCompatibleRole(user.role);
  if (!resolvedRole) return false;

  // RBAC Master Plan §5.2: for a GroupAdmin acting on a same-group sibling
  // company, resolve THAT company's Admin template (see permissionCompanyId).
  const companyForRole = permissionCompanyId(user, targetCompanyId);
  if (!companyForRole) return false;

  const roleDoc = await getRoleDocument(companyForRole, resolvedRole);
  if (!roleDoc) return false;

  const modulePermissions = roleDoc.permissions[module];
  if (!modulePermissions) return false;

  return modulePermissions[action] === true;
}

/**
 * RBAC Master Plan Phase 10 (N1 / AUTH-C1) — resolve the caller's EFFECTIVE
 * record-visibility for a module, from the trusted per-company role document
 * (never a client-supplied value). Mirrors `src/lib/firestore.ts`'s
 * `resolveVisibility()` and `src/lib/permissions.ts`'s `getModuleVisibility()`:
 *
 *   - Super Admin / Owner            → 'all'
 *   - Admin / GroupAdmin (alias-resolved to 'Admin') → 'all' (§5.2:
 *     GroupAdmin is an Admin-equivalent scope extension; the API already
 *     hard-scopes a GroupAdmin list by `where('groupId','==',...)`)
 *   - otherwise → the role document's `permissions[module].visibility`,
 *     normalized so only an explicit 'self'/'team' returns non-'all'
 *
 * Returns 'all' on any resolution failure (unknown role, missing companyId,
 * missing role doc, missing module) — `canDo()`/`requirePermission()` already
 * fail closed on those, so this defensive default only ever runs after the
 * caller has proven they may 'view' the module at all.
 *
 * Only the seed's `self`/`team` roles on a module produce ownership filtering:
 * today, per BD-1/BD-2 (both RESOLVED (a)), that is Partner ('self') and
 * Manager/TL ('team') on `leads`/`customers` only.
 */
export async function resolveEffectiveVisibility(
  user: AuthenticatedUser,
  module: Module | string,
): Promise<Visibility> {
  if (user.isSuperAdmin) return 'all';
  const resolvedRole = resolveCompatibleRole(user.role);
  if (!resolvedRole || resolvedRole === 'Admin') return 'all';
  if (!user.companyId) return 'all';
  const roleDoc = await getRoleDocument(user.companyId, resolvedRole);
  const modulePermissions = roleDoc?.permissions?.[String(module)];
  const visibility = modulePermissions && typeof modulePermissions.visibility === 'string'
    ? modulePermissions.visibility
    : 'all';
  return visibility === 'self' || visibility === 'team' ? visibility : 'all';
}

/**
 * Server-side permission check for API endpoints.
 * Throws an error object that the handler can use.
 */
export async function requirePermission(
  user: AuthenticatedUser,
  action: Permission | string,
  module: Module | string,
  targetCompanyId?: string,
): Promise<void> {
  const allowed = await canDo(user, action, module, targetCompanyId);
  if (!allowed) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    (err as any).code = 'FORBIDDEN';
    throw err;
  }
}
