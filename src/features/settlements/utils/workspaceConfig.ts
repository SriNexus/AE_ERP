/**
 * Settlements workspace configuration — tab definitions and quick actions
 *
 * Phase 2E.4 — Settlements Workspace
 * Spec: 10 tabs (Overview + 9 universal), 25+ overview fields, 7 quick actions
 *
 * Settlement is a FINANCE entity. No Case Engine.
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Settlement tab definitions (10 tabs total) ──────────────
export const SETTLEMENT_TABS: TabDefinition[] = [
  // Overview is ALWAYS module-specific
  { id: 'overview',               label: 'Overview',              always: true },
  // Universal tabs (9)
  { id: 'activity',               label: 'Activity',              always: false },
  { id: 'notes',                  label: 'Notes',                 always: false },
  { id: 'documents',              label: 'Documents',             always: false },
  { id: 'history',                label: 'History',               always: false },
  { id: 'tasks',                  label: 'Tasks',                 always: false },
  { id: 'permissions',            label: 'Permissions',           always: false },
  { id: 'linked_records',         label: 'Linked Records',        always: false },
  { id: 'attachments',            label: 'Attachments',           always: false },
  { id: 'communication',          label: 'Communication',         always: false },
];

// ── Quick Actions factory ───────────────────────────────────
// Status-aware: actions depend on current settlement status

export interface SettlementQuickActionHandlers {
  onProcess?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onViewPartner?: () => void;
  onViewCommissionRecords?: () => void;
  onExportSettlement?: () => void;
  onCreateTask?: () => void;
}

export function buildSettlementQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  status: string,
  handlers: SettlementQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];
  const s = status.toLowerCase();

  // Status-dependent primary actions
  if (permissions.canEdit) {
    if (s === 'pending') {
      actions.push({ id: 'process-settlement', label: 'Process Settlement', permission: 'edit', handler: handlers.onProcess ?? (() => {}), variant: 'primary' });
      actions.push({ id: 'cancel-settlement', label: 'Cancel Settlement', permission: 'edit', handler: handlers.onCancel ?? (() => {}), variant: 'danger' });
    } else if (s === 'failed') {
      actions.push({ id: 'retry-settlement', label: 'Retry Settlement', permission: 'edit', handler: handlers.onRetry ?? (() => {}), variant: 'primary' });
    }
  }

  // Status-qualified view actions
  if (permissions.canCreate) {
    // CANCELLED: Export ONLY
    if (s === 'cancelled') {
      actions.push({ id: 'export-settlement', label: 'Export Settlement', permission: 'create', handler: handlers.onExportSettlement ?? (() => {}), variant: 'secondary' });
    } else {
      // All other statuses: full action set
      actions.push({ id: 'view-partner', label: 'View Partner', permission: 'create', handler: handlers.onViewPartner ?? (() => {}), variant: 'secondary' });
      actions.push({ id: 'view-commission-records', label: 'View Commission Records', permission: 'create', handler: handlers.onViewCommissionRecords ?? (() => {}), variant: 'secondary' });
      actions.push({ id: 'export-settlement', label: 'Export Settlement', permission: 'create', handler: handlers.onExportSettlement ?? (() => {}), variant: 'secondary' });
      actions.push({ id: 'create-task', label: 'Create Task', permission: 'create', handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' });
    }
  }

  return actions;
}
