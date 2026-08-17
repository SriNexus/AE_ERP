/**
 * Orders workspace configuration — tab definitions and quick actions
 *
 * Phase 1 — Module #3: Orders Workspace
 * Spec: 13 tabs (Overview + 9 universal + 3 module), 24 overview fields, 7 quick actions
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Order tab definitions (13 tabs total) ───────────────────
export const ORDER_TABS: TabDefinition[] = [
  // Overview is ALWAYS module-specific
  { id: 'overview',               label: 'Overview',              always: true },
  // Universal tabs
  { id: 'activity',               label: 'Activity',              always: false },
  { id: 'notes',                  label: 'Notes',                 always: false },
  { id: 'documents',              label: 'Documents',             always: false },
  { id: 'history',                label: 'History',               always: false },
  { id: 'tasks',                  label: 'Tasks',                 always: false },
  { id: 'permissions',            label: 'Permissions',           always: false },
  { id: 'linked_records',         label: 'Linked Records',        always: false },
  { id: 'attachments',            label: 'Attachments',           always: false },
  // Module-specific tab
  { id: 'line-items',             label: 'Order Items',           always: false },
];

// ── Quick Actions factory ───────────────────────────────────

export interface OrderQuickActionHandlers {
  onEdit?: () => void;
  onReserveInventory?: () => void;
  onGenerateInvoice?: () => void;
  onRecordPayment?: () => void;
  onScheduleDispatch?: () => void;
  onCreateTask?: () => void;
}

export function buildOrderQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  handlers: OrderQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  if (permissions.canEdit) {
    actions.push({ id: 'edit-order', label: 'Edit Order', permission: 'edit', handler: handlers.onEdit ?? (() => {}), variant: 'primary' });
    actions.push({ id: 'reserve-inventory', label: 'Reserve Inventory', permission: 'edit', handler: handlers.onReserveInventory ?? (() => {}), variant: 'secondary' });
  }
  if (permissions.canCreate) {
    actions.push({ id: 'generate-invoice', label: 'Generate Invoice', permission: 'create', handler: handlers.onGenerateInvoice ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'record-payment', label: 'Record Payment', permission: 'create', handler: handlers.onRecordPayment ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'schedule-dispatch', label: 'Schedule Dispatch', permission: 'create', handler: handlers.onScheduleDispatch ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'create-task', label: 'Create Task', permission: 'create', handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' });
  }

  return actions;
}
