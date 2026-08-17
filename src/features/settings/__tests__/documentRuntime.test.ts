import { describe, expect, it } from 'vitest';
import { DEFAULT_DOCUMENT_SETTINGS } from '../defaults';
import { buildDocumentCounterId, formatDocumentNumber, normalizeDocumentSettings } from '../documentRuntime';
import { validateDocumentSettings } from '../validation';

describe('document settings runtime', () => {
  it('normalizes missing and invalid document settings safely', () => {
    const resolved = normalizeDocumentSettings(
      {
        piValidityDays: 0,
        defaultTerms: 'Custom terms',
        defaultNotes: 'Custom notes',
        invoicePrefix: 'inv-',
        quotationPrefix: 'qt',
        orderPrefix: 'ord',
        sequencePadding: 1,
      },
      {
        invoicePrefix: 'COMPINV',
        quotationPrefix: 'COMPQT',
        orderPrefix: 'COMPORD',
      },
    );

    expect(resolved.piValidityDays).toBe(DEFAULT_DOCUMENT_SETTINGS.piValidityDays);
    expect(resolved.sequencePadding).toBe(DEFAULT_DOCUMENT_SETTINGS.sequencePadding);
    expect(resolved.invoicePrefix).toBe('INV');
    expect(resolved.quotationPrefix).toBe('QT');
    expect(resolved.orderPrefix).toBe('ORD');
  });

  it('formats human-readable numbers and counter IDs deterministically', () => {
    expect(formatDocumentNumber('INV', 7, 4)).toBe('INV-0007');
    expect(formatDocumentNumber('qt-', 12, 3)).toBe('QT-012');
    expect(buildDocumentCounterId('company-1', 'invoice')).toBe('company-1_invoice');
    expect(buildDocumentCounterId('company-1', 'quotation')).toBe('company-1_quotation');
  });

  it('validates the real Documents section fields', () => {
    const result = validateDocumentSettings({
      piValidityDays: 30,
      defaultTerms: 'Net 30',
      defaultNotes: 'Thanks',
      invoicePrefix: 'ABCDEFGHIJKLM',
      quotationPrefix: 'QT',
      orderPrefix: 'ORD',
      sequencePadding: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toMatchObject({
      invoicePrefix: expect.any(String),
      sequencePadding: expect.any(String),
    });
  });
});
