/**
 * Quotations workspace configuration — tab definitions and quick actions
 *
 * Phase 1 — Module #4: Quotations Workspace
 * Spec: 13 tabs (Overview + 9 universal + 3 module), 24 overview fields, 7 quick actions
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Quotation tab definitions (13 tabs total) ──────────────
export const QUOTATION_TABS: TabDefinition[] = [
  // Overview is ALWAYS module-specific
  { id: 'overview',               label: 'Overview',              always: true },
  // Universal tabs
  { id: 'items-tab',              label: 'Items',                 always: false },
  { id: 'activity',               label: 'Activity',              always: false },
  { id: 'notes',                  label: 'Notes',                 always: false },
  { id: 'documents',              label: 'Documents',             always: false },
  { id: 'history',                label: 'History',               always: false },
  { id: 'tasks',                  label: 'Tasks',                 always: false },
  { id: 'permissions',            label: 'Permissions',           always: false },
  { id: 'linked_records',         label: 'Linked Records',        always: false },
  { id: 'attachments',            label: 'Attachments',           always: false },
];

// ── Quick Actions factory ───────────────────────────────────

export interface QuotationQuickActionHandlers {
  onEdit?: () => void;
  onConvertToOrder?: () => void;
  onSend?: () => void;
  onDownloadPdf?: () => void;
  onCreateTask?: () => void;
}

export function buildQuotationQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  handlers: QuotationQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  if (permissions.canEdit) {
    actions.push({ id: 'edit-quotation', label: 'Edit Quotation', permission: 'edit', handler: handlers.onEdit ?? (() => {}), variant: 'primary' });
    actions.push({ id: 'convert-to-order', label: 'Convert to Order', permission: 'edit', handler: handlers.onConvertToOrder ?? (() => {}), variant: 'secondary' });
  }
  if (permissions.canCreate) {
    actions.push({ id: 'send-quotation', label: 'Send Quotation', permission: 'create', handler: handlers.onSend ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'download-pdf', label: 'Download PDF', permission: 'create', handler: handlers.onDownloadPdf ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'create-task', label: 'Create Task', permission: 'create', handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' });
  }

  return actions;
}
