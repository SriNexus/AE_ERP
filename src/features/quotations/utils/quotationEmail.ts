/**
 * quotationEmail — the quotation send-email flow, extracted verbatim from the
 * retired Quotations.tsx view popup (Phase: Quotation Workspace Migration) so
 * the /quotations/:id detail page can keep the Send Quotation capability the
 * popup used to provide — no duplicate email logic.
 *
 * buildEmailComposePayload / normalizeEmailSettings / openGmailCompose are the
 * exact settings/email runtime the rest of the ERP uses (features/settings/
 * emailRuntime.ts); only the quotation-specific variable mapping and customer
 * recipient resolution live here.
 */
import toast from 'react-hot-toast';
import { fmtCurrency } from '../../../lib/firestore';
import type { EmailTemplateKey } from '../../../features/settings/types';
import { buildEmailComposePayload, normalizeEmailSettings, openGmailCompose } from '../../../features/settings/emailRuntime';

export function quotationDisplayNumber(q: any): string {
  return String(q?.quotationNumber || q?.quoteNumber || q?.refNo || q?.id || '').trim() || '—';
}

function formatQuotationDate(value: any): string {
  if (!value) return '—';
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().toLocaleDateString('en-GB');
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000).toLocaleDateString('en-GB');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB');
}

export interface QuotationEmailContext {
  company: any;
  emailSettings: any;
}

export function sendQuotationEmail(
  quotation: any,
  customers: any[],
  context: QuotationEmailContext,
  templateKey: EmailTemplateKey = 'quotation',
): boolean {
  const customer = customers.find((entry: any) => entry.id === quotation.customerId);
  const recipient = quotation.customerEmail || quotation.email || customer?.email || customer?.businessEmail || '';
  const result = buildEmailComposePayload({
    templateKey,
    settings: normalizeEmailSettings(context.emailSettings),
    recipientEmail: recipient,
    variables: {
      customerName: quotation.customer || quotation.customerName || quotation.customerCompany || customer?.name || '',
      companyName: context.company?.name || '',
      quotationNumber: quotationDisplayNumber(quotation),
      quotationDate: formatQuotationDate(quotation.date || quotation.createdAt),
      validUntil: formatQuotationDate(quotation.validUntil),
      totalAmount: fmtCurrency(quotation.total || 0, context.company?.currencySymbol),
    },
  });
  if (!result.ok) {
    toast.error(result.error);
    return false;
  }
  const opened = openGmailCompose(result.payload.url);
  if (!opened) {
    toast.error('Could not open Gmail compose. Please allow pop-ups and try again.');
    return false;
  }
  toast.success('Email compose opened');
  return true;
}
