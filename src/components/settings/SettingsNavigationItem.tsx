/**
 * SettingsNavigationItem — Clickable navigation row for mobile settings list.
 * Shows icon, label, description and a chevron indicating it opens a section.
 */

import React from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

interface SettingsNavigationItemProps {
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
  /** Whether this is the currently active/selected item */
  isActive?: boolean;
}

export function SettingsNavigationItem({
  icon: Icon,
  label,
  description,
  onClick,
  isActive,
}: SettingsNavigationItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-4 px-4 py-4 min-h-[76px] text-left transition-all duration-200',
        'hover:bg-[var(--color-surface-hover)]',
        isActive && 'bg-[var(--color-primary-light)]',
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'h-11 w-11 rounded-xl flex items-center justify-center shrink-0',
          isActive
            ? 'bg-[var(--color-primary)] text-white'
            : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm font-semibold truncate',
            isActive
              ? 'text-[var(--color-primary-text)]'
              : 'text-[var(--color-text)]',
          )}
        >
          {label}
        </p>

        <p className="text-xs text-[var(--color-text-muted)] truncate mt-1">
          {description}
        </p>
      </div>

      {/* Chevron */}
      <ChevronRight
        className={cn(
          'h-5 w-5 shrink-0 transition-transform',
          isActive
            ? 'text-[var(--color-primary-text)]'
            : 'text-[var(--color-text-muted)]',
        )}
      />
    </button>
  );
}