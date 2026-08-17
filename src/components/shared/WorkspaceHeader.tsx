/**
 * WorkspaceHeader — Universal header for all workspace entities
 *
 * Phase 0A: Generic header component used by every module workspace.
 * Renders: Entity Name, Status badge, Entity ID, Tags, Created Date,
 * Assigned User, Updated At, and optional Case ID link.
 *
 * Design constraints (Section 2.2 / Section 14):
 * - 90% shared code — identical across all modules
 * - URL-driven — no state stored outside the route
 * - Only the Status badge color varies per module (via statusBadge)
 */

import type { ReactNode } from 'react';
import React from 'react';
import { cn } from '../../utils/cn';

export interface WorkspaceHeaderProps {
  /** Primary display name of the entity */
  name: string;
  /** Current status string — rendered via a Badge-like pill */
  status?: string;
  /** Entity ID — displayed in monospace, copyable */
  entityId?: string;
  /** Case ID — if this entity participates in the Case lifecycle (Section 6.4) */
  caseId?: string;
  /** Click handler for the Case ID badge — navigates to the Case workspace */
  onCaseClick?: () => void;
  /** Tags array — rendered as colored chips */
  tags?: string[];
  /** ISO date string for creation */
  createdAt?: string;
  /** Assigned user info — avatar + name */
  assignedTo?: { id?: string; name?: string; avatarUrl?: string };
  /** ISO date string for last update */
  updatedAt?: string;
  /** Optional action elements rendered on the right side of the header row */
  actions?: ReactNode;
  /** Utility class override */
  className?: string;
}

function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return '';
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatAbsoluteDate(isoDate?: string): string {
  if (!isoDate) return '';
  return new Date(isoDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Renders a colored status pill.
 * In Phase 1, this will use the module-specific `statusBadge()` function.
 * For Phase 0, it provides a generic colored badge.
 */
function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const colorMap: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    converted: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
    lost: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    closed: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
  };
  const key = status.toLowerCase();
  const cls = colorMap[key] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300';

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold leading-5',
        cls,
      )}
    >
      {status}
    </span>
  );
}

export function WorkspaceHeader({
  name,
  status,
  entityId,
  caseId,
  onCaseClick,
  tags,
  createdAt,
  assignedTo,
  updatedAt,
  actions,
  className,
}: WorkspaceHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 px-6 py-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
        className,
      )}
    >
      {/* Row 1: Entity Name + Status + ID */}
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        <h1
          className="text-xl font-bold text-[var(--color-text)] leading-tight truncate select-all"
          title={name}
        >
          {name}
        </h1>
        <StatusBadge status={status} />
        {entityId && (
          <span
            className="text-xs font-mono text-[var(--color-text-muted)] select-all"
            title={`ID: ${entityId}`}
          >
            #{entityId}
          </span>
        )}
        {caseId && (
          <button
            type="button"
            onClick={onCaseClick}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]/40"
            title="View parent Case"
          >
            {caseId}
          </button>
        )}
        {/* Actions slot — back button, refresh, etc. */}
        {actions && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Row 2: Tags + Metadata */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-[var(--color-text-muted)]">
        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Created */}
        {createdAt && (
          <span className="whitespace-nowrap" title={formatAbsoluteDate(createdAt)}>
            Created {formatRelativeTime(createdAt)}
          </span>
        )}

        {/* Assigned To */}
        {assignedTo?.name && (
          <span className="whitespace-nowrap">
            Assigned to{' '}
            <span className="font-medium text-[var(--color-text-secondary)]">
              {assignedTo.name}
            </span>
          </span>
        )}

        {/* Updated */}
        {updatedAt && (
          <span className="whitespace-nowrap">Updated {formatRelativeTime(updatedAt)}</span>
        )}
      </div>
    </div>
  );
}

export default WorkspaceHeader;
