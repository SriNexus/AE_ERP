/**
 * casePermissions — Case Permission integration (Phase 3K)
 *
 * Maps case-specific semantic permissions onto the existing RBAC system.
 * Does NOT create a new permission system — wraps canDo() with case context.
 *
 * Architecture:
 * - RBAC-driven: all checks delegate to canDo(action, 'cases')
 * - No custom role definitions
 * - No authentication changes
 * - Reuses existing Permission + Module types
 *
 * Permission Mapping:
 *   case.view          → canDo('view', 'cases')
 *   case.create        → canDo('create', 'cases')
 *   case.edit          → canDo('edit', 'cases')
 *   case.delete        → canDo('delete', 'cases')
 *   case.validate      → canDo('approve', 'cases')
 *   case.repair        → canDo('approve', 'cases') + isSuperAdmin
 *   case.export        → canDo('export', 'cases')
 *   case.search        → canDo('view', 'cases')
 *   case.analytics     → canDo('view', 'cases')
 *   case.notifications → canDo('view', 'cases')
 *   case.admin         → isSuperAdmin || fullCaseAccess()
 */

import {
  canDo,
  usePermissions,
  getModuleVisibility,
} from '../../../lib/permissions';
import type { Permission } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';

// ═══════════════════════════════════════════════════════════
//  Standalone permission check functions
// ═══════════════════════════════════════════════════════════

/** case.view — Can view cases */
export function canViewCase(): boolean {
  return canDo('view', 'cases');
}

/** case.create — Can create cases (auto-creation still requires view) */
export function canCreateCase(): boolean {
  return canDo('create', 'cases');
}

/** case.edit — Can edit case metadata */
export function canEditCase(): boolean {
  return canDo('edit', 'cases');
}

/** case.delete — Can soft-delete cases */
export function canDeleteCase(): boolean {
  return canDo('delete', 'cases');
}

/** case.validate — Can run case validation (approve-level permission) */
export function canValidateCase(): boolean {
  return canDo('approve', 'cases');
}

/** case.repair — Can run repairCaseChain (approve + super admin) */
export function canRepairCase(): boolean {
  const state = useAppStore.getState();
  const isSuperAdmin = state.user?.isSuperAdmin === true;
  return isSuperAdmin && canDo('approve', 'cases');
}

/** case.export — Can export case reports/data */
export function canExportCase(): boolean {
  return canDo('export', 'cases');
}

/** case.search — Can use Case Search (requires view access) */
export function canAccessSearch(): boolean {
  return canDo('view', 'cases');
}

/** case.analytics — Can access Case Analytics (requires view access) */
export function canAccessAnalytics(): boolean {
  return canDo('view', 'cases');
}

/** case.notifications — Can manage case notifications (requires view access) */
export function canAccessReports(): boolean {
  return canDo('view', 'cases');
}

// ═══════════════════════════════════════════════════════════
//  Compound permission checks
// ═══════════════════════════════════════════════════════════

/** case.admin — Full access (super admin OR all case permissions) */
export function canAdminCase(): boolean {
  const state = useAppStore.getState();
  if (state.user?.isSuperAdmin === true) return true;
  return (
    canDo('view', 'cases') &&
    canDo('create', 'cases') &&
    canDo('edit', 'cases') &&
    canDo('delete', 'cases') &&
    canDo('approve', 'cases') &&
    canDo('export', 'cases')
  );
}

/**
 * Check if a specific case-level action is permitted.
 * Maps semantic case permission names to the existing canDo() system.
 */
export function canCaseAction(action: string): boolean {
  const map: Record<string, Permission> = {
    view: 'view',
    create: 'create',
    edit: 'edit',
    delete: 'delete',
    validate: 'approve',
    repair: 'approve',
    export: 'export',
    search: 'view',
    analytics: 'view',
    notifications: 'view',
    admin: 'view',
  };
  const permission = map[action];
  if (!permission) return false;
  if (action === 'admin') return canAdminCase();
  if (action === 'repair') return canRepairCase();
  return canDo(permission, 'cases');
}

