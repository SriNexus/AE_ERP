/**
 * Settings Validation — Architecture stubs for future settings validation.
 *
 * Phase 3: Structure only. All validators return valid=true.
 * Future phases will implement section-specific validation.
 *
 * Each section gets a validate function that returns
 * { valid: boolean; errors: Record<string, string> }.
 */

import type { SettingsSectionId } from './config';
import { normalizeDocumentSettings } from './documentRuntime';
import { normalizeEmailSettings, validateEmailSettingsTemplates } from './emailRuntime';

import { sanitizeIntegrationSettings, type IntegrationSectionId } from './integrationRuntime';
import { isBuiltInThemeId } from '../../theme/presetIds';

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

// ── Common validators (future use) ───────────────────────────

/** Validate a hex color string */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

/** Validate an email address */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Validate a URL */
export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Validate a time string (HH:mm) */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

/** Validate a cron expression (basic) */
export function isValidCronExpression(value: string): boolean {
  return /^(\S+\s){4}\S+$/.test(value.trim());
}

// ── Section validators ───────────────────────────────────────

export function validateGeneralSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!['en', 'hi', 'gu'].includes(String(data.language))) errors.language = 'Select a supported language';
  if (!['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(String(data.dateFormat))) errors.dateFormat = 'Select a supported date format';
  if (!['en-IN', 'en-US', 'en-GB'].includes(String(data.numberFormat))) errors.numberFormat = 'Select a supported number format';
  if (![0, 1, 6].includes(Number(data.firstDayOfWeek))) errors.firstDayOfWeek = 'Select a valid first day of week';
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(data.timezone) }).format(); } catch { errors.timezone = 'Select a valid IANA timezone'; }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateThemeSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  // Validate enum values for theme settings
  if (!isBuiltInThemeId(data.selectedTheme)) {
    errors.selectedTheme = 'Invalid theme selection';
  }
  const validRadius = ['none', 'small', 'medium', 'large'];
  if (data.borderRadius && typeof data.borderRadius === 'string' && !validRadius.includes(data.borderRadius)) {
    errors.borderRadius = 'Invalid border radius value';
  }
  // Validate custom chart palette colors if provided
  if (data.customChartPalette && Array.isArray(data.customChartPalette)) {
    data.customChartPalette.forEach((color, i) => {
      if (typeof color === 'string' && !isValidHexColor(color)) {
        errors[`customChartPalette[${i}]`] = `Invalid hex color: ${color}`;
      }
    });
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateProfileSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!String(data.displayName || '').trim()) errors.displayName = 'Display name is required';
  if (data.email && typeof data.email === "string" && !isValidEmail(data.email)) {
    errors.email = 'Invalid email address';
  }
  if (data.phone && typeof data.phone === 'string' && !/^[0-9+()\-.\s]{6,20}$/.test(data.phone.trim())) {
    errors.phone = 'Invalid phone number';
  }
  if (data.avatarUrl && typeof data.avatarUrl === 'string' && !isValidUrl(data.avatarUrl) && !data.avatarUrl.startsWith('data:')) {
    errors.avatarUrl = 'Select a valid avatar URL';
  }
  if (data.signatureUrl && typeof data.signatureUrl === 'string' && !isValidUrl(data.signatureUrl) && !data.signatureUrl.startsWith('data:')) {
    errors.signatureUrl = 'Select a valid signature URL';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateAppearanceSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!['light', 'dark', 'system'].includes(String(data.themeMode))) errors.themeMode = 'Select a valid theme mode';
  if (!['small', 'medium', 'large'].includes(String(data.fontSize))) errors.fontSize = 'Select a valid font size';
  if (data.sidebarBehavior && !['auto', 'click'].includes(String(data.sidebarBehavior))) errors.sidebarBehavior = 'Select a valid sidebar behavior';
  if (data.navigationStyle && !['sidebar', 'app-launcher'].includes(String(data.navigationStyle))) errors.navigationStyle = 'Select a valid navigation style';
  for (const field of ['highContrast', 'compactMode', 'reducedMotion', 'sidebarCollapsed']) if (typeof data[field] !== 'boolean') errors[field] = 'Must be enabled or disabled';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateNotificationSettings(_data: Record<string, unknown>): ValidationResult {
  return { valid: true, errors: {} };
}

