/**
 * purchaseOrderWorkspaceConfig — Tab definitions and quick actions for Purchase Order Workspace
 *
 * Phase 4B — Purchase Orders Workspace
 */

import type { TabDefinition, TabId } from '../../../components/shared/WorkspaceTabs';
import type { QuickActionDef } from '../../../components/shared/WorkspaceQuickActions';
import type { PurchaseOrderRecord, PurchaseOrderStatus } from '../types';

// ── Tab definitions ──────────────────────────────────────

export const PURCHASE_ORDER_TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'notes', label: 'Notes' },
  { id: 'documents', label: 'Documents' },
  { id: 'history', label: 'History' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'linked_records', label: 'Linked Records' },
  { id: 'attachments', label: 'Attachments' },
  { id: 'communication', label: 'Communication' },
  { id: 'goods_receipts', label: 'Goods Receipts' },
];

// ── Status-aware action filter ───────────────────────────

const STATUS_ACTIONS: Record<PurchaseOrderStatus, string[]> = {
  Draft: ['edit', 'approve', 'cancel', 'export', 'create-task'],
  Sent: ['create-gr', 'export', 'create-task'],
  PartiallyReceived: ['create-gr', 'export', 'create-task'],
  Received: ['export', 'create-task'],
  Cancelled: ['export', 'create-task'],
};

// ── Quick action builder ─────────────────────────────────

export interface POActionContext {
  canEdit: boolean;
  canApprove: boolean;
  canCreate: boolean;
  canExport: boolean;
}

export interface POActionHandlers {
  onEdit: () => void;
  onApprove: () => void;
  onCancel: () => void;
  onCreateGR: () => void;
  onViewVendor: () => void;
  onExport: () => void;
  onCreateTask: () => void;
}

export function buildPurchaseOrderQuickActions(
  po: PurchaseOrderRecord | null,
  perms: POActionContext,
  handlers: POActionHandlers,
): QuickActionDef[] {
  const status = po?.status || 'Draft';
  const allowed = STATUS_ACTIONS[status] || STATUS_ACTIONS.Draft;

  const all: QuickActionDef[] = [];

  if (allowed.includes('edit') && perms.canEdit) {
    all.push({ id: 'edit', label: 'Edit PO', permission: 'edit', variant: 'primary', handler: handlers.onEdit });
  }
  if (allowed.includes('approve') && perms.canApprove) {
    all.push({ id: 'approve', label: 'Approve PO', permission: 'approve', variant: 'primary', handler: handlers.onApprove });
  }
  if (allowed.includes('cancel') && perms.canApprove) {
    all.push({ id: 'cancel', label: 'Cancel PO', permission: 'approve', variant: 'danger', handler: handlers.onCancel });
  }
  if (allowed.includes('create-gr') && perms.canCreate) {
    all.push({ id: 'create-gr', label: 'Create GR', permission: 'create', variant: 'primary', handler: handlers.onCreateGR });
  }
  all.push({ id: 'view-vendor', label: 'View Vendor', permission: 'view', variant: 'secondary', handler: handlers.onViewVendor });
  if (allowed.includes('export') && perms.canExport) {
    all.push({ id: 'export', label: 'Export', permission: 'view', variant: 'secondary', handler: handlers.onExport });
  }
  if (allowed.includes('create-task') && perms.canCreate) {
    all.push({ id: 'create-task', label: 'Create Task', permission: 'create', variant: 'secondary', handler: handlers.onCreateTask });
  }

  return all;
}