/** Get the visibility scope for cases ('all' | 'team' | 'self') */
export function getCaseVisibility(): 'all' | 'team' | 'self' {
  return getModuleVisibility('cases');
}

// ═══════════════════════════════════════════════════════════
//  React hook — useCasePermissions
// ═══════════════════════════════════════════════════════════

/**
 * React hook for case-specific permissions.
 * Mirrors the usePermissions() pattern but with case semantics.
 */
export function useCasePermissions() {
  const base = usePermissions();
  const state = useAppStore.getState();
  const isSuperAdmin = state.user?.isSuperAdmin === true;

  return {
    /** Whether the permission cache is ready */
    ready: base.ready,

    /** Check a raw case permission */
    can: (action: string) => canCaseAction(action),

    /** Quick helpers */
    canView: () => base.canView('cases'),
    canCreate: () => base.canCreate('cases'),
    canEdit: () => base.canEdit('cases'),
    canDelete: () => base.canDelete('cases'),
    canValidate: () => canValidateCase(),
    canRepair: () => canRepairCase(),
    canExport: () => base.canExport('cases'),
    canSearch: () => base.canView('cases'),
    canAnalytics: () => base.canView('cases'),
    canNotifications: () => base.canView('cases'),
    canAdmin: () => canAdminCase(),

    /** Whether the current user is a super admin */
    isSuperAdmin,

    /** Visibility scope for cases */
    getVisibility: (): 'all' | 'team' | 'self' => getCaseVisibility(),
  };
}

// ═══════════════════════════════════════════════════════════
//  Role resolution helpers
// ═══════════════════════════════════════════════════════════

/**
 * Determine the case access level for a given role string.
 * Useful for UI display of what a role can do.
 */
export function getCaseAccessLevel(role?: string): 'none' | 'view' | 'edit' | 'admin' {
  const r = String(role || '').toLowerCase();
  // Super admin / admin roles
  if (r === 'admin' || role === 'Admin') return 'admin';
  // Director-level access  
  if (r === 'director' || role === 'Director') return 'admin';
  // Manager / operations can edit
  if (r === 'operations' || role === 'Operations') return 'edit';
  if (r === 'manager') return 'edit';
  // Standard roles can view
  if (r === 'sales' || role === 'Sales') return 'view';
  if (r === 'accounts' || role === 'Accounts') return 'view';
  if (r === 'warehouse' || role === 'Warehouse') return 'view';
  if (r === 'hr' || role === 'HR') return 'view';
  if (r === 'partner' || role === 'Partner') return 'view';
  return 'none';
}

// ═══════════════════════════════════════════════════════════
//  Quick Action permission resolver
// ═══════════════════════════════════════════════════════════

export interface CaseQuickActionPermission {
  id: string;
  label: string;
  allowed: boolean;
  permission: string;
}

/**
 * Get permission status for all case quick actions.
 * Useful for enabling/disabling action buttons based on user permissions.
 */
export function getCaseQuickActionPermissions(): CaseQuickActionPermission[] {
  return [
    { id: 'open-lead', label: 'Open Lead', allowed: canViewCase(), permission: 'case.view' },
    { id: 'open-customer', label: 'Open Customer', allowed: canViewCase(), permission: 'case.view' },
    { id: 'open-project', label: 'Open Project', allowed: canViewCase(), permission: 'case.view' },
    { id: 'validate-case', label: 'Validate Case', allowed: canValidateCase(), permission: 'case.validate' },
    { id: 'health-report', label: 'Health Report', allowed: canViewCase(), permission: 'case.view' },
    { id: 'export-case', label: 'Export Case', allowed: canExportCase(), permission: 'case.export' },
    { id: 'create-task', label: 'Create Task', allowed: canDo('create', 'dashboard'), permission: 'task.create' },
    { id: 'run-repair', label: 'Run Repair', allowed: canRepairCase(), permission: 'case.repair' },
  ];
}
