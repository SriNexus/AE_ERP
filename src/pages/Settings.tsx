/**
 * Settings.tsx — Enterprise App Settings workspace.
 *
 * P02: Route-driven settings architecture.
 * Active section is derived from URL params (/settings/:sectionId).
 * Sidebar navigation uses useNavigate() instead of local state callbacks.
 *
 * Architecture:
 *   - Left sidebar: all settings sections (no Company)
 *   - Content panel: rendered section content
 *   - PageHeader with breadcrumbs
 *   - Responsive: sidebar collapses on smaller screens
 *
 * All 18 sections are defined in SETTINGS_SECTIONS config.
 * Sections with real content: Overview, Branding, Notifications, Security, UsersPermissions.
 * All other sections render SettingsPlaceholder for future phases.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui/Card';
import { Settings, Menu, X } from 'lucide-react';
import { SettingsSidebar } from '../components/settings/SettingsSidebar';
import { SettingsContentLayout } from '../components/settings/SettingsContentLayout';
import { SettingsSectionRenderer } from '../components/settings/SettingsSectionRenderer';
import { SETTINGS_SECTIONS, type SettingsSectionId, DEFAULT_SECTION, canonicalSettingsSectionId } from '../features/settings/config';
import { canViewSection } from '../features/settings/permissions';
export default function SettingsPage() {
  const { sectionId } = useParams<{ sectionId: SettingsSectionId }>();
  const navigate = useNavigate();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Resolve the active section from URL, falling back to default
  const activeSection = resolveSection(sectionId);

  // If the URL section is invalid or unauthorized, redirect to default
  useEffect(() => {
    if (!sectionId || sectionId !== activeSection) {
      navigate(`/settings/${activeSection}`, { replace: true });
    }
  }, [sectionId, activeSection, navigate]);

  function handleSectionChange(id: SettingsSectionId) {
    setMobileSidebarOpen(false);
    navigate(`/settings/${id}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col pb-4">
      {/* Page Header */}
      <PageHeader
        title="Settings"
        subtitle="Configure your system"
        icon={<Settings className="h-5 w-5" />}
        breadcrumbs={['Home', 'Settings', 'App Settings']}
        actions={
          <button
            type="button"
            onClick={() => setMobileSidebarOpen((v) => !v)}
            className="lg:hidden inline-flex items-center justify-center h-8 w-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {mobileSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        }
      />

      {/* Main content area */}
      <div className="relative flex min-h-0 flex-1 gap-0 lg:gap-3">
        {/* Desktop sidebar */}
        <div className="hidden shrink-0 lg:block">
          <SettingsSidebar activeSection={activeSection} onSectionChange={handleSectionChange} />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileSidebarOpen && (
          <>
            <div
              className="lg:hidden fixed inset-0 z-30 bg-black/30"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="lg:hidden absolute left-0 top-0 z-40 h-full bg-[var(--color-bg-canvas)] border-r border-[var(--color-border)] shadow-xl transition-all duration-200">
              <SettingsSidebar activeSection={activeSection} onSectionChange={handleSectionChange} />
            </div>
          </>
        )}

        {/* Content panel */}
        <SettingsContentLayout>
          <div className="mx-auto w-full max-w-[1440px]">
            <SettingsSectionRenderer sectionId={activeSection} />
          </div>
        </SettingsContentLayout>
      </div>
    </div>
  );
}

/**
 * Resolve the section ID from URL params.
 * Returns DEFAULT_SECTION if the param is missing, invalid, or unauthorized.
 */
function resolveSection(sectionId?: string): SettingsSectionId {
  const canonicalSection = canonicalSettingsSectionId(sectionId);
  if (!canonicalSection) return DEFAULT_SECTION;
  const isValid = SETTINGS_SECTIONS.some((s) => s.id === canonicalSection);
  if (!isValid) return DEFAULT_SECTION;
  if (!canViewSection(canonicalSection as SettingsSectionId)) return DEFAULT_SECTION;
  return canonicalSection as SettingsSectionId;
}
