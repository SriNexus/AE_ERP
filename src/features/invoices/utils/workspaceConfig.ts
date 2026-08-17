/**
 * Invoices workspace configuration — tab definitions and quick actions
 *
 * Phase 1 — Module #5: Invoices Workspace
 * Spec: 13 tabs (Overview + 9 universal + 3 module), 24 overview fields, 7 quick actions
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Invoice tab definitions (13 tabs total) ────────────────
export const INVOICE_TABS: TabDefinition[] = [
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
  { id: 'items-tab',              label: 'Invoice Items',         always: false },
];

// ── Quick Actions factory ───────────────────────────────────

export interface InvoiceQuickActionHandlers {
  onEdit?: () => void;
  onRecordPayment?: () => void;
  onDownloadPdf?: () => void;
  onSend?: () => void;
  onMarkPaid?: () => void;
  onAssignOwner?: () => void;
  onCreateTask?: () => void;
}

export function buildInvoiceQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  handlers: InvoiceQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  if (permissions.canEdit) {
    actions.push({ id: 'edit-invoice', label: 'Edit Invoice', permission: 'edit', handler: handlers.onEdit ?? (() => {}), variant: 'primary' });
    actions.push({ id: 'mark-paid', label: 'Mark Paid', permission: 'edit', handler: handlers.onMarkPaid ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'assign-owner', label: 'Assign Owner', permission: 'edit', handler: handlers.onAssignOwner ?? (() => {}), variant: 'secondary' });
  }
  if (permissions.canCreate) {
    actions.push({ id: 'record-payment', label: 'Record Payment', permission: 'create', handler: handlers.onRecordPayment ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'download-pdf', label: 'Download PDF', permission: 'create', handler: handlers.onDownloadPdf ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'send-invoice', label: 'Send Invoice', permission: 'create', handler: handlers.onSend ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'create-task', label: 'Create Task', permission: 'create', handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' });
  }

  return actions;
}
