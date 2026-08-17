/**
 * goodsReceiptWorkspaceConfig — Tab definitions and quick actions for Goods Receipts Workspace
 *
 * Phase 4C — Goods Receipts Workspace
 * GRNs are immutable — no edit or delete actions.
 */

import type { TabDefinition } from '../../../components/shared/WorkspaceTabs';
import type { QuickActionDef } from '../../../components/shared/WorkspaceQuickActions';
import type { GoodsReceiptRecord } from '../types';

// ── Tab definitions ──────────────────────────────────────

export const GOODS_RECEIPT_TABS: TabDefinition[] = [
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
  { id: 'inventory_impact', label: 'Inventory Impact' },
];

// ── Status-aware action filter (GRNs are immutable) ──────

/**
 * GRN statuses: Draft, Received, Accepted, Completed, Cancelled
 * No edit or delete actions — GRNs are immutable financial/inventory records.
 */
const STATUS_ACTIONS: Record<string, string[]> = {
  Draft: ['view-po', 'view-vendor', 'export', 'create-task'],
  Received: ['view-po', 'view-vendor', 'export', 'create-task'],
  Accepted: ['view-stock', 'export', 'create-task'],
  Completed: ['export', 'create-task'],
  Cancelled: ['export', 'create-task'],
};

// ── Quick action builder ─────────────────────────────────

export interface GRActionContext {
  canView: boolean;
  canExport: boolean;
  canCreate: boolean;
}

export interface GRActionHandlers {
  onViewPO: () => void;
  onViewVendor: () => void;
  onViewWarehouse: () => void;
  onViewStock: () => void;
  onExport: () => void;
  onCreateTask: () => void;
}

export function buildGoodsReceiptQuickActions(
  gr: GoodsReceiptRecord | null,
  perms: GRActionContext,
  handlers: GRActionHandlers,
): QuickActionDef[] {
  const status = (gr as any)?.status || 'Draft';
  const allowed = STATUS_ACTIONS[status] || STATUS_ACTIONS.Draft;

  const all: QuickActionDef[] = [];

  if (allowed.includes('view-po') && perms.canView) {
    all.push({ id: 'view-po', label: 'View PO', permission: 'view', variant: 'secondary', handler: handlers.onViewPO });
  }
  if (allowed.includes('view-vendor') && perms.canView) {
    all.push({ id: 'view-vendor', label: 'View Vendor', permission: 'view', variant: 'secondary', handler: handlers.onViewVendor });
  }
  if (allowed.includes('view-warehouse') && perms.canView) {
    all.push({ id: 'view-warehouse', label: 'View Warehouse', permission: 'view', variant: 'secondary', handler: handlers.onViewWarehouse });
  }
  if (allowed.includes('view-stock') && perms.canView) {
    all.push({ id: 'view-stock', label: 'View Stock', permission: 'view', variant: 'primary', handler: handlers.onViewStock });
  }
  if (allowed.includes('export') && perms.canExport) {
    all.push({ id: 'export', label: 'Export', permission: 'view', variant: 'secondary', handler: handlers.onExport });
  }
  if (allowed.includes('create-task') && perms.canCreate) {
    all.push({ id: 'create-task', label: 'Create Task', permission: 'create', variant: 'secondary', handler: handlers.onCreateTask });
  }

  return all;
}
