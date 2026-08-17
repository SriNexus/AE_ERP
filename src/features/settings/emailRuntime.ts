import type { EmailSettings, EmailTemplateConfig, EmailTemplateKey, EmailTemplateSettings } from './types';
import { useAppStore } from '../../store/useAppStore';
import { isDemoCapabilityAllowed } from '../../lib/demoCapabilityPolicy';

export interface EmailTemplateDefinition {
  key: EmailTemplateKey;
  label: string;
  description: string;
  supportedVariables: readonly string[];
  sampleVariables: Record<string, string>;
  defaultSubjectTemplate: string;
  defaultBodyTemplate: string;
}

export interface EmailComposePayload {
  recipientEmail: string;
  subject: string;
  body: string;
  url: string;
  templateKey: EmailTemplateKey;
  template: EmailTemplateConfig;
}

export interface EmailComposeRequest {
  templateKey: EmailTemplateKey;
  settings: EmailSettings;
  recipientEmail: string;
  variables: Record<string, string | number | null | undefined>;
}

export interface EmailComposeFailure {
  ok: false;
  error: string;
  unsupportedVariables?: string[];
}

export interface EmailComposeSuccess {
  ok: true;
  payload: EmailComposePayload;
}

export type EmailComposeResult = EmailComposeSuccess | EmailComposeFailure;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeTemplate(template: Partial<EmailTemplateConfig> | undefined, fallback: EmailTemplateDefinition): EmailTemplateConfig {
  return {
    enabled: template?.enabled ?? true,
    displayName: text(template?.displayName) || fallback.label,
    subjectTemplate: text(template?.subjectTemplate) || fallback.defaultSubjectTemplate,
    bodyTemplate: text(template?.bodyTemplate) || fallback.defaultBodyTemplate,
  };
}

export const EMAIL_TEMPLATE_DEFINITIONS: Record<EmailTemplateKey, EmailTemplateDefinition> = {
  quotation: {
    key: 'quotation',
    label: 'Quotation',
    description: 'Compose a quotation follow-up in Gmail.',
    supportedVariables: ['customerName', 'companyName', 'quotationNumber', 'quotationDate', 'validUntil', 'totalAmount'],
    sampleVariables: {
      customerName: 'Sample Customer',
      companyName: 'Neozy',
      quotationNumber: 'QT-0001',
      quotationDate: '12/07/2026',
      validUntil: '19/07/2026',
      totalAmount: '₹ 1,25,000.00',
    },
    defaultSubjectTemplate: 'Quotation {{quotationNumber}} for {{customerName}}',
    defaultBodyTemplate: 'Hello {{customerName}},\n\nPlease find your quotation {{quotationNumber}} dated {{quotationDate}}.\nThe total amount is {{totalAmount}} and it remains valid until {{validUntil}}.\n\nRegards,\n{{companyName}}',
  },
  invoice: {
    key: 'invoice',
    label: 'Invoice / Proforma Invoice',
    description: 'Compose an invoice email in Gmail.',
    supportedVariables: ['customerName', 'companyName', 'invoiceNumber', 'invoiceDate', 'dueDate', 'totalAmount', 'orderNumber'],
    sampleVariables: {
      customerName: 'Sample Customer',
      companyName: 'Neozy',
      invoiceNumber: 'INV-0001',
      invoiceDate: '12/07/2026',
      dueDate: '19/07/2026',
      totalAmount: '₹ 1,25,000.00',
      orderNumber: 'ORD-0001',
    },
    defaultSubjectTemplate: 'Invoice {{invoiceNumber}} for {{customerName}}',
    defaultBodyTemplate: 'Hello {{customerName}},\n\nYour invoice {{invoiceNumber}} dated {{invoiceDate}} is attached for reference.\nThe total amount due is {{totalAmount}} and the due date is {{dueDate}}.\n\nRegards,\n{{companyName}}',
  },
  order: {
    key: 'order',
    label: 'Order',
    description: 'Compose an order confirmation in Gmail.',
    supportedVariables: ['customerName', 'companyName', 'orderNumber', 'orderDate', 'deliveryDate', 'totalAmount'],
    sampleVariables: {
      customerName: 'Sample Customer',
      companyName: 'Neozy',
      orderNumber: 'ORD-0001',
      orderDate: '12/07/2026',
      deliveryDate: '19/07/2026',
      totalAmount: '₹ 1,25,000.00',
    },
    defaultSubjectTemplate: 'Order {{orderNumber}} for {{customerName}}',
    defaultBodyTemplate: 'Hello {{customerName}},\n\nYour order {{orderNumber}} dated {{orderDate}} is ready for review.\nThe total amount is {{totalAmount}} and the delivery date is {{deliveryDate}}.\n\nRegards,\n{{companyName}}',
  },
  paymentReminder: {
    key: 'paymentReminder',
    label: 'Payment Reminder',
    description: 'Compose a payment reminder in Gmail.',
    supportedVariables: ['customerName', 'companyName', 'invoiceNumber', 'invoiceDate', 'dueDate', 'totalAmount'],
    sampleVariables: {
      customerName: 'Sample Customer',
      companyName: 'Neozy',
      invoiceNumber: 'INV-0001',
      invoiceDate: '12/07/2026',
      dueDate: '19/07/2026',
      totalAmount: '₹ 1,25,000.00',
    },
    defaultSubjectTemplate: 'Payment reminder for invoice {{invoiceNumber}}',
    defaultBodyTemplate: 'Hello {{customerName}},\n\nThis is a friendly reminder that invoice {{invoiceNumber}} dated {{invoiceDate}} for {{totalAmount}} is due on {{dueDate}}.\n\nRegards,\n{{companyName}}',
  },
};

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplateSettings = {
  quotation: normalizeTemplate(undefined, EMAIL_TEMPLATE_DEFINITIONS.quotation),
  invoice: normalizeTemplate(undefined, EMAIL_TEMPLATE_DEFINITIONS.invoice),
  order: normalizeTemplate(undefined, EMAIL_TEMPLATE_DEFINITIONS.order),
  paymentReminder: normalizeTemplate(undefined, EMAIL_TEMPLATE_DEFINITIONS.paymentReminder),
};

export function normalizeEmailTemplates(input?: Partial<EmailTemplateSettings> | null): EmailTemplateSettings {
  return {
    quotation: normalizeTemplate(input?.quotation, EMAIL_TEMPLATE_DEFINITIONS.quotation),
    invoice: normalizeTemplate(input?.invoice, EMAIL_TEMPLATE_DEFINITIONS.invoice),
    order: normalizeTemplate(input?.order, EMAIL_TEMPLATE_DEFINITIONS.order),
    paymentReminder: normalizeTemplate(input?.paymentReminder, EMAIL_TEMPLATE_DEFINITIONS.paymentReminder),
  };
}

export function normalizeEmailSettings(settings?: Partial<EmailSettings> | null): EmailSettings {
  return {
    provider: settings?.provider ?? 'none',
    smtpHost: text(settings?.smtpHost),
    smtpPort: Number(settings?.smtpPort) || 587,
    smtpUser: text(settings?.smtpUser),
    smtpSecure: settings?.smtpSecure ?? false,
    fromAddress: text(settings?.fromAddress),
    fromName: text(settings?.fromName),
    replyTo: text(settings?.replyTo),
    templates: normalizeEmailTemplates(settings?.templates ?? undefined),
    hasSecretConfigured: settings?.hasSecretConfigured,
    secretLastUpdatedAt: settings?.secretLastUpdatedAt,
    secretLastRotatedBy: settings?.secretLastRotatedBy,
  };
}

function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{\{\s*([\w.-]+)\s*\}\}/g) ?? [];
  return matches.map((match) => match.replace(/\{\{\s*|\s*\}\}/g, ''));
}

export function getUnsupportedTemplateVariables(template: string, allowedVariables: readonly string[]): string[] {
  const allowed = new Set(allowedVariables);
  return Array.from(new Set(extractPlaceholders(template).filter((name) => !allowed.has(name))));
}

