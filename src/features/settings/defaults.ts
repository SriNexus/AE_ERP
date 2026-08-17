/**
 * Settings Defaults — Centralized default values for every settings section.
 *
 * Every section always returns a valid object even when Firestore is empty.
 * No UI should ever receive undefined.
 *
 * These defaults are merged with any existing Firestore data so that
 * new settings fields added in future phases automatically get defaults.
 */

import type {
  GeneralSettings,
  ThemeSettings,
  ProfileSettings,
  AppearanceSettings,
  NotificationSettings,
  NotificationChannelPrefs,
  NotificationEventPref,
  SecuritySettings,
  AutomationSettings,
  DocumentSettings,
  EmailSettings,
  WhatsAppSettings,
  SMSSettings,
  IntegrationSettings,
  BackupSettings,
  DeveloperSettings,
} from './types';
import { DEFAULT_EMAIL_TEMPLATES } from './emailRuntime';
import { DEFAULT_BUILT_IN_THEME_ID } from '../../theme/presetIds';
import { APPEARANCE_FONT_SIZE_SCHEMA } from './appearanceRuntime';

// ── Notification channel defaults ────────────────────────────
export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannelPrefs = {
  email: false,
  push: true,
  inApp: true,
};

export const DEFAULT_NOTIFICATION_EVENT: NotificationEventPref = {
  enabled: true,
  channels: { ...DEFAULT_NOTIFICATION_CHANNELS },
};

// ── General ──────────────────────────────────────────────────
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  language: 'en',
  timezone: 'Asia/Kolkata',
  dateFormat: 'DD/MM/YYYY',
  numberFormat: 'en-IN',
  firstDayOfWeek: 1,      // Monday
};

// ── ERP Theme & UI ──────────────────────────────────────────
export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  selectedTheme: DEFAULT_BUILT_IN_THEME_ID,
  borderRadius: 'medium',
  cardStyle: 'elevated',
  sidebarStyle: 'default',
  kpiStyle: 'bordered',
  density: 'comfortable',
  animation: true,
  shadowStyle: 'medium',
  font: 'inter',
  chartPaletteId: 'default',
  customChartPalette: undefined,
  themeOverrides: {
    colors: {},
  },
};

// ── My Profile ───────────────────────────────────────────────
export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  displayName: '',
  email: '',
  phone: '',
  avatarUrl: undefined,
  signatureUrl: undefined,
};

// ── Appearance ───────────────────────────────────────────────
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  themeMode: 'system',
  highContrast: false,
  compactMode: false,
  reducedMotion: false,
  sidebarCollapsed: false,
  sidebarBehavior: 'auto',
  fontSize: 'medium',       // 1.0625 scale = 17px default
  fontSizeSchema: APPEARANCE_FONT_SIZE_SCHEMA,
  navigationStyle: 'sidebar',
};

// ── Notifications ────────────────────────────────────────────
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  channels: { ...DEFAULT_NOTIFICATION_CHANNELS },
  events: {},
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  digestFrequency: 'realtime',
};

// ── Security ─────────────────────────────────────────────────
export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  mfaEnabled: false,
  mfaMethod: 'app',
  sessionTimeoutMinutes: 60,
  loginNotifications: true,
  ipWhitelist: [],
};

// ── Automation ───────────────────────────────────────────────
export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  schedulerEnabled: false,
  autoSettlementCron: '0 0 * * *',    // daily midnight
  autoTierEvaluation: false,
  tierEvaluationFrequency: 'monthly',
  fraudDetectionEnabled: false,
  fraudScanFrequency: 'daily',
};

// ── Documents ────────────────────────────────────────────────
export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  piValidityDays: 7,
  defaultTerms: '',
  defaultNotes: '',
  invoicePrefix: 'INV',
  quotationPrefix: 'QT',
  orderPrefix: 'ORD',
  sequencePadding: 4,
};

