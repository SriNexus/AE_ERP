/**
 * EmptyState — Standardized no-data state component
 * Phase P1: Full semantic token compliance.
 */

import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../../utils/cn';

interface EmptyStateProps {
  title:        string;
  description?: string;
  icon?:        React.ReactNode;
  action?:      React.ReactNode;
  variant?:     'table' | 'card';
  colSpan?:     number;
  compact?:     boolean;
  className?:   string;
}

function EmptyStateInner({ title, description, icon, action, compact, className }: Omit<EmptyStateProps, 'variant' | 'colSpan'>) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      compact ? 'py-8 gap-2' : 'py-14 gap-3',
      className,
    )}>
      <div className={cn(
        'rounded-full flex items-center justify-center',
        'bg-[var(--color-bg-sunken)]',
        'text-[var(--color-text-muted)]',
        compact ? 'h-10 w-10' : 'h-14 w-14',
      )}>
        {icon ?? <Inbox className={compact ? 'h-5 w-5' : 'h-7 w-7'} />}
      </div>

      <div className="space-y-1">
        <p className={cn(
          'font-medium text-[var(--color-text-secondary)]',
          compact ? 'text-sm' : 'text-base',
        )}>
          {title}
        </p>
        {description && (
          <p className="text-xs text-[var(--color-text-muted)] max-w-xs">
            {description}
          </p>
        )}
      </div>

      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function EmptyState({ variant = 'card', colSpan, ...props }: EmptyStateProps) {
  if (variant === 'table') {
    return (
      <tr>
        <td colSpan={colSpan ?? 99} className="p-0">
          <EmptyStateInner {...props} />
        </td>
      </tr>
    );
  }
  return <EmptyStateInner {...props} />;
}

export default EmptyState;
