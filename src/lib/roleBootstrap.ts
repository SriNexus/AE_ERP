import { ALL_MODULES, type FirestoreRoleDocument, type Module, type ModulePermissionMap, type Permission, type Visibility } from './permissions';

// Phase 2: 'disburse' added for the payouts module (Accounts disbursement
// executor). NOTE: 'cancel' is intentionally NOT here — it was never in this
// seed-builder list (legacy seeds that set cancel:true, e.g. Accounts
// tax_invoices, were deliberately filtered out); adding it would silently
// change non-Phase-2 behavior.
const ALL_PERMISSIONS: Permission[] = ['view', 'create', 'edit', 'delete', 'approve', 'disburse', 'export', 'import', 'view_pricing'];

const LEGACY_MODULE_ALIASES: Partial<Record<Module, Module>> = {
  stock: 'inventory',
  categories: 'inventory',
  warehouses: 'inventory',
  attendance: 'employees',
  payroll: 'employees',
  companies: 'roles',
  settings: 'roles',
  invoices: 'payments',
};

const SYSTEM_ROLE_NAMES = [
  'Admin',
  'Director',
  'Sales',
  'Accounts',
  'Warehouse',
  'HR',
  'Operations',
  'Partner',
  'Manager',
  'Surveyor',
  'Engineer',
  'InstallationLead',
  'ServiceTechnician',
  'ComplianceOfficer',
  'Procurement',
] as const;

/**
 * Data-driven section mapping for the system roles. A user's department is
 * the department of their role (new sections = new roles with a department).
 * 'Management' is the cross-section management layer (Admin/Director/Manager).
 */
export const SYSTEM_ROLE_DEPARTMENTS: Partial<Record<(typeof SYSTEM_ROLE_NAMES)[number], string>> = {
  Admin: 'Management',
  Director: 'Management',
  Manager: 'Management',
  Sales: 'Sales',
  Accounts: 'Accounts',
  Warehouse: 'Warehouse',
  HR: 'HR',
  Operations: 'Operations',
  Partner: 'Channel Partner',
  Surveyor: 'Engineering',
  Engineer: 'Engineering',
  InstallationLead: 'Installation',
  ServiceTechnician: 'Service',
  ComplianceOfficer: 'Compliance',
  Procurement: 'Procurement',
};

/** Managerial system roles (section managers / cross-section management). */
export const SYSTEM_MANAGER_ROLES: ReadonlySet<string> = new Set(['Manager']);

type LegacyRoleDefinition = {
  description: string;
  permissions: Partial<Record<Module, Partial<ModulePermissionMap>>>;
};

function createModulePermissions(allowed: Permission[] = [], visibility: Visibility = 'all'): ModulePermissionMap {
  return {
    view: allowed.includes('view'),
    create: allowed.includes('create'),
    edit: allowed.includes('edit'),
    delete: allowed.includes('delete'),
    cancel: allowed.includes('cancel'),
    approve: allowed.includes('approve'),
    disburse: allowed.includes('disburse'),
    export: allowed.includes('export'),
    import: allowed.includes('import'),
    view_pricing: allowed.includes('view_pricing'),
    visibility,
  };
}

function createAllModulePermissions(allowed: Permission[] = ALL_PERMISSIONS, visibility: Visibility = 'all') {
  return ALL_MODULES.reduce((acc, module) => {
    acc[module] = createModulePermissions(allowed, visibility);
    return acc;
  }, {} as Record<Module, ModulePermissionMap>);
}

function legacyModulePermissions(legacy: LegacyRoleDefinition['permissions']) {
  return ALL_MODULES.reduce((acc, module) => {
    const sourceModule = legacy[module] ? module : LEGACY_MODULE_ALIASES[module] ?? module;
    const sourcePermissions = legacy[sourceModule] ?? {};
    const allowed = ALL_PERMISSIONS.filter((permission) => sourcePermissions[permission] === true);
    const visibility = sourcePermissions.visibility === 'all' || sourcePermissions.visibility === 'team' || sourcePermissions.visibility === 'self'
      ? sourcePermissions.visibility
      : 'all';
    acc[module] = createModulePermissions(allowed, visibility);
    return acc;
  }, {} as Record<Module, ModulePermissionMap>);
}

