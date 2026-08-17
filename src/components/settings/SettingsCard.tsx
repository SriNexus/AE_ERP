/**
 * SettingsCard — Reusable card for displaying settings content.
 * Used inside SettingsSection for content groupings.
 */

import React, { type ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface SettingsCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Optional action slot in the header */
  action?: ReactNode;
}

export function SettingsCard({ title, description, children, className, action }: SettingsCardProps) {
  return (
    <div className={cn(
      'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm',
      className
    )}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2 sm:px-5 lg:px-6">
          <div>
            {title && (
              <h3 className="text-sm font-bold text-[var(--color-text)]">{title}</h3>
            )}
            {description && (
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0 ml-2">{action}</div>}
        </div>
      )}
      <div className={`px-4 pb-4 sm:px-5 lg:px-6 lg:pb-5 ${title || action ? 'pt-2' : 'pt-4'}`}>
        {children}
      </div>
    </div>
  );
}
