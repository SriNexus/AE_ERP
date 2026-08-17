/**
 * UniversalPermissionsTab — Role/permission summary viewer
 *
 * Phase 0C: Connected to permissions.ts role/permission cache.
 * Shows:
 * - Current role name
 * - Effective permissions matrix for the module
 * - Company access info
 * - Workspace action permission state
 *
 * Design:
 * - Read-only summary; no edit/delete actions
 * - Visible to anyone who can open the workspace
 * - No permission gate — explains why actions are available/unavailable
 * - Empty state shows info message when data is unavailable
 */

import { useMemo } from 'react';
import { ShieldCheck, ShieldAlert, Eye, PenSquare, Plus, Trash2, CheckCircle, XCircle, Building2, User, UserCheck, Info } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { useAppStore } from '../../../store/useAppStore';
import type { UniversalTabProps } from '../../../types';

// ── Permission toggle icon ─────────────────────────────────

function PermissionIcon({ allowed }: { allowed: boolean }) {
  return allowed
    ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
    : <XCircle className="h-3.5 w-3.5 text-red-400" />;
}

// ── Action label map ───────────────────────────────────────

const ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  view:   { label: 'View',   icon: <Eye className="h-3.5 w-3.5" />,       description: 'Can view this record and see its details' },
  create: { label: 'Create', icon: <Plus className="h-3.5 w-3.5" />,      description: 'Can create new records of this type' },
  edit:   { label: 'Edit',   icon: <PenSquare className="h-3.5 w-3.5" />, description: 'Can edit existing records' },
  delete: { label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />,    description: 'Can delete or archive records' },
};

// ── Main Component ──────────────────────────────────────────

export function UniversalPermissionsTab({
  entityType,
  permissions,
}: UniversalTabProps) {
  const user = useAppStore((s) => s.user);
  const company = useAppStore((s) => s.company);
  const cache = useAppStore((s) => s.permissionCache);

  // Resolve current role name
  const currentRoleName = useMemo(() => {
    if (!user?.role) return 'Unknown';
    const raw = String(user.role);
    const normalized = raw.trim().toLowerCase();
    const cachedRole = cache.roles?.[normalized];
    if (cachedRole && typeof cachedRole === 'object' && 'name' in cachedRole) {
      return (cachedRole as { name: string }).name;
    }
    const compat: Record<string, string> = {
      admin: 'Admin', director: 'Director', sales: 'Sales',
      accounts: 'Accounts', warehouse: 'Warehouse', hr: 'HR',
      operations: 'Operations', partner: 'Partner', manager: 'Manager',
      'sales executive': 'Sales', bdm: 'Sales', bde: 'Sales',
      'demo operator': 'Admin', 'demo admin': 'Admin',
    };
    return compat[normalized] ?? raw;
  }, [user?.role, cache.roles]);

  // Resolve module from entityType
  const moduleName = useMemo(() => {
    const map: Record<string, string> = {
      lead: 'leads', leads: 'leads',
      customer: 'customers', customers: 'customers',
      project: 'projects', projects: 'projects',
      quotation: 'quotations', quotations: 'quotations',
      order: 'orders', orders: 'orders',
      dispatch: 'dispatch',
      product: 'products', products: 'products',
      invoice: 'invoices', invoices: 'invoices',
      payment: 'payments', payments: 'payments',
      employee: 'employees', employees: 'employees',
      partner: 'partners', partners: 'partners',
      vendor: 'vendors', vendors: 'vendors',
      warehouse: 'warehouses', warehouses: 'warehouses',
      stock: 'stock',
      task: 'tasks', tasks: 'tasks',
      user: 'users', users: 'users',
      role: 'roles', roles: 'roles',
      report: 'reports', reports: 'reports',
      setting: 'settings', settings: 'settings',
      survey: 'surveys', surveys: 'surveys',
      'service_ticket': 'service_tickets', 'service tickets': 'service_tickets', service_tickets: 'service_tickets',
      'tax_invoice': 'tax_invoices', 'tax invoices': 'tax_invoices', tax_invoices: 'tax_invoices',
      'purchase_order': 'purchase_orders', 'purchase orders': 'purchase_orders', purchase_orders: 'purchase_orders',
      installation: 'installations', installations: 'installations',
    };
    return map[entityType?.toLowerCase()] || entityType || 'unknown';
  }, [entityType]);

  // Workspace actions derived from passed permissions prop
  const workspaceActions = useMemo(() => [
    { key: 'view',   allowed: permissions.canView !== false,   ...ACTION_LABELS.view },
    { key: 'create', allowed: permissions.canCreate !== false, ...ACTION_LABELS.create },
    { key: 'edit',   allowed: permissions.canEdit !== false,   ...ACTION_LABELS.edit },
    { key: 'delete', allowed: permissions.canDelete !== false, ...ACTION_LABELS.delete },
  ], [permissions]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
        <ShieldCheck className="h-4 w-4" />
        <span>Permissions</span>
        <span className="text-[var(--color-text-muted)]">· Read-only</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* User & Role Info Card */}
        <div className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
            <User className="h-3.5 w-3.5" />
            Current User
          </h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Name</span>
              <span className="text-sm font-medium text-[var(--color-text)]">{user?.name || 'Unknown'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Role</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
                <UserCheck className="h-3 w-3" />
                {currentRoleName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Email</span>
              <span className="text-sm text-[var(--color-text-secondary)]">{user?.email || '—'}</span>
            </div>
          </div>
        </div>

        {/* Company Access Card */}
        <div className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
            <Building2 className="h-3.5 w-3.5" />
            Company Access
          </h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Company</span>
              <span className="text-sm font-medium text-[var(--color-text)]">{company?.name || company?.shortName || 'Default'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Module</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] text-xs font-mono font-semibold">
                {moduleName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Cache Ready</span>
              <span className="flex items-center gap-1 text-xs">
                {cache.ready
                  ? <><CheckCircle className="h-3 w-3 text-emerald-500" /> <span className="text-emerald-600 dark:text-emerald-400">Synced</span></>
                  : <><XCircle className="h-3 w-3 text-amber-500" /> <span className="text-amber-600 dark:text-amber-400">Loading</span></>
                }
              </span>
            </div>
          </div>
        </div>

        {/* Workspace Actions Card */}
        <div className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
            <ShieldAlert className="h-3.5 w-3.5" />
            Workspace Actions
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            Your permissions for <span className="font-mono font-semibold text-[var(--color-text-secondary)]">{moduleName}</span>:
          </p>
          <div className="space-y-2">
            {workspaceActions.map((action) => (
              <div
                key={action.key}
                className={cn(
                  'flex items-center justify-between p-2.5 rounded-lg transition-colors duration-150',
                  action.allowed
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/10'
                    : 'bg-red-50/30 dark:bg-red-950/10',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className={cn(
                    'flex items-center justify-center h-7 w-7 rounded-md',
                    action.allowed
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300',
                  )}>
                    {action.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">{action.label}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{action.description}</p>
                  </div>
                </div>
                <PermissionIcon allowed={action.allowed} />
              </div>
            ))}
          </div>
        </div>

        {/* Info note */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Permissions are managed by your system administrator in the Roles section of Settings.
            Changes take effect after the permission cache refreshes.
          </p>
        </div>
      </div>
    </div>
  );
}

export default UniversalPermissionsTab;
