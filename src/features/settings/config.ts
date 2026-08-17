/**
 * Settings Configuration — single source of truth for all settings sections.
 *
 * Phase 2: Navigation & Layout only.
 * Every section defined here gets its own UI slot in both Desktop and Mobile.
 * Company is intentionally excluded — it lives in the Companies module.
 */

import {
  LayoutDashboard, Settings2, Sparkles, Bell, Shield,
  Users, Cog, FileText, Mail, MessageCircle, MessageSquare,
  Puzzle, HardDrive, ScrollText, Code, Info,
  type LucideIcon,
} from 'lucide-react';

export type SettingsSectionId =
  | 'overview'
  | 'general'
  | 'theme-ui'
  | 'theme-appearance'
  | 'appearance'
  | 'notifications'
  | 'security'
  | 'my-profile'
  | 'users-permissions'
  | 'automation'
  | 'documents'
  | 'email'
  | 'whatsapp'
  | 'sms'
  | 'integrations'
  | 'backup-restore'
  | 'audit-logs'
  | 'developer'
  | 'about-erp';

export interface SettingsSectionConfig {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Future: permission module required to view this section */
  permissionModule?: string;
  /** Future: whether this section is admin-only */
  adminOnly?: boolean;
  /** Source remains available while unfinished surfaces are omitted from all navigation. */
  visible?: boolean;
  /** Whether this route-backed section appears in desktop/mobile navigation. */
  showInNavigation?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSectionConfig[] = [
  { id: 'my-profile',        label: 'My Profile',          description: 'Personal settings & preferences',                    icon: Settings2 },
  { id: 'general',           label: 'General',             description: 'Language, timezone, date & number formats',          icon: Settings2 },
  { id: 'theme-appearance',  label: 'Theme & Appearance',  description: 'Company themes and personal display preferences',  icon: Sparkles },
  { id: 'notifications',     label: 'Notifications',       description: 'In-app alert preferences',                          icon: Bell },
  { id: 'users-permissions', label: 'Users & Permissions', description: 'Manage users, roles & access',                      icon: Users },
  { id: 'automation',        label: 'Automation',          description: 'Scheduler, triggers & workflows',                   icon: Cog },
  { id: 'documents',         label: 'Documents',           description: 'Templates, prefixes & signatures',                  icon: FileText },
  { id: 'email',             label: 'Email',               description: 'Gmail compose templates & defaults',                icon: Mail, adminOnly: true },
  { id: 'about-erp',         label: 'About ERP',           description: 'Version, license & system info',                    icon: Info },

  // Retained as route/persistence compatibility IDs; omitted from navigation.
  { id: 'overview',          label: 'Overview',            description: 'ERP system at a glance',                            icon: LayoutDashboard, showInNavigation: false },
  { id: 'theme-ui',          label: 'ERP Theme & UI',      description: 'Appearance customization, themes & styling',       icon: Sparkles, adminOnly: true, showInNavigation: false },
  { id: 'appearance',        label: 'Appearance',          description: 'Theme, density & accessibility',                   icon: Sparkles, showInNavigation: false },
  { id: 'security',          label: 'Security',            description: 'Password, sessions & account protection',          icon: Shield, visible: false },
  { id: 'whatsapp',          label: 'WhatsApp',            description: 'WhatsApp Business API integration',                icon: MessageCircle, adminOnly: true, visible: false },
  { id: 'sms',               label: 'SMS',                 description: 'SMS gateway & alert configuration',                icon: MessageSquare, adminOnly: true, visible: false },
  { id: 'integrations',      label: 'Integrations',        description: 'Connect third-party services',                     icon: Puzzle, adminOnly: true, visible: false },
  { id: 'backup-restore',    label: 'Backup & Restore',    description: 'Data export, import & recovery',                   icon: HardDrive, visible: false },
  { id: 'audit-logs',        label: 'Audit Logs',          description: 'User activity & compliance trail',                icon: ScrollText, visible: false },
  { id: 'developer',         label: 'Developer',           description: 'API tokens, webhooks & environment',              icon: Code, visible: false },
];
export const DEFAULT_SECTION: SettingsSectionId = 'my-profile';

export function canonicalSettingsSectionId(sectionId?: string): string | undefined {
  if (sectionId === 'overview') return 'my-profile';
  if (sectionId === 'theme-ui' || sectionId === 'appearance') return 'theme-appearance';
  return sectionId;
}
