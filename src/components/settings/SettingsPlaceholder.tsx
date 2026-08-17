/**
 * SettingsPlaceholder — Placeholder content for future settings sections.
 *
 * Used by sections that haven't been implemented yet (General, Appearance,
 * Automation, Documents, Email, WhatsApp, SMS, Integrations, Backup & Restore,
 * Audit Logs, Developer, About ERP).
 *
 * Each section gets a consistent coming-soon layout with section name,
 * estimated future delivery phase, and icon.
 */

import React from 'react';
import { type LucideIcon } from 'lucide-react';

interface SettingsPlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Estimated phase when this section will be implemented */
  futurePhase?: string;
}

export function SettingsPlaceholder({ icon: Icon, title, description, futurePhase }: SettingsPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-6">
      <div className="h-16 w-16 rounded-2xl bg-[var(--color-primary-light)] flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-[var(--color-primary-text)]" />
      </div>
      <h3 className="text-base font-bold text-[var(--color-text)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--color-text-muted)] max-w-md mb-4">{description}</p>
      {futurePhase && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-bg-sunken)] border border-[var(--color-border)]">
          <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
            Coming in {futurePhase}
          </span>
        </div>
      )}
      {!futurePhase && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
            Future Phase
          </span>
        </div>
      )}
    </div>
  );
}
