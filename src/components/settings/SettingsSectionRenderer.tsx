/**
 * SettingsSectionRenderer — Maps section IDs to their rendered components.
 *
 * Sections with real content: Overview, Theme UI, Notifications, Security, UsersPermissions, My Profile, About ERP.
 * All other sections render a SettingsPlaceholder for future phases.
 */

import React from 'react';
import { Shield } from 'lucide-react';
import type { SettingsSectionId } from '../../features/settings/config';
import { SETTINGS_SECTIONS } from '../../features/settings/config';
import { canViewSection } from '../../features/settings/permissions';
import { OverviewSection } from './sections/OverviewSection';
import { ThemeUISection } from './sections/ThemeUISection';
import { ProfileSection } from './sections/ProfileSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { AutomationSection } from './sections/AutomationSection';
import { SecuritySection } from './sections/SecuritySection';
import { UsersPermissionsSection } from './sections/UsersPermissionsSection';
import { SettingsPlaceholder } from './SettingsPlaceholder';
import { GeneralSettingsSection } from './sections/GeneralSettingsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { DocumentsSection } from './sections/DocumentsSection';
import { EmailSection } from './sections/EmailSection';
import { ThemeAppearanceSection } from './sections/ThemeAppearanceSection';
import { AboutErpSection } from './sections/AboutErpSection';

interface SettingsSectionRendererProps {
  sectionId: SettingsSectionId;
}

export function SettingsSectionRenderer({ sectionId }: SettingsSectionRendererProps) {
  const config = SETTINGS_SECTIONS.find((s) => s.id === sectionId);
  if (!config) return null;

  // Permission gate: check section visibility before rendering
  if (!canViewSection(sectionId)) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Shield className="h-12 w-12 text-[var(--color-text-muted)] mb-4" />
        <p className="text-lg font-semibold text-[var(--color-text)]">Access Denied</p>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          You do not have permission to view this section.
        </p>
      </div>
    );
  }

  // Sections with real content
  switch (sectionId) {
    case 'overview':
      return <OverviewSection />;
    case 'general':
      return <GeneralSettingsSection />;
    case 'appearance':
      return <AppearanceSection />;
    case 'theme-ui':
      return <ThemeUISection />;
    case 'theme-appearance':
      return <ThemeAppearanceSection />;
    case 'documents':
      return <DocumentsSection />;
    case 'email':
      return <EmailSection />;
    case 'my-profile':
      return <ProfileSection />;
    case 'notifications':
      return <NotificationsSection />;
    case 'automation':
      return <AutomationSection />;
    case 'security':
      return <SecuritySection />;
    case 'about-erp':
      return <AboutErpSection />;
    case 'users-permissions':
      return <UsersPermissionsSection />;
    // Placeholder sections
    default:
      return (
        <SettingsPlaceholder
          icon={config.icon}
          title={config.label}
          description={config.description}
          futurePhase={getFuturePhase(sectionId)}
        />
      );
  }
}

function getFuturePhase(sectionId: SettingsSectionId): string {
  switch (sectionId) {
    case 'general': return 'Phase 5';
    case 'appearance': return 'Phase 5';
    case 'automation': return 'Phase 6';
    case 'email': return 'Phase 7';
    case 'whatsapp': return 'Phase 7';
    case 'sms': return 'Phase 7';
    case 'integrations': return 'Phase 8';
    case 'backup-restore': return 'Phase 9';
    case 'audit-logs': return 'Phase 10';
    case 'developer': return 'Phase 11';
    default: return '';
  }
}
