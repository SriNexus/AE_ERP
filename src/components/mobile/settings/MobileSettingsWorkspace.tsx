/**
 * MobileSettingsWorkspace — Mobile Settings with route-driven list-tap-section navigation.
 *
 * P02: Uses URL params for section state. Section navigation is via navigate().
 * List view at /settings, detail view at /settings/:sectionId.
 *
 * Business logic is identical between Desktop and Mobile. Only layout differs.
 * No Company section — Company is managed in the Companies module.
 */

import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SETTINGS_SECTIONS, canonicalSettingsSectionId, type SettingsSectionId } from '../../../features/settings/config';
import { canViewSection } from '../../../features/settings/permissions';
import { SettingsSectionRenderer } from '../../settings/SettingsSectionRenderer';
import { SettingsNavigationItem } from '../../settings/SettingsNavigationItem';
import { cn } from '../../../utils/cn';

export default function MobileSettingsWorkspace() {
  const { sectionId } = useParams<{ sectionId: SettingsSectionId }>();
  const navigate = useNavigate();
  const isList = !sectionId;
  const canonicalSection = canonicalSettingsSectionId(sectionId);

  useEffect(() => {
    if (sectionId && canonicalSection && sectionId !== canonicalSection) {
      navigate(`/settings/${canonicalSection}`, { replace: true });
    }
  }, [canonicalSection, navigate, sectionId]);

  // List view
  if (isList) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--color-bg-canvas)] px-3 pt-3 pb-2 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-bold text-[var(--color-text)]">Settings</h1>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Configure your ERP system</p>
            </div>
          </div>
        </div>

        {/* Settings list */}
        <div className="flex-1 overflow-y-auto py-1 divide-y divide-[var(--color-border-subtle)]">
          {SETTINGS_SECTIONS.filter((section) => section.showInNavigation !== false && canViewSection(section.id)).map((section) => {
            const Icon = section.icon;
            return (
              <SettingsNavigationItem
                key={section.id}
                icon={Icon}
                label={section.label}
                description={section.description}
                isActive={false}
                onClick={() => navigate(`/settings/${section.id}`)}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // Section detail view
  const resolvedSection = sectionId && SETTINGS_SECTIONS.find((s) => s.id === sectionId)
    ? sectionId
    : null;

  if (!resolvedSection) {
    // Invalid section — redirect to settings list
    navigate('/settings', { replace: true });
    return null;
  }

  const config = SETTINGS_SECTIONS.find((s) => s.id === resolvedSection);

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
      {/* Header with back button */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg-canvas)] border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="flex items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Settings
          </button>
        </div>
        {config && (
          <div className="px-3 pb-3">
            <h1 className="text-sm font-bold text-[var(--color-text)]">{config.label}</h1>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{config.description}</p>
          </div>
        )}
      </div>

      {/* Section content */}
      <div className="flex-1 overflow-y-auto px-3 pb-6 pt-3">
        <SettingsSectionRenderer sectionId={resolvedSection} />
      </div>
    </div>
  );
}
