import { cn } from '../../utils/cn';
import React from 'react';

/**
 * WorkspaceHero — Premium page hero for Neozy workspaces.
 *
 * Designed to be the Universal Workspace Hero for all ERP modules.
 * Features:
 *   - Large, premium title typography
 *   - Descriptive subtitle + description text
 *   - Theme-aware icon container
 *   - Status indicator with colored dot
 *   - Breadcrumb trail
 *   - Action buttons area
 *   - Responsive layout
 *   - All colors from --color-* CSS variables
 */
export function WorkspaceHero({
  title,
  subtitle,
  description,
  icon,
  statusText,
  statusDotColor,
  breadcrumbs,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: React.ReactNode;
  statusText?: string;
  statusDotColor?: string;
  breadcrumbs?: string[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-6 flex-wrap', className)}>
      <div className="flex items-start gap-4 min-w-0 flex-1">
        {icon && (
          <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-primary-light)] text-[var(--color-primary-text)] shadow-sm">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)] mb-1">
              {breadcrumbs.join(' / ')}
            </p>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)] leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm font-medium text-[var(--color-text-secondary)]">
              {subtitle}
            </p>
          )}
          {description && (
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)] max-w-xl">
              {description}
            </p>
          )}
          {statusText && (
            <div className="mt-1 flex items-center gap-1.5">
              {statusDotColor && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: statusDotColor || 'var(--color-success)' }}
                />
              )}
              <span className="text-[11px] font-medium text-[var(--color-text-muted)]">
                {statusText}
              </span>
            </div>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}