export function interpolateEmailTemplate(template: string, variables: Record<string, string | number | null | undefined>): { text: string; unresolved: string[] } {
  const unresolved = new Set<string>();
  const textValue = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) {
      unresolved.add(String(key));
      return match;
    }
    const value = variables[String(key)];
    return value === null || value === undefined ? '' : String(value);
  });
  return { text: textValue, unresolved: Array.from(unresolved) };
}

export function validateEmailSettingsTemplates(settings: Partial<EmailSettings> | null | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  const normalized = normalizeEmailSettings(settings);
  for (const key of Object.keys(EMAIL_TEMPLATE_DEFINITIONS) as EmailTemplateKey[]) {
    const template = normalized.templates[key];
    const def = EMAIL_TEMPLATE_DEFINITIONS[key];
    if (typeof template.enabled !== 'boolean') errors[`templates.${key}.enabled`] = 'Template enabled flag must be true or false';
    if (!template.displayName.trim()) errors[`templates.${key}.displayName`] = 'Template name is required';
    if (!template.subjectTemplate.trim()) errors[`templates.${key}.subjectTemplate`] = 'Subject template is required';
    if (!template.bodyTemplate.trim()) errors[`templates.${key}.bodyTemplate`] = 'Body template is required';

    const subjectUnsupported = getUnsupportedTemplateVariables(template.subjectTemplate, def.supportedVariables);
    if (subjectUnsupported.length) errors[`templates.${key}.subjectTemplate`] = `Unsupported placeholders: ${subjectUnsupported.map((item) => `{{${item}}}`).join(', ')}`;
    const bodyUnsupported = getUnsupportedTemplateVariables(template.bodyTemplate, def.supportedVariables);
    if (bodyUnsupported.length) errors[`templates.${key}.bodyTemplate`] = `Unsupported placeholders: ${bodyUnsupported.map((item) => `{{${item}}}`).join(', ')}`;
  }
  return errors;
}

export function buildGmailComposeUrl(recipientEmail: string, subject: string, body: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildEmailComposePayload(request: EmailComposeRequest): EmailComposeResult {
  const settings = normalizeEmailSettings(request.settings);
  const template = settings.templates[request.templateKey];
  if (!template) {
    return { ok: false, error: 'Email template could not be found.' };
  }
  if (!template.enabled) {
    return { ok: false, error: `${template.displayName} is disabled in Email settings.` };
  }
  const recipientEmail = text(request.recipientEmail);
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return { ok: false, error: 'A valid recipient email address is required.' };
  }

  const definition = EMAIL_TEMPLATE_DEFINITIONS[request.templateKey];
  const subjectValidation = interpolateEmailTemplate(template.subjectTemplate, request.variables);
  const bodyValidation = interpolateEmailTemplate(template.bodyTemplate, request.variables);
  const unsupported = [
    ...getUnsupportedTemplateVariables(template.subjectTemplate, definition.supportedVariables),
    ...getUnsupportedTemplateVariables(template.bodyTemplate, definition.supportedVariables),
  ];
  if (unsupported.length) {
    return { ok: false, error: `Unsupported placeholders: ${Array.from(new Set(unsupported)).map((item) => `{{${item}}}`).join(', ')}`, unsupportedVariables: Array.from(new Set(unsupported)) };
  }
  if (subjectValidation.unresolved.length || bodyValidation.unresolved.length) {
    const unresolved = Array.from(new Set([...subjectValidation.unresolved, ...bodyValidation.unresolved]));
    return { ok: false, error: `Missing values for: ${unresolved.map((item) => `{{${item}}}`).join(', ')}` };
  }

  const subject = subjectValidation.text.replace(/\s+/g, ' ').trim();
  const body = bodyValidation.text.replace(/\r?\n/g, '\n').trim();
  return {
    ok: true,
    payload: {
      recipientEmail,
      subject,
      body,
      url: buildGmailComposeUrl(recipientEmail, subject, body),
      templateKey: request.templateKey,
      template,
    },
  };
}

export function openGmailCompose(url: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!isDemoCapabilityAllowed(useAppStore.getState().user?.companyId, 'external-side-effect')) return false;
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (win) {
    try { win.opener = null; } catch {
      // Ignore browsers that block the setter.
    }
    return true;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
