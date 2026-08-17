import { describe, expect, it } from 'vitest';
import { generateQuotationHtml, type QuotationData } from '../../templates/documents/Quotation';
import { buildCompleteDemoPlan } from '../../../scripts/demo/datasets/complete.ts';

const validQuotation: QuotationData = {
  id: 'Q-1',
  date: '2026-07-13',
  customer: 'Fictional Customer',
  items: [{ product: 'Solar Module', qty: 1, price: 100, tax: 18 }],
  subtotal: 100,
  taxTotal: 18,
  total: 118,
  company: { name: 'Original ERP Company', address: 'Address', phone: '000', email: 'erp@example.invalid', gstin: 'TEST' },
};

describe('quotation document runtime contract', () => {
  it('reports a deliberate schema error instead of calling toUpperCase on a missing customer', () => {
    expect(() => generateQuotationHtml({ ...validQuotation, customer: undefined } as any)).toThrow('Quotation document requires a customer name.');
  });

  it('renders a valid customer and company contract', () => {
    const html = generateQuotationHtml(validQuotation);
    expect(html).toContain('FICTIONAL CUSTOMER');
    expect(html).toContain('ORIGINAL ERP COMPANY');
  });

  it('seeds every deterministic quotation with the display fields required by the live UI', () => {
    const quotations = buildCompleteDemoPlan('AUTH').documents.filter((document) => document.collection === 'quotations');
    expect(quotations).toHaveLength(11);
    expect(quotations.every((document) => typeof document.data.customer === 'string' && document.data.customer && document.data.date)).toBe(true);
  });
});