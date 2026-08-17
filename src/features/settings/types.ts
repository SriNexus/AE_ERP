import type { BuiltInThemeId } from '../../theme/presetIds';
/**
 * Settings Types — Strongly-typed interfaces for every Settings section.
 *
 * Phase 3: Foundation. Fields are defined but may be empty.
 * Future phases will populate each section's data model.
 *
 * Every section returns a valid object (never undefined) via centralized defaults.
 */

// ── General ──────────────────────────────────────────────────
export interface GeneralSettings {
  language: string;           // 'en' | 'hi' | 'gu' ...
  timezone: string;           // 'Asia/Kolkata'
  dateFormat: string;         // 'DD/MM/YYYY' | 'MM/DD/YYYY'
  numberFormat: string;       // 'en-IN' | 'en-US'
  firstDayOfWeek: number;     // 0=Sunday, 1=Monday
}

// ── Theme UI Overrides (scalable structure) ───────────────────
export interface ThemeOverrides {
  colors: {
    primary?: string;
    accent?: string;
    success?: string;
    warning?: string;
    danger?: string;
    info?: string;
    sidebar?: string;
    background?: string;
    card?: string;
    border?: string;
    button?: string;
  };
}

// ── ERP Theme & UI ───────────────────────────────────────────
export interface ThemeSettings {
  selectedTheme: BuiltInThemeId;
  borderRadius: 'none' | 'small' | 'medium' | 'large';
  cardStyle: 'elevated' | 'flat' | 'border';
  sidebarStyle: 'default' | 'compact' | 'expanded';
  kpiStyle: 'bordered' | 'shadowed' | 'minimal';
  density: 'comfortable' | 'compact';
  animation: boolean;
  shadowStyle: 'subtle' | 'medium' | 'strong';
  font: 'inter' | 'system' | 'geist';
  chartPaletteId: 'default' | 'finance' | 'sales' | 'marketing' | 'inventory' | 'custom';
  customChartPalette?: string[];  // only used when chartPaletteId === 'custom'
  themeOverrides: ThemeOverrides;
}

// ── My Profile (legacy settings wrapper; canonical owner is users/{userId}) ──
export interface ProfileSettings {
  displayName: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  signatureUrl?: string;
}

// ── Appearance ───────────────────────────────────────────────
export interface AppearanceSettings {
  themeMode: 'light' | 'dark' | 'system';
  highContrast: boolean;
  compactMode: boolean;
  reducedMotion: boolean;
  /** @deprecated Replaced by sidebarBehavior. Field retained for backward compat. */
  sidebarCollapsed: boolean;
  sidebarBehavior: 'auto' | 'click';
  fontSize: 'small' | 'medium' | 'large';
  /**
   * Schema version for fontSize label semantics (see appearanceRuntime.ts).
   * Missing/older than the current schema means the value predates a label
   * rename and is migrated once on load. Always stamped to the current
   * schema on every save so migration never re-applies to current data.
   */
  fontSizeSchema?: number;
  /** Home logo click action. */
  navigationStyle: 'sidebar' | 'app-launcher';
}

// ── Notifications ────────────────────────────────────────────
export interface NotificationChannelPrefs {
  email: boolean;
  push: boolean;
  inApp: boolean;
}

export interface NotificationEventPref {
  enabled: boolean;
  channels: NotificationChannelPrefs;
}

export interface NotificationSettings {
  channels: NotificationChannelPrefs;
  events: Record<string, NotificationEventPref>;  // per-module events
  quietHoursEnabled: boolean;
  quietHoursStart: string;    // HH:mm
  quietHoursEnd: string;      // HH:mm
  digestFrequency: 'realtime' | 'hourly' | 'daily' | 'never';
}

// ── Security ─────────────────────────────────────────────────
export interface SecuritySettings {
  mfaEnabled: boolean;
  mfaMethod: 'app' | 'sms' | 'email';
  sessionTimeoutMinutes: number;
  loginNotifications: boolean;
  ipWhitelist: string[];
}

// ── Automation ───────────────────────────────────────────────
export interface AutomationSettings {
  schedulerEnabled: boolean;
  autoSettlementCron: string;  // cron expression
  autoTierEvaluation: boolean;
  tierEvaluationFrequency: 'daily' | 'weekly' | 'monthly';
  fraudDetectionEnabled: boolean;
  fraudScanFrequency: 'realtime' | 'daily';
}

// ── Documents ────────────────────────────────────────────────
export interface DocumentSettings {
  piValidityDays: number;
  defaultTerms: string;
  defaultNotes: string;
  invoicePrefix: string;
  quotationPrefix: string;
  orderPrefix: string;
  sequencePadding: number;
}

// ── Email templates ────────────────────────────────────────
export type EmailTemplateKey = 'quotation' | 'invoice' | 'order' | 'paymentReminder';

export interface EmailTemplateConfig {
  enabled: boolean;
  displayName: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

export type EmailTemplateSettings = Record<EmailTemplateKey, EmailTemplateConfig>;

// ── Email (public config only — templates live here; secrets never stored client-side) ─
export interface EmailSettings {
  provider: 'smtp' | 'sendgrid' | 'ses' | 'none';
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpSecure: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  templates: EmailTemplateSettings;
  /** True when a secret (SMTP password / SendGrid API key) has been configured via the secure backend */
  hasSecretConfigured?: boolean;
  /** ISO timestamp of the last secret update */
  secretLastUpdatedAt?: string;
  /** User ID who last rotated the secret */
  secretLastRotatedBy?: string;
}
// ── WhatsApp (public config only — secrets never stored client-side) ─
export interface WhatsAppSettings {
  provider: 'twilio' | 'waba' | 'none';
  phoneNumberId: string;
  businessAccountId: string;
  templateNamespace: string;
  /** True when a secret (WhatsApp API key / webhook secret) has been configured via the secure backend */
  hasSecretConfigured?: boolean;
  /** ISO timestamp of the last secret update */
  secretLastUpdatedAt?: string;
  /** User ID who last rotated the secret */
  secretLastRotatedBy?: string;
}

// ── SMS (public config only — secrets never stored client-side) ─
export interface SMSSettings {
  provider: 'twilio' | 'msg91' | 'aws-sns' | 'none';
  senderId: string;
  defaultCountryCode: string;
  /** True when a secret (SMS API key / secret) has been configured via the secure backend */
  hasSecretConfigured?: boolean;
  /** ISO timestamp of the last secret update */
  secretLastUpdatedAt?: string;
  /** User ID who last rotated the secret */
  secretLastRotatedBy?: string;
}

// ── Integrations (public config only — secrets never stored client-side) ─
export interface IntegrationSettings {
  razorpayEnabled: boolean;
  razorpayKeyId: string;
  stripeEnabled: boolean;
  stripePublishableKey: string;
  googleAnalyticsId: string;
  customWebhooks: Array<{
    url: string;
    events: string[];
  }>;
  /** True when secrets (Razorpay/stripe keys, webhook secrets) configured via secure backend */
  hasSecretConfigured?: boolean;
  /** ISO timestamp of the last secret update */
  secretLastUpdatedAt?: string;
  /** User ID who last rotated secrets */
  secretLastRotatedBy?: string;
}

// ── Backup ───────────────────────────────────────────────────
export interface BackupSettings {
  autoBackupEnabled: boolean;
  backupFrequency: 'daily' | 'weekly' | 'monthly';
  retentionDays: number;
  lastBackupAt: string;
  includeAttachments: boolean;
}

// ── Developer ────────────────────────────────────────────────
export interface DeveloperSettings {
  apiKeys: Array<{
    name: string;
    key: string;
    permissions: string[];
    createdAt: string;
    lastUsedAt: string;
  }>;
  webhookEndpoints: Array<{
    url: string;
    events: string[];
    secret: string;
    enabled: boolean;
  }>;
  debugMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ── Union type for any settings section ──────────────────────
export type SettingsSectionData =
  | GeneralSettings
  | ThemeSettings
  | ProfileSettings
  | AppearanceSettings
  | NotificationSettings
  | SecuritySettings
  | AutomationSettings
  | DocumentSettings
  | EmailSettings
  | WhatsAppSettings
  | SMSSettings
  | IntegrationSettings
  | BackupSettings
  | DeveloperSettings;

// ── Settings Firestore document wrapper ──────────────────────
export interface SettingsDocument<T = SettingsSectionData> {
  id: string;
  companyId: string;
  section: string;
  data: T;
  updatedAt: string;
  updatedBy: string;
}