const LEGACY_SYSTEM_ROLES: Record<(typeof SYSTEM_ROLE_NAMES)[number], LegacyRoleDefinition> = {
  Admin: {
    description: 'Full system access.',
    permissions: {},
  },
  Director: {
    description: 'Read-only executive visibility across core modules.',
    permissions: {
      dashboard: { view: true },
      leads: { view: true },
      customers: { view: true },
      quotations: { view: true },
      orders: { view: true },
      dispatch: { view: true, view_pricing: true },
      inventory: { view: true },
      stock: { view: true },
      products: { view: true },
      payments: { view: true },
      invoices: { view: true },
      employees: { view: true },
      users: { view: true },
      roles: { view: true },
      reports: { view: true },
      categories: { view: true },
      warehouses: { view: true },
      attendance: { view: true },
      payroll: { view: true },
      companies: { view: true },
      settings: { view: true },
      tax_invoices: { view: true },
      // Phase 16: 'loan_applications'/'banks' are real Module values with real,
      // already-shipped pages (LoanApplicationsWorkspace.tsx/BanksWorkspace.tsx)
      // that were simply never backfilled into any non-Admin role when they
      // were added — every legacy role fell through legacyModulePermissions()
      // to all-false, so only Admin could ever see either page. Added here
      // matching this role's own existing "view everything core" pattern.
      loan_applications: { view: true },
      banks: { view: true },
      // Phase 2 (§8.2 matrix 'Management' column): Director is the read-only
      // executive/Management layer — org-wide VIEW on the partner lifecycle
      // modules (projects/surveys/scheme_registration/payouts/partners) with
      // no create/edit. These were absent entirely before, so a Management
      // user could not even monitor the pipeline.
      projects: { view: true },
      surveys: { view: true },
      scheme_registration: { view: true },
      payouts: { view: true },
      partners: { view: true },
    },
  },
  Sales: {
    description: 'Sales pipeline and order creation access.',
    permissions: {
      dashboard: { view: true },
      leads: { view: true, create: true, edit: true },
      customers: { view: true, create: true, edit: true },
      quotations: { view: true, create: true, edit: true },
      orders: { view: true, create: true },
      dispatch: { view: true, create: true, view_pricing: true },
      inventory: { view: true },
      stock: { view: true },
      products: { view: true },
      // Phase 16: Loan Application (loan/financing) is filed as part of the same
      // customer journey Sales already owns (leads/customers/quotations) —
      // matching that existing view+create+edit tier, not a new policy.
      loan_applications: { view: true, create: true, edit: true },
      banks: { view: true },
    },
  },
  Accounts: {
    description: 'Billing, payment, and invoice processing access.',
    permissions: {
      dashboard: { view: true },
      leads: { view: true },
      customers: { view: true },
      quotations: { view: true },
      orders: { view: true, edit: true, approve: true },
      dispatch: { view: true, approve: true, view_pricing: true },
      payments: { view: true, create: true, edit: true, delete: true },
      invoices: { view: true, create: true, edit: true, delete: true },
      tax_invoices: { view: true, create: true, edit: true, cancel: true },
      reports: { view: true, export: true },
      // Phase 16: createPaymentFromLoanApplication() writes a real Payment
      // record directly from a Loan Application — Accounts, the role that owns
      // Payments, was the most obviously-missing role for this module.
      loan_applications: { view: true, edit: true, approve: true },
      banks: { view: true },
      // Phase 2 (§8.2 matrix 'Accounts' column): Accounts is the disbursement
      // executor — payouts view + disburse ONLY. It is deliberately NOT an
      // approver (approve stays with Manager/TL/Management) and does not get
      // partners view (commission rows are ❌ for Accounts).
      payouts: { view: true, disburse: true },
    },
  },
  Warehouse: {
    description: 'Inventory and dispatch handling access.',
    permissions: {
      dashboard: { view: true },
      orders: { view: true },
      // Phase 9: deliberately no view_pricing — Warehouse is the role that
      // physically loads/verifies a dispatch, and must not see selling price
      // while doing so (Blueprint §9's dispatch-loading price-visibility rule).
      dispatch: { view: true, edit: true, approve: true },
      inventory: { view: true, create: true, edit: true },
      stock: { view: true, create: true, edit: true },
      products: { view: true },
    },
  },
  HR: {
    description: 'Employee, attendance, and payroll access.',
    permissions: {
      dashboard: { view: true },
      employees: { view: true, create: true, edit: true, delete: true },
      attendance: { view: true, create: true, edit: true },
      payroll: { view: true },
    },
  },
  Operations: {
    description: 'Operational oversight across order fulfilment and inventory.',
    permissions: {
      dashboard: { view: true },
      leads: { view: true },
      customers: { view: true, edit: true },
      orders: { view: true, edit: true },
      dispatch: { view: true, edit: true, view_pricing: true },
      inventory: { view: true, edit: true },
      stock: { view: true, edit: true },
      products: { view: true, edit: true },
    },
  },
  Partner: {
    description: 'External partner portal access.',
    permissions: {
      dashboard: { view: true },
      // Phase 2 (G3 + §8.2 matrix): the Partner field agent operates at SELF
      // scope — own leads/customers/projects only. Previously the role had no
      // customers:create/projects/surveys permissions and defaulted to 'all'
      // visibility (agent saw every company record). Visibility is consumed by
      // resolveVisibility/applyAccessFilters (OWNERSHIP_FIELDS + the Phase 1
      // channel_partners userId key).
      leads: { view: true, create: true, visibility: 'self' },
      customers: { view: true, create: true, visibility: 'self' },
      projects: { view: true, create: true, visibility: 'self' },
      surveys: { view: true, edit: true, visibility: 'self' },
      // Phase 2: Vendor Lock (scheme_registration) is the partner's project
      // stage (own case) — view/create/edit; approve is Manager/TL.
      scheme_registration: { view: true, create: true, edit: true, visibility: 'self' },
      // Phase 2: own commission view + own payout request creation (§8.2).
      payouts: { view: true, create: true, visibility: 'self' },
      // self visibility engages the Phase 1 userId-keyed self-filter in
      // applyAccessFilters — a Partner-role user can only ever see THEIR OWN
      // channel_partners record, never the company-wide partner list.
      partners: { view: true, visibility: 'self' },
    },
  },
  Manager: {
    description: 'Sales and operations supervision access.',
    permissions: {
      dashboard: { view: true },
      // Phase 2 (G7 fix + §8.2 matrix): Manager is the TL/Manager layer and
      // operates at TEAM scope — own + assigned agents' records only, never
      // org-wide. Team members are resolved from users.managerId by
      // useGlobalBoot's teamMemberIds; the visibility value is consumed by
      // resolveVisibility/applyAccessFilters.
      leads: { view: true, create: true, edit: true, visibility: 'team' },
      customers: { view: true, create: true, edit: true, visibility: 'team' },
      // Phase 2: Manager lacked the `projects` module entirely (G7) — the
      // team can run the project lifecycle, so Manager supervises it at team
      // scope with create (matrix §8.2: Create project ✅).
      projects: { view: true, create: true, edit: true, visibility: 'team' },
      // Phase 2 (§8.2): Manager supervises team surveys and the Vendor Lock
      // stage — scheme_registration at team scope INCLUDING approve (TL/Manager
      // approves vendor locks); payouts at team scope INCLUDING approve (but
      // never disburse/create — those are Partner-request / Accounts-execute).
      surveys: { view: true, edit: true, visibility: 'team' },
      scheme_registration: { view: true, create: true, edit: true, approve: true, visibility: 'team' },
      payouts: { view: true, approve: true, visibility: 'team' },
      quotations: { view: true, create: true, edit: true },
      orders: { view: true, create: true, edit: true },
      dispatch: { view: true, create: true, edit: true, view_pricing: true },
      inventory: { view: true, create: true, edit: true },
      stock: { view: true, create: true, edit: true },
      products: { view: true, create: true, edit: true },
      partners: { view: true, create: true, edit: true },
      // Phase 16: same reasoning as Sales — Manager already supervises the
      // rest of the customer-lifecycle modules at this exact tier.
      loan_applications: { view: true, create: true, edit: true },
      banks: { view: true },
    },
  },
  Surveyor: {
    description: 'Field survey execution access.',
    permissions: {
      projects: { view: true, visibility: 'self' },
      surveys: { view: true, create: true, edit: true },
    },
  },
  Engineer: {
    description: 'Engineering design and survey review access.',
    permissions: {
      projects: { view: true, visibility: 'self' },
      surveys: { view: true, approve: true },
      engineering: { view: true, create: true, edit: true, approve: true },
    },
  },
  InstallationLead: {
    description: 'Installation execution and quality control access.',
    permissions: {
      projects: { view: true, visibility: 'self' },
      installations: { view: true, create: true, edit: true },
      qc: { view: true, create: true },
      commissioning: { view: true, create: true },
    },
  },
  ServiceTechnician: {
    description: 'Service ticket execution access.',
    permissions: {
      projects: { view: true, visibility: 'self' },
      service_tickets: { view: true, create: true, edit: true },
    },
  },
  ComplianceOfficer: {
    description: 'Compliance and application tracking access.',
    permissions: {
      projects: { view: true, visibility: 'self' },
      net_metering: { view: true, create: true, edit: true },
      subsidy: { view: true, create: true, edit: true },
    },
  },
  Procurement: {
    description: 'Vendor master data and procurement coordination access.',
    permissions: {
      dashboard: { view: true },
      projects: { view: true },
      vendors: { view: true, create: true, edit: true, delete: true },
      purchase_orders: { view: true, create: true, edit: true, approve: true },
      products: { view: true },
      stock: { view: true, create: true },
      warehouses: { view: true },
    },
  },
};

