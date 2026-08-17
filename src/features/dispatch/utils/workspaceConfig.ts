/**
 * Dispatch workspace configuration — tab definitions and quick actions
 *
 * Solar EPC Dispatch: 9 operational tabs
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Dispatch tab definitions (9 Solar EPC operational tabs) ───
export const DISPATCH_TABS: TabDefinition[] = [
  { id: 'overview',             label: 'Overview',             always: true },
  { id: 'tracking',             label: 'Tracking',             always: true },
  { id: 'vehicle-details',      label: 'Vehicle Details',      always: false },
  { id: 'material-allocation',  label: 'Material Allocation',  always: false },
  { id: 'loading-details',      label: 'Loading Details',      always: false },
  { id: 'delivery-proof',       label: 'Delivery Proof',       always: false },
  { id: 'activity',             label: 'Activity',             always: false },
  { id: 'notes',                label: 'Notes',                always: false },
  { id: 'documents',            label: 'Documents',            always: false },
];

// ── Quick Actions factory ──────────────────────────────────

export interface DispatchQuickActionHandlers {
  onEdit?: () => void;
  onUpdateTracking?: () => void;
  onMarkInTransit?: () => void;
  onMarkDelivered?: () => void;
  onDownloadChallan?: () => void;
  onAssignDriver?: () => void;
  onCreateTask?: () => void;
}

export function buildDispatchQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  handlers: DispatchQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  if (permissions.canEdit) {
    actions.push({
      id: 'edit-dispatch', label: 'Edit Dispatch', permission: 'edit',
      handler: handlers.onEdit ?? (() => {}), variant: 'primary' as const,
    });
    actions.push({
      id: 'update-tracking', label: 'Update Tracking', permission: 'edit',
      handler: handlers.onUpdateTracking ?? (() => {}), variant: 'secondary' as const,
    });
    actions.push({
      id: 'mark-in-transit', label: 'Mark In Transit', permission: 'edit',
      handler: handlers.onMarkInTransit ?? (() => {}), variant: 'secondary' as const,
    });
    actions.push({
      id: 'mark-delivered', label: 'Mark Delivered', permission: 'edit',
      handler: handlers.onMarkDelivered ?? (() => {}), variant: 'secondary' as const,
    });
    actions.push({
      id: 'assign-driver', label: 'Assign Driver', permission: 'edit',
      handler: handlers.onAssignDriver ?? (() => {}), variant: 'secondary' as const,
    });
  }
  if (permissions.canCreate) {
    actions.push({
      id: 'download-challan', label: 'Download Challan', permission: 'create',
      handler: handlers.onDownloadChallan ?? (() => {}), variant: 'secondary' as const,
    });
    actions.push({
      id: 'create-task', label: 'Create Task', permission: 'create',
      handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' as const,
    });
  }

  return actions;
}
