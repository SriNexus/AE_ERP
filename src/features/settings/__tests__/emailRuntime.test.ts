import { describe, expect, it } from 'vitest';
import { buildEmailComposePayload, DEFAULT_EMAIL_TEMPLATES, normalizeEmailSettings, validateEmailSettingsTemplates } from '../emailRuntime';

describe('emailRuntime', () => {
  it('normalizes template settings with defaults', () => {
    const normalized = normalizeEmailSettings({ provider: 'none' });
    expect(normalized.templates.quotation.subjectTemplate).toBe(DEFAULT_EMAIL_TEMPLATES.quotation.subjectTemplate);
    expect(normalized.templates.invoice.bodyTemplate).toContain('{{invoiceNumber}}');
  });

  it('rejects unsupported placeholders', () => {
    const errors = validateEmailSettingsTemplates({
      templates: {
        quotation: {
          enabled: true,
          displayName: 'Quotation',
          subjectTemplate: 'Quotation {{quotationNumber}}',
          bodyTemplate: 'Hello {{unsupported}}',
        },
        invoice: DEFAULT_EMAIL_TEMPLATES.invoice,
        order: DEFAULT_EMAIL_TEMPLATES.order,
        paymentReminder: DEFAULT_EMAIL_TEMPLATES.paymentReminder,
      },
    } as any);

    expect(errors['templates.quotation.bodyTemplate']).toContain('{{unsupported}}');
  });

  it('builds a Gmail compose URL with encoded multiline body', () => {
    const result = buildEmailComposePayload({
      templateKey: 'invoice',
      settings: normalizeEmailSettings({
        templates: DEFAULT_EMAIL_TEMPLATES,
      }),
      recipientEmail: 'customer@example.com',
      variables: {
        customerName: 'Sample Customer',
        companyName: 'Neozy',
        invoiceNumber: 'INV-1001',
        invoiceDate: '12/07/2026',
        dueDate: '19/07/2026',
        totalAmount: '₹ 10,000.00',
        orderNumber: 'ORD-1001',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.url).toContain('https://mail.google.com/mail/?view=cm&fs=1');
      expect(result.payload.url).toContain('to=customer%40example.com');
      expect(result.payload.url).toContain('su=Invoice%20INV-1001%20for%20Sample%20Customer');
      expect(result.payload.url).toContain('body=');
      expect(result.payload.body).toContain('\n');
    }
  });

  it('rejects invalid or disabled templates', () => {
    const disabled = buildEmailComposePayload({
      templateKey: 'quotation',
      settings: normalizeEmailSettings({
        templates: {
          ...DEFAULT_EMAIL_TEMPLATES,
          quotation: { ...DEFAULT_EMAIL_TEMPLATES.quotation, enabled: false },
        },
      }),
      recipientEmail: 'customer@example.com',
      variables: {
        customerName: 'Sample Customer',
        companyName: 'Neozy',
        quotationNumber: 'QT-1',
        quotationDate: '12/07/2026',
        validUntil: '19/07/2026',
        totalAmount: '₹ 10,000.00',
      },
    });

    expect(disabled.ok).toBe(false);

    const invalidRecipient = buildEmailComposePayload({
      templateKey: 'quotation',
      settings: normalizeEmailSettings({ templates: DEFAULT_EMAIL_TEMPLATES }),
      recipientEmail: 'not-an-email',
      variables: {
        customerName: 'Sample Customer',
        companyName: 'Neozy',
        quotationNumber: 'QT-1',
        quotationDate: '12/07/2026',
        validUntil: '19/07/2026',
        totalAmount: '₹ 10,000.00',
      },
    });

    expect(invalidRecipient.ok).toBe(false);
  });
});

