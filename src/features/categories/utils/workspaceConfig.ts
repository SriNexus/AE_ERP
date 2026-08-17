/**
 * workspaceConfig — Categories module workspace configuration
 *
 * Phase 6B Correction — Categories are MASTER DATA, not workflow entities.
 * Only inventory-relevant tabs and actions are included.
 */

import type { TabDefinition } from '../../../components/shared/WorkspaceTabs';
import type { QuickActionDef } from '../../../components/shared/WorkspaceQuickActions';

export const CATEGORY_TABS: TabDefinition[] = [
  { id: 'overview',       label: 'Overview',       always: true },
  { id: 'products-tab',   label: 'Products',       always: false },
  { id: 'activity',       label: 'Activity',        always: false },
  { id: 'history',        label: 'History',         always: false },
  { id: 'linked_records', label: 'Linked Records',  always: false },
  { id: 'permissions',    label: 'Permissions',     always: false },
];

export function buildCategoryQuickActions(
  _category: Record<string, unknown> | null,
  permissions: { canEdit: boolean; canCreate: boolean },
  handlers: {
    onEdit?: () => void;
    onViewProducts?: () => void;
    onArchive?: () => void;
  },
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  if (permissions.canEdit) {
    actions.push({ id: 'edit-category', label: 'Edit Category', permission: 'edit', handler: handlers.onEdit ?? (() => {}), variant: 'primary' });
    actions.push({ id: 'view-products', label: 'View Products', permission: 'edit', handler: handlers.onViewProducts ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'archive-category', label: 'Archive', permission: 'edit', handler: handlers.onArchive ?? (() => {}), variant: 'danger' });
  }

  return actions;
}