export function validateSecuritySettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  if (data.sessionTimeoutMinutes && typeof data.sessionTimeoutMinutes === 'number') {
    if (data.sessionTimeoutMinutes < 1 || data.sessionTimeoutMinutes > 1440) {
      errors.sessionTimeoutMinutes = 'Session timeout must be between 1 and 1440 minutes';
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateAutomationSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  if (data.autoSettlementCron && typeof data.autoSettlementCron === 'string') {
    if (!isValidCronExpression(data.autoSettlementCron)) {
      errors.autoSettlementCron = 'Invalid cron expression';
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateDocumentSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  const normalized = normalizeDocumentSettings(data);

  const rawValidityDays = Number(data.piValidityDays);
  if (!Number.isInteger(rawValidityDays) || rawValidityDays < 1 || rawValidityDays > 3650) {
    errors.piValidityDays = 'PI validity must be a whole number between 1 and 3650';
  }

  const prefixPattern = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
  if (!prefixPattern.test(normalized.invoicePrefix)) {
    errors.invoicePrefix = 'Invoice prefix must use 1-12 letters, numbers, or hyphens';
  }
  if (!prefixPattern.test(normalized.quotationPrefix)) {
    errors.quotationPrefix = 'Quotation prefix must use 1-12 letters, numbers, or hyphens';
  }
  if (!prefixPattern.test(normalized.orderPrefix)) {
    errors.orderPrefix = 'Order prefix must use 1-12 letters, numbers, or hyphens';
  }

  const rawPadding = Number(data.sequencePadding);
  if (!Number.isInteger(rawPadding) || rawPadding < 2 || rawPadding > 8) {
    errors.sequencePadding = 'Sequence padding must be a whole number between 2 and 8';
  }

  if (typeof normalized.defaultTerms !== 'string') errors.defaultTerms = 'Default terms must be text';
  if (typeof normalized.defaultNotes !== 'string') errors.defaultNotes = 'Default notes must be text';

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateEmailSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  const normalized = normalizeEmailSettings(data as any);
  const provider = String(normalized.provider || 'none');
  if (!['smtp', 'sendgrid', 'ses', 'none'].includes(provider)) errors.provider = 'Select a supported email provider';
  if (normalized.fromAddress && typeof normalized.fromAddress === 'string' && !isValidEmail(normalized.fromAddress)) {
    errors.fromAddress = 'Invalid email address';
  }
  if (normalized.replyTo && typeof normalized.replyTo === 'string' && !isValidEmail(normalized.replyTo)) {
    errors.replyTo = 'Invalid reply-to email address';
  }
  if (normalized.smtpPort !== undefined && normalized.smtpPort !== null && (Number(normalized.smtpPort) < 1 || Number(normalized.smtpPort) > 65535)) {
    errors.smtpPort = 'SMTP port must be between 1 and 65535';
  }
  if (normalized.smtpHost !== undefined && typeof normalized.smtpHost !== 'string') errors.smtpHost = 'SMTP host must be text';
  if (normalized.smtpUser !== undefined && typeof normalized.smtpUser !== 'string') errors.smtpUser = 'SMTP username must be text';
  if (normalized.fromName !== undefined && typeof normalized.fromName !== 'string') errors.fromName = 'From name must be text';
  if (typeof normalized.smtpSecure !== 'boolean') errors.smtpSecure = 'SMTP secure flag must be true or false';
  if (normalized.hasSecretConfigured !== undefined && typeof normalized.hasSecretConfigured !== 'boolean') errors.hasSecretConfigured = 'Secret status must be true or false';
  Object.assign(errors, validateEmailSettingsTemplates(normalized));
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateWhatsAppSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  const normalized = sanitizeIntegrationSettings('whatsapp', data);
  const provider = String(normalized.provider || 'none');
  if (!['twilio', 'waba', 'none'].includes(provider)) errors.provider = 'Select a supported WhatsApp provider';
  if (normalized.phoneNumberId !== undefined && typeof normalized.phoneNumberId !== 'string') errors.phoneNumberId = 'Phone Number ID must be text';
  if (normalized.businessAccountId !== undefined && typeof normalized.businessAccountId !== 'string') errors.businessAccountId = 'Business Account ID must be text';
  if (normalized.templateNamespace !== undefined && typeof normalized.templateNamespace !== 'string') errors.templateNamespace = 'Template namespace must be text';
  if (normalized.hasSecretConfigured !== undefined && typeof normalized.hasSecretConfigured !== 'boolean') errors.hasSecretConfigured = 'Secret status must be true or false';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateSmsSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  const normalized = sanitizeIntegrationSettings('sms', data);
  const provider = String(normalized.provider || 'none');
  if (!['twilio', 'msg91', 'aws-sns', 'none'].includes(provider)) errors.provider = 'Select a supported SMS provider';
  if (normalized.senderId !== undefined && typeof normalized.senderId !== 'string') errors.senderId = 'Sender ID must be text';
  if (normalized.defaultCountryCode !== undefined && typeof normalized.defaultCountryCode === 'string' && !/^\+\d{1,4}$/.test(normalized.defaultCountryCode.trim())) {
    errors.defaultCountryCode = 'Country code must start with + followed by digits';
  }
  if (normalized.hasSecretConfigured !== undefined && typeof normalized.hasSecretConfigured !== 'boolean') errors.hasSecretConfigured = 'Secret status must be true or false';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateIntegrationSettings(data: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  const normalized = sanitizeIntegrationSettings('integrations', data);
  if (typeof normalized.razorpayEnabled !== 'boolean') errors.razorpayEnabled = 'Razorpay enabled must be true or false';
  if (typeof normalized.stripeEnabled !== 'boolean') errors.stripeEnabled = 'Stripe enabled must be true or false';
  if (normalized.razorpayKeyId !== undefined && typeof normalized.razorpayKeyId !== 'string') errors.razorpayKeyId = 'Razorpay key ID must be text';
  if (normalized.stripePublishableKey !== undefined && typeof normalized.stripePublishableKey !== 'string') errors.stripePublishableKey = 'Stripe publishable key must be text';
  if (normalized.googleAnalyticsId && typeof normalized.googleAnalyticsId === 'string') {
    if (!normalized.googleAnalyticsId.startsWith('G-') && !normalized.googleAnalyticsId.startsWith('UA-')) {
      errors.googleAnalyticsId = 'Google Analytics ID should start with G- or UA-';
    }
  }
  if (Array.isArray(normalized.customWebhooks)) {
    normalized.customWebhooks.forEach((webhook, index) => {
      if (!webhook || typeof webhook !== 'object') {
        errors[`customWebhooks[${index}]`] = 'Webhook must be an object';
        return;
      }
      const entry = webhook as Record<string, unknown>;
      if (typeof entry.url !== 'string' || !isValidUrl(entry.url)) {
        errors[`customWebhooks[${index}].url`] = 'Webhook URL must be valid';
      }
      if (!Array.isArray(entry.events) || entry.events.some((event) => typeof event !== 'string' || !String(event).trim())) {
        errors[`customWebhooks[${index}].events`] = 'Webhook events must be text';
      }
    });
  }
  if (normalized.hasSecretConfigured !== undefined && typeof normalized.hasSecretConfigured !== 'boolean') errors.hasSecretConfigured = 'Secret status must be true or false';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateBackupSettings(_data: Record<string, unknown>): ValidationResult {
  return { valid: true, errors: {} };
}

export function validateDeveloperSettings(_data: Record<string, unknown>): ValidationResult {
  return { valid: true, errors: {} };
}

// ── Section validator dispatcher ─────────────────────────────

export const SECTION_VALIDATORS: Record<string, (data: Record<string, unknown>) => ValidationResult> = {
  general: validateGeneralSettings,
  'theme-ui': validateThemeSettings,
  'my-profile': validateProfileSettings,
  appearance: validateAppearanceSettings,
  notifications: validateNotificationSettings,
  security: validateSecuritySettings,
  automation: validateAutomationSettings,
  documents: validateDocumentSettings,
  email: validateEmailSettings,
  whatsapp: validateWhatsAppSettings,
  sms: validateSmsSettings,
  integrations: validateIntegrationSettings,
  'backup-restore': validateBackupSettings,
  developer: validateDeveloperSettings,
};

/**
 * Validate settings for a given section.
 * Falls back to valid=true for sections without a validator.
 */
export function validateSectionSettings(
  section: SettingsSectionId,
  data: Record<string, unknown>,
): ValidationResult {
  const validator = SECTION_VALIDATORS[section];
  if (!validator) return { valid: true, errors: {} };
  return validator(data);
}