// ── Email (public config only — secrets never stored client-side) ─
export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  provider: 'none',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpSecure: false,
  fromAddress: '',
  fromName: '',
  replyTo: '',
  templates: DEFAULT_EMAIL_TEMPLATES,
  hasSecretConfigured: undefined,
  secretLastUpdatedAt: undefined,
  secretLastRotatedBy: undefined,
};

// ── WhatsApp (public config only — secrets never stored client-side) ─
export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  provider: 'none',
  phoneNumberId: '',
  businessAccountId: '',
  templateNamespace: '',
  hasSecretConfigured: undefined,
  secretLastUpdatedAt: undefined,
  secretLastRotatedBy: undefined,
};

// ── SMS (public config only — secrets never stored client-side) ─
export const DEFAULT_SMS_SETTINGS: SMSSettings = {
  provider: 'none',
  senderId: '',
  defaultCountryCode: '+91',
  hasSecretConfigured: undefined,
  secretLastUpdatedAt: undefined,
  secretLastRotatedBy: undefined,
};

// ── Integrations (public config only — secrets never stored client-side) ─
export const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  razorpayEnabled: false,
  razorpayKeyId: '',
  stripeEnabled: false,
  stripePublishableKey: '',
  googleAnalyticsId: '',
  customWebhooks: [],
  hasSecretConfigured: undefined,
  secretLastUpdatedAt: undefined,
  secretLastRotatedBy: undefined,
};

// ── Backup ───────────────────────────────────────────────────
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoBackupEnabled: false,
  backupFrequency: 'daily',
  retentionDays: 30,
  lastBackupAt: '',
  includeAttachments: true,
};

// ── Developer ────────────────────────────────────────────────
export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = {
  apiKeys: [],
  webhookEndpoints: [],
  debugMode: false,
  logLevel: 'info',
};

import type { SettingsSectionId } from './config';

// ── Section resolver — maps section ID to its defaults ───────
export const SETTINGS_DEFAULTS: Record<SettingsSectionId, Record<string, unknown>> = {
  overview: {},
  'users-permissions': {},
  general:              DEFAULT_GENERAL_SETTINGS as unknown as Record<string, unknown>,
  'theme-ui':           DEFAULT_THEME_SETTINGS as unknown as Record<string, unknown>,
  'theme-appearance':   {}, // composition-only; child domains retain their own defaults
  'my-profile':         DEFAULT_PROFILE_SETTINGS as unknown as Record<string, unknown>,
  appearance:           DEFAULT_APPEARANCE_SETTINGS as unknown as Record<string, unknown>,
  notifications:        DEFAULT_NOTIFICATION_SETTINGS as unknown as Record<string, unknown>,
  security:             DEFAULT_SECURITY_SETTINGS as unknown as Record<string, unknown>,
  automation:           DEFAULT_AUTOMATION_SETTINGS as unknown as Record<string, unknown>,
  documents:            DEFAULT_DOCUMENT_SETTINGS as unknown as Record<string, unknown>,
  email:                DEFAULT_EMAIL_SETTINGS as unknown as Record<string, unknown>,
  whatsapp:             DEFAULT_WHATSAPP_SETTINGS as unknown as Record<string, unknown>,
  sms:                  DEFAULT_SMS_SETTINGS as unknown as Record<string, unknown>,
  integrations:         DEFAULT_INTEGRATION_SETTINGS as unknown as Record<string, unknown>,
  'backup-restore':     DEFAULT_BACKUP_SETTINGS as unknown as Record<string, unknown>,
  'audit-logs':         {},
  developer:            DEFAULT_DEVELOPER_SETTINGS as unknown as Record<string, unknown>,
  'about-erp':          {},
};

/**
 * Get default values for a given settings section.
 * Always returns a valid object (never undefined).
 */
export function getDefaultSettings(section: SettingsSectionId): Record<string, unknown> {
  return SETTINGS_DEFAULTS[section] ?? {};
}