export function normalizeRoleName(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

/**
 * PHASE 1 (F-03 closure, Master Plan §5.6) — per-company role-document keying.
 *
 * Role documents are now Company-scoped: every role doc belongs to exactly one
 * company and carries that company's `companyId` field, and its deterministic
 * document id is `${companyId}_${roleName}` (mirroring the `group_members`
 * `${groupId}_${userId}` deterministic-id convention). This replaces the
 * pre-Phase-1 model where system role templates were keyed by role NAME alone
 * and SHARED across every company — the exact dependency that blocked F-03's
 * company-scoped read in Phase 0 (company-scoping a shared name-keyed doc
 * breaks role resolution → permission bootstrap fails closed → lockout).
 *
 * Custom roles created via the Roles UI keep their existing `ROL-*` generated
 * ids (they were never name-keyed and already carry `companyId`); only the
 * shared SYSTEM templates move to the keyed scheme, via the Phase 1 backfill
 * (`scripts/backfill-group-denorm.cjs`) and the boot self-heal path.
 */
export function roleDocumentId(companyId: string, roleName: string): string {
  return `${companyId}_${roleName}`;
}

/**
 * PHASE 1 (F-03 closure) — per-company system-role seed documents. Same seed
 * content as getSystemRoleSeedDocuments(), but keyed for one company:
 * `id = ${companyId}_${roleName}` with `companyId` stamped, so the
 * company-scoped roles read (rules `canReadCompanyScoped()` + the client
 * query) resolves them. Used by useGlobalBoot's self-heal seeding and by the
 * role-copy section of scripts/backfill-group-denorm.cjs.
 */
export function getCompanyRoleSeedDocuments(companyId: string): FirestoreRoleDocument[] {
  return getSystemRoleSeedDocuments().map((seed) => ({
    ...seed,
    id: roleDocumentId(companyId, seed.name),
    companyId,
  }));
}

export function getSystemRoleSeedDocuments(): FirestoreRoleDocument[] {
  return SYSTEM_ROLE_NAMES.map((roleName) => {
    const definition = LEGACY_SYSTEM_ROLES[roleName];
    return {
      id: roleName,
      name: roleName,
      schemaVersion: 1,
      description: definition.description,
      department: SYSTEM_ROLE_DEPARTMENTS[roleName] ?? '',
      isManager: SYSTEM_MANAGER_ROLES.has(roleName),
      isSystem: true,
      permissions: roleName === 'Admin'
        ? createAllModulePermissions()
        : legacyModulePermissions(definition.permissions),
    };
  });
}

type RoleNameLike = { name?: unknown };
type RoleDocumentLike = RoleNameLike & { id?: unknown; schemaVersion?: unknown; permissions?: unknown };

export function getMissingSystemRoleSeeds(existingRoles: Array<RoleNameLike>) {
  const existing = new Set(existingRoles.map((role) => normalizeRoleName(role.name)));
  return getSystemRoleSeedDocuments().filter((role) => !existing.has(normalizeRoleName(role.name)));
}

export function buildRoleCache(roleDocs: Array<RoleDocumentLike>) {
  return roleDocs.reduce((acc, role) => {
    const name = typeof role.name === 'string' ? role.name.trim() : '';
    if (!name) return acc;
    acc[normalizeRoleName(name)] = {
      ...(role as FirestoreRoleDocument),
      name,
      schemaVersion: 1,
    };
    return acc;
  }, {} as Record<string, unknown>);
}
