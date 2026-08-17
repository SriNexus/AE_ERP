/**
 * Settings Permissions — Permission enforcement for Settings sections.
 *
 * P01: Real permission gating implemented.
 *   - canViewSection() now checks the adminOnly config flag.
 *   - canEditSection() now checks adminOnly + existing canDo('edit', 'settings').
 *   - Respects personal vs company scope: personal sections (my-profile, notifications,
 *     appearance, security) are always editable by the owning user.
 *
 * Uses the existing canDo/permission system from src/lib/permissions.ts.
 */

import { canDo } from '../../lib/permissions';
import { type SettingsSectionId, SETTINGS_SECTIONS } from './config';
import { useAppStore } from '../../store/useAppStore';

/**
 * Permission actions for settings
 */
export type SettingsPermissionAction = 'view' | 'edit' | 'reset';

/**
 * Personal (user-scoped) sections that should be self-editable.
 */
const PERSONAL_SECTIONS: Set<SettingsSectionId> = new Set([
  'my-profile',
  'notifications',
  'appearance',
  'security',
]);

/**
 * Check whether a section is marked admin-only in its config.
 */
function isAdminOnlySection(section: SettingsSectionId): boolean {
  const config = SETTINGS_SECTIONS.find((s) => s.id === section);
  return config?.adminOnly === true;
}

/**
 * Get the current user's role from app store.
 */
function currentUser(): { id?: string; role?: string; isSuperAdmin?: boolean } | null {
  return useAppStore.getState().user;
}

/**
 * Check if the current user has permission to perform an action on a settings section.
 *
 * For adminOnly sections (theme-ui, email, whatsapp, sms, integrations):
 *   - edit/reset requires canDo('edit', 'settings') which maps to Admin role.
 *   - view requires canDo('view', 'settings') for adminOnly sections.
 *
 * For personal sections (my-profile, notifications, appearance, security):
 *   - Always viewable and editable by the owning user.
 *
 * For general/overview/about-erp/developer:
 *   - Viewable by all, editable only with canDo('edit', 'settings').
 */
export function canAccessSettings(
  section: SettingsSectionId,
  action: SettingsPermissionAction,
): boolean {
  const config = SETTINGS_SECTIONS.find((item) => item.id === section);
  if (config?.visible === false) return false;

  const user = currentUser();

  // Super admins bypass all checks
  if (user?.isSuperAdmin) return true;

  // Personal sections: self-service by default
  if (PERSONAL_SECTIONS.has(section)) {
    if (action === 'view') return true;
    // Self can edit their own personal settings
    return true;
  }

  // Admin-only sections: require canDo on the settings module
  if (isAdminOnlySection(section)) {
    if (action === 'view') return canDo('view', 'settings');
    return canDo('edit', 'settings');
  }

  // General, overview, about-erp, developer: viewable by all, edit requires permission
  if (action === 'view') return true;
  return canDo('edit', 'settings');
}

/**
 * Check if the current user can view a specific settings section.
 */
export function canViewSection(section: SettingsSectionId): boolean {
  return canAccessSettings(section, 'view');
}

/**
 * Check if the current user can edit a specific settings section.
 */
export function canEditSection(section: SettingsSectionId): boolean {
  return canAccessSettings(section, 'edit');
}

/**
 * Check if the current user can reset a specific settings section.
 */
export function canResetSection(section: SettingsSectionId): boolean {
  return canAccessSettings(section, 'reset');
}
