/**
 * SettingsSection — Base template for every settings section.
 *
 * Provides consistent layout: title, description, children (content),
 * optional save area, loading state, empty state, and permission wrapper.
 */

import React, { type ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';

export interface SettingsSectionProps {
  /** Section title displayed at the top */
  title: string;
  /** Section description / subtitle */
  description?: string;
  /** Icon displayed next to the title */
  icon?: ReactNode;
  /** Main content — optional for loading/empty states */
  children?: ReactNode;
  /** Optional save action */
  onSave?: () => void;
  /** Whether the save is in progress */
  isSaving?: boolean;
  /** Whether the section is in loading state */
  isLoading?: boolean;
  /** Whether the section is in empty state */
  isEmpty?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Empty state action */
  emptyAction?: ReactNode;
  /** Whether the user has permission to view this section */
  hasPermission?: boolean;
  /** Permission denied message */
  permissionMessage?: string;
  /** Additional className */
  className?: string;
}

export function SettingsSection({
  title,
  description,
  icon,
  children,
  onSave,
  isSaving,
  isLoading,
  isEmpty,
  emptyMessage,
  emptyAction,
  hasPermission = true,
  permissionMessage,
  className,
}: SettingsSectionProps) {
  // Permission check
  if (!hasPermission) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[30vh] text-center px-6">
        <div className="h-12 w-12 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-3">
          <span className="text-xl">🔒</span>
        </div>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Access Restricted</h3>
        <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
          {permissionMessage || 'You do not have permission to view this section.'}
        </p>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="flex items-center gap-3">
          {icon && <div className="h-8 w-8 rounded-lg bg-[var(--color-bg-sunken)] animate-pulse" />}
          <div className="space-y-1.5">
            <div className="h-4 w-32 rounded bg-[var(--color-bg-sunken)] animate-pulse" />
            <div className="h-3 w-48 rounded bg-[var(--color-bg-sunken)] animate-pulse" />
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] p-6 space-y-3">
          <div className="h-4 w-full rounded bg-[var(--color-bg-sunken)] animate-pulse" />
          <div className="h-4 w-3/4 rounded bg-[var(--color-bg-sunken)] animate-pulse" />
          <div className="h-4 w-1/2 rounded bg-[var(--color-bg-sunken)] animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] pb-3">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="h-8 w-8 rounded-lg bg-[var(--color-primary-light)] flex items-center justify-center shrink-0 text-[var(--color-primary-text)]">
              {icon}
            </div>
          )}
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--color-text)]">{title}</h2>
            {description && (
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
            )}
          </div>
        </div>
        {onSave && (
          <Button size="sm" onClick={onSave} loading={isSaving}>
            Save Changes
          </Button>
        )}
      </div>

      {/* Content */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center min-h-[20vh] text-center px-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-8">
          <p className="text-xs text-[var(--color-text-muted)]">{emptyMessage || 'Nothing to configure yet.'}</p>
          {emptyAction && <div className="mt-3">{emptyAction}</div>}
        </div>
      ) : (
        <div className="space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
