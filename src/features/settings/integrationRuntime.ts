import type { IntegrationSettings, SMSSettings, EmailSettings, WhatsAppSettings } from './types';

export type IntegrationSectionId = 'email' | 'whatsapp' | 'sms' | 'integrations';

const SECRET_KEYS: Record<IntegrationSectionId, string[]> = {
  email: ['smtpPass', 'sendgridApiKey'],
  whatsapp: ['apiKey', 'webhookSecret'],
  sms: ['apiKey', 'apiSecret'],
  integrations: ['razorpayKeySecret', 'stripeSecretKey'],
};

const COMMON_SAFE_KEYS = new Set([
  'provider',
  'hasSecretConfigured',
  'secretLastUpdatedAt',
  'secretLastRotatedBy',
]);

const EMAIL_KEYS = new Set<keyof EmailSettings>([
  'provider', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpSecure', 'fromAddress', 'fromName', 'replyTo',
  'hasSecretConfigured', 'secretLastUpdatedAt', 'secretLastRotatedBy',
]);

const WHATSAPP_KEYS = new Set<keyof WhatsAppSettings>([
  'provider', 'phoneNumberId', 'businessAccountId', 'templateNamespace',
  'hasSecretConfigured', 'secretLastUpdatedAt', 'secretLastRotatedBy',
]);

const SMS_KEYS = new Set<keyof SMSSettings>([
  'provider', 'senderId', 'defaultCountryCode',
  'hasSecretConfigured', 'secretLastUpdatedAt', 'secretLastRotatedBy',
]);

const INTEGRATION_KEYS = new Set<keyof IntegrationSettings>([
  'razorpayEnabled', 'razorpayKeyId', 'stripeEnabled', 'stripePublishableKey', 'googleAnalyticsId', 'customWebhooks',
  'hasSecretConfigured', 'secretLastUpdatedAt', 'secretLastRotatedBy',
]);

function sanitizeWebhookEntry(entry: unknown): { url: string; events: string[] } | null {
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Record<string, unknown>;
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
  const events = Array.isArray(candidate.events)
    ? candidate.events.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (!url) return null;
  return { url, events };
}

function removeKeys(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) next[key] = value;
  }
  return next;
}

function sanitizeEmail(data: Record<string, unknown>): Record<string, unknown> {
  const next = removeKeys(data, SECRET_KEYS.email);
  return Object.fromEntries(Object.entries(next).filter(([key]) => EMAIL_KEYS.has(key as keyof EmailSettings)));
}

function sanitizeWhatsApp(data: Record<string, unknown>): Record<string, unknown> {
  const next = removeKeys(data, SECRET_KEYS.whatsapp);
  return Object.fromEntries(Object.entries(next).filter(([key]) => WHATSAPP_KEYS.has(key as keyof WhatsAppSettings)));
}

function sanitizeSms(data: Record<string, unknown>): Record<string, unknown> {
  const next = removeKeys(data, SECRET_KEYS.sms);
  return Object.fromEntries(Object.entries(next).filter(([key]) => SMS_KEYS.has(key as keyof SMSSettings)));
}

function sanitizeIntegrations(data: Record<string, unknown>): Record<string, unknown> {
  const next = removeKeys(data, SECRET_KEYS.integrations);
  const allowed = Object.fromEntries(Object.entries(next).filter(([key]) => INTEGRATION_KEYS.has(key as keyof IntegrationSettings)));
  if (Array.isArray(allowed.customWebhooks)) {
    allowed.customWebhooks = allowed.customWebhooks
      .map((entry) => sanitizeWebhookEntry(entry))
      .filter((entry): entry is { url: string; events: string[] } => Boolean(entry));
  }
  return allowed;
}

export function sanitizeIntegrationSettings(section: IntegrationSectionId, data?: Record<string, unknown> | null): Record<string, unknown> {
  const source = data ? { ...data } : {};
  switch (section) {
    case 'email': return sanitizeEmail(source);
    case 'whatsapp': return sanitizeWhatsApp(source);
    case 'sms': return sanitizeSms(source);
    case 'integrations': return sanitizeIntegrations(source);
    default: return source;
  }
}

export function hasIntegrationSecretField(section: IntegrationSectionId, data: Record<string, unknown>): boolean {
  return SECRET_KEYS[section].some((key) => key in data);
}

export function getIntegrationSettingsKeys(section: IntegrationSectionId): string[] {
  return [...SECRET_KEYS[section], ...Array.from(COMMON_SAFE_KEYS)];
}
