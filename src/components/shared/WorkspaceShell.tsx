/**
 * WorkspaceShell — Full workspace layout wrapper
 *
 * Phase 0A: Supports two modes:
 *   1. Full workspace layout (stacked=false): Header → QuickActions → Tabs
 *   2. Legacy sidebar layout (stacked=true): 2-column grid (360px + content)
 *
 * The legacy mode preserves backward compatibility for existing modules
 * that haven't migrated to the full workspace pattern yet.
 *
 * Design constraints (Section 2.1 / Section 14):
 * - Zero-scroll on transition — workspace is tab-driven, not a long scroll
 * - Lazy tab loading — only active tab's content is mounted
 * - URL-driven — tab state is synced to URL
 */

import type { ReactNode } from 'react';
import React from 'react';
import { cn } from '../../utils/cn';
import { Card } from '../ui/Card';
import WorkspaceHeader from './WorkspaceHeader';
import WorkspaceTabs from './WorkspaceTabs';
import WorkspaceQuickActions from './WorkspaceQuickActions';
import type { WorkspaceHeaderProps } from './WorkspaceHeader';
import type { WorkspaceTabsProps } from './WorkspaceTabs';
import type { WorkspaceQuickActionsProps } from './WorkspaceQuickActions';

// ── Types ──────────────────────────────────────────────────

export interface WorkspaceShellProps {
  /** Full workspace mode: header props */
  header?: WorkspaceHeaderProps;
  /** Full workspace mode: quick actions props */
  quickActions?: WorkspaceQuickActionsProps;
  /** Full workspace mode: tabs props */
  tabs?: WorkspaceTabsProps;
  /** Legacy mode: left sidebar content */
  left?: ReactNode;
  /** Legacy mode: right main content */
  right?: ReactNode;
  /** Legacy mode: use 2-column layout instead of full workspace */
  stacked?: boolean;
  /** Additional class names */
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
  /** Loading state — shows skeleton when true */
  loading?: boolean;
  /** Error state — shows error message when set */
  error?: string;
  /** Child content (alternative to tabs/left/right props) */
  children?: ReactNode;
}

// ── Loading Skeleton ───────────────────────────────────────

function ShellSkeleton() {
  return (
    <div className="flex flex-col h-full animate-fadeIn">
      {/* Header skeleton */}
      <div className="px-6 py-4 border-b border-[var(--color-border-subtle)]">
        <div className="h-7 w-64 bg-[var(--color-bg-sunken)] rounded-md animate-pulse" />
        <div className="flex gap-4 mt-3">
          <div className="h-4 w-24 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
          <div className="h-4 w-32 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
        </div>
      </div>
      {/* Quick actions skeleton */}
      <div className="px-6 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-[var(--color-bg-sunken)] rounded-lg animate-pulse" />
          <div className="h-8 w-24 bg-[var(--color-bg-sunken)] rounded-lg animate-pulse" />
          <div className="h-8 w-16 bg-[var(--color-bg-sunken)] rounded-lg animate-pulse" />
        </div>
      </div>
      {/* Tab bar skeleton */}
      <div className="px-6 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex gap-6">
          <div className="h-5 w-16 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
          <div className="h-5 w-12 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
          <div className="h-5 w-14 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
          <div className="h-5 w-16 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 p-6">
        <div className="space-y-4">
          <div className="h-4 w-3/4 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
          <div className="h-4 w-1/2 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// ── Error State ────────────────────────────────────────────

function ShellError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger-light)] p-6 max-w-md text-center">
        <p className="text-sm font-semibold text-[var(--color-danger-text)] mb-2">
          Something went wrong
        </p>
        <p className="text-xs text-[var(--color-danger-text)]/80">{message}</p>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────

export function WorkspaceShell({
  header,
  quickActions,
  tabs,
  left,
  right,
  stacked = false,
  className,
  leftClassName,
  rightClassName,
  loading,
  error,
  children,
}: WorkspaceShellProps) {
  // Loading state
  if (loading) return <ShellSkeleton />;

  // Error state
  if (error) return <ShellError message={error} />;

  // Legacy 2-column mode (backward compatible)
  if (stacked || (left !== undefined && right !== undefined)) {
    return (
      <div className={cn('grid gap-5 h-full', stacked ? 'grid-cols-1' : 'lg:grid-cols-[360px_minmax(0,1fr)]', className)}>
        <Card className={cn('p-4', leftClassName)}>{left}</Card>
        <Card className={cn('p-4', rightClassName)}>{right}</Card>
      </div>
    );
  }

  // Full workspace mode
  return (
    <div className={cn('flex flex-col h-full overflow-hidden bg-[var(--color-surface)]', className)}>
      {/* Workspace Header */}
      {header && <WorkspaceHeader {...header} />}

      {/* Quick Actions */}
      {quickActions && <WorkspaceQuickActions {...quickActions} />}

      {/* Tabs + Content */}
      {tabs && <WorkspaceTabs {...tabs} />}

      {/* Children (fallback for direct content) */}
      {!tabs && children && (
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      )}

      {/* Empty state — nothing provided */}
      {!header && !quickActions && !tabs && !children && !left && !right && (
        <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
          WorkspaceShell: No content provided.
        </div>
      )}
    </div>
  );
}

export default WorkspaceShell;
