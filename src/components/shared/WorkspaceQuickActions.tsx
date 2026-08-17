/**
 * WorkspaceQuickActions — Generic action bar for workspace entities
 *
 * Phase 0A: Renders a horizontal bar of action buttons that are
 * module-specific. Each module registers its actions in a registry
 * (Appendix D) keyed by module name.
 *
 * Design constraints:
 * - Actions are permission-gated (hidden, never disabled)
 * - Primary actions are visually emphasized
 * - Dangerous actions (delete, cancel, mark lost) are styled with danger variant
 * - Empty state: no actions visible if the user has no permissions
 */

import React from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';

// ── Types ──────────────────────────────────────────────────

export interface QuickActionDef {
  /** Unique action identifier */
  id: string;
  /** Button label */
  label: string;
  /** Icon component (Lucide icon) */
  icon?: React.ReactNode;
  /** Permission key required to see this action */
  permission?: 'view' | 'create' | 'edit' | 'delete' | 'approve';
  /** Click handler */
  handler: () => void;
  /** Whether the action is disabled (e.g., prerequisite not met) */
  disabled?: boolean;
  /** Button visual variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Optional tooltip text */
  title?: string;
}

export interface WorkspaceQuickActionsProps {
  /** Ordered list of action definitions for this module */
  actions: QuickActionDef[];
  /** User's permission set for this module */
  permissions: {
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canApprove?: boolean;
    [key: string]: boolean | undefined;
  };
  /** Class name override */
  className?: string;
}

// ── Permission Check ───────────────────────────────────────

function hasPermission(
  action: QuickActionDef,
  permissions: WorkspaceQuickActionsProps['permissions'],
): boolean {
  if (!action.permission) return true;
  switch (action.permission) {
    case 'view':
      return !!permissions.canView;
    case 'create':
      return !!permissions.canCreate;
    case 'edit':
      return !!permissions.canEdit;
    case 'delete':
      return !!permissions.canDelete;
    case 'approve':
      return permissions.canApprove ?? !!permissions.canEdit;
    default:
      return true;
  }
}

// ── Component ──────────────────────────────────────────────

export function WorkspaceQuickActions({
  actions,
  permissions,
  className,
}: WorkspaceQuickActionsProps) {
  // Filter actions by permission
  const visibleActions = actions.filter((a) => hasPermission(a, permissions));

  if (visibleActions.length === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-6 py-3 border-b border-[var(--color-border-subtle)] overflow-x-auto',
        'bg-[var(--color-bg-sunken)]',
        className,
      )}
    >
      {visibleActions.map((action) => (
        <Button
          key={action.id}
          type="button"
          variant={action.variant ?? 'secondary'}
          size="sm"
          disabled={action.disabled}
          onClick={action.handler}
          title={action.title ?? action.label}
          icon={action.icon}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

export default WorkspaceQuickActions;
