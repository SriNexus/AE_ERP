/**
 * SettingsSidebar — Desktop left navigation for the Settings workspace.
 *
 * Renders all settings sections as a vertical nav list.
 * Active section highlighted with primary color indicator.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../../features/settings/config';
import { canViewSection } from '../../features/settings/permissions';
import { useShouldShowAppLauncher, assertAppLauncherAllowed } from '../../lib/appLauncherGuard';

interface SettingsSidebarProps {
  activeSection: SettingsSectionId;
  onSectionChange?: (id: SettingsSectionId) => void;
}

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  const navigate = useNavigate();
  const showAppLauncher = useShouldShowAppLauncher();

  // Guard: App Launcher ONLY renders in the Settings page
  if (!showAppLauncher) {
    if (process.env.NODE_ENV === 'development' || import.meta.env.DEV) {
      assertAppLauncherAllowed(window.location.pathname);
    }
    return null;
  }

  function handleClick(id: SettingsSectionId) {
    if (onSectionChange) {
      onSectionChange(id);
    } else {
      navigate(`/settings/${id}`);
    }
  }

  return (
    <nav className="m-0.5 w-64 shrink-0 space-y-1 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-sm">
      {SETTINGS_SECTIONS.filter((section) => section.showInNavigation !== false && canViewSection(section.id)).map((section) => {
        const Icon = section.icon;
        const isActive = activeSection === section.id;
        return (
          <button
            key={section.id}
            onClick={() => handleClick(section.id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
              isActive
                ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]',
            )}
          >
            <Icon className={cn('h-6 w-6 shrink-0', isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]')} />
            <div className="min-w-0 flex-1">
              <p className={cn('text-xs font-semibold truncate', isActive && 'text-[var(--color-primary-text)]')}>
                {section.label}
              </p>
              <p className={cn('mt-0.5 text-[10px] truncate leading-tight', isActive ? 'text-[var(--color-primary-text)]/70' : 'text-[var(--color-text-muted)]')}>
                {section.description}
              </p>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
