/**
 * Payments workspace configuration — tab definitions and quick actions
 *
 * Phase 1 — Module #6: Payments Workspace
 * Spec: 13 tabs (Overview + 9 universal + 3 module), 24 overview fields, 7 quick actions
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Payment tab definitions (13 tabs total) ────────────────
export const PAYMENT_TABS: TabDefinition[] = [
  // Overview is ALWAYS module-specific
  { id: 'overview',             label: 'Overview',             always: true },
  // Universal tabs
  { id: 'activity',             label: 'Activity',             always: false },
  { id: 'notes',                label: 'Notes',                always: false },
  { id: 'documents',            label: 'Documents',            always: false },
  { id: 'history',              label: 'History',              always: false },
  { id: 'tasks',                label: 'Tasks',                always: false },
  { id: 'permissions',          label: 'Permissions',          always: false },
  { id: 'linked_records',       label: 'Linked Records',       always: false },
  { id: 'attachments',          label: 'Attachments',          always: false },
  // Module-specific tab
  { id: 'allocations-tab',      label: 'Payment Allocations',  always: false },
];

// ── Quick Actions factory ──────────────────────────────────

export interface PaymentQuickActionHandlers {
  onEdit?: () => void;
  onDownloadReceipt?: () => void;
  onSendReceipt?: () => void;
  onRefund?: () => void;
  onMarkReconciled?: () => void;
  onAssignOwner?: () => void;
  onCreateTask?: () => void;
}

export function buildPaymentQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  handlers: PaymentQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  if (permissions.canEdit) {
    actions.push({
      id: 'edit-payment', label: 'Edit Payment', permission: 'edit',
      handler: handlers.onEdit ?? (() => {}), variant: 'primary' as const,
    });
    actions.push({
      id: 'mark-reconciled', label: 'Mark Reconciled', permission: 'edit',
      handler: handlers.onMarkReconciled ?? (() => {}), variant: 'secondary' as const,
    });
    actions.push({
      id: 'assign-owner', label: 'Assign Owner', permission: 'edit',
      handler: handlers.onAssignOwner ?? (() => {}), variant: 'secondary' as const,
    });
  }
  if (permissions.canCreate) {
    actions.push({
      id: 'download-receipt', label: 'Download Receipt', permission: 'create',
      handler: handlers.onDownloadReceipt ?? (() => {}), variant: 'secondary' as const,
    });
    actions.push({
      id: 'send-receipt', label: 'Send Receipt', permission: 'create',
      handler: handlers.onSendReceipt ?? (() => {}), variant: 'secondary' as const,
    });
    actions.push({
      id: 'refund-payment', label: 'Refund Payment', permission: 'create',
      handler: handlers.onRefund ?? (() => {}), variant: 'secondary' as const,
    });
    actions.push({
      id: 'create-task', label: 'Create Task', permission: 'create',
      handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' as const,
    });
  }

  return actions;
}
