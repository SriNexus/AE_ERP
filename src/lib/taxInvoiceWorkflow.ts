import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { COLLECTIONS, db } from './firebase';
import { createDocWithId, getOne, updateDocById } from './firestore';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers, resolveNotificationCompanyId } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';
import { getFiscalYearLabel } from './gstCalculation';
import { calculateGstBreakdown } from './gstCalculation';
import type { CompanyConfig } from '../config/company';
import type { TaxInvoiceFormState, TaxInvoiceRecord } from '../features/tax-invoices/types';

function resolveCompany(stateCompany?: CompanyConfig | null) {
  const store = useAppStore.getState();
  return stateCompany || store.company || store.globalCompany || store.company;
}

function resolveTaxSeries(company: CompanyConfig, invoiceDate: string) {
  const fiscalYear = getFiscalYearLabel(new Date(invoiceDate), company.fiscalYearStart || '04-01');
  const companyCode = String(company.companyCode || company.shortName || company.name || 'COMP').trim().toUpperCase();
  const serialId = `tax_invoices:${company.id}:${fiscalYear}`;
  const series = `TINV-${companyCode}-${fiscalYear}`;
  return { fiscalYear, companyCode, serialId, series };
}

async function allocateTaxInvoiceNumber(company: CompanyConfig, invoiceDate: string) {
  const { fiscalYear, companyCode, serialId, series } = resolveTaxSeries(company, invoiceDate);
  const nextNumber = await runTransaction(db, async (transaction) => {
    const serialRef = doc(db, COLLECTIONS.SERIAL_NUMBERS, serialId);
    const snap = await transaction.get(serialRef);
    const currentNumber = snap.exists() ? Number((snap.data() as { currentNumber?: unknown }).currentNumber) || 0 : 0;
    const next = currentNumber + 1;
    transaction.set(serialRef, {
      id: serialId,
      companyId: company.id,
      module: 'tax_invoices',
      series,
      currentNumber: next,
      updatedAt: serverTimestamp(),
      createdAt: snap.exists() ? (snap.data() as { createdAt?: unknown }).createdAt || serverTimestamp() : serverTimestamp(),
      isDeleted: false,
    }, { merge: true });
    return next;
  });

  const padded = String(nextNumber).padStart(4, '0');
  const invoiceNumber = `${series}-${padded}`;
  return { invoiceNumber, serialNumber: nextNumber, fiscalYear, companyCode };
}

function buildPersistedRecord(form: TaxInvoiceFormState, company: CompanyConfig, invoiceNumber: string, serialNumber: number, fiscalYear: string): TaxInvoiceRecord {
  const breakdown = calculateGstBreakdown(form.items, { gstin: form.companyGst, state: form.companyState }, { gstin: form.customerGst, state: form.customerState });
  return {
    id: invoiceNumber,
    companyId: company.id,
    invoiceNumber,
    serialNumber,
    fiscalYear,
    sourceType: form.sourceType,
    sourceId: form.sourceId,
    orderId: form.orderId,
    sourcePiId: form.sourcePiId,
    date: form.date,
    status: form.status,
    companyName: form.companyName || company.shortName || company.name,
    companyGst: form.companyGst || company.gst || '',
    companyState: form.companyState || company.state || '',
    customerId: form.customerId,
    customerName: form.customerName,
    customerGst: form.customerGst,
    customerState: form.customerState,
    placeOfSupply: breakdown.placeOfSupply,
    items: breakdown.lines,
    subtotal: breakdown.subtotal,
    cgst: breakdown.cgst,
    sgst: breakdown.sgst,
    igst: breakdown.igst,
    totalTax: breakdown.totalTax,
    total: breakdown.grandTotal,
    notes: form.notes || '',
    issuedAt: form.issuedAt,
    cancelledAt: form.cancelledAt,
    cancellationReason: form.cancellationReason,
  };
}

function validateDraft(form: TaxInvoiceFormState) {
  if (!form.sourceId) throw new Error('Source document is required');
  if (!form.customerName) throw new Error('Customer is required');
  if (!form.companyName) throw new Error('Company is required');
  if (!form.companyGst && !form.companyState) throw new Error('Company GST/state is required');
  if (!form.customerGst && !form.customerState) throw new Error('Customer GST/state is required');
  if (!Array.isArray(form.items) || form.items.length === 0) throw new Error('Add at least one line item');
}

export async function createTaxInvoiceDraft(form: TaxInvoiceFormState): Promise<TaxInvoiceRecord> {
  validateDraft(form);
  const state = useAppStore.getState();
  const company = resolveCompany(state.company);
  if (!company) throw new Error('Company configuration is required');
  const invoiceDate = form.date || new Date().toISOString().split('T')[0];
  const existingInvoiceNumber = String(form.invoiceNumber || '').trim();
  const serialMeta = existingInvoiceNumber
    ? {
        invoiceNumber: existingInvoiceNumber,
        serialNumber: Number(form.serialNumber || 0) || 0,
        fiscalYear: form.fiscalYear || getFiscalYearLabel(new Date(invoiceDate), company.fiscalYearStart || '04-01'),
      }
    : await allocateTaxInvoiceNumber(company, invoiceDate);

  const payload = buildPersistedRecord(
    { ...form, date: invoiceDate, status: 'Draft' },
    company,
    serialMeta.invoiceNumber,
    serialMeta.serialNumber,
    serialMeta.fiscalYear
  );

  await createDocWithId(COLLECTIONS.TAX_INVOICES, serialMeta.invoiceNumber, {
    ...payload,
    createdBy: state.user?.id || 'system',
    updatedBy: state.user?.id || 'system',
    isDeleted: false,
  } as any);

  // Phase 3B: Propagate caseId from source document (PI) to tax invoice
  if (form.sourcePiId) {
    void propagateCaseIdFromChain('tax_invoices', serialMeta.invoiceNumber);
  }

  await logActivity('TaxInvoices', 'Created Draft', serialMeta.invoiceNumber, {
    entityName: payload.invoiceNumber,
    actionLabel: 'Created tax invoice draft',
    orderId: form.orderId,
    sourcePiId: form.sourcePiId,
  });

  return { ...payload, companyId: company.id, createdBy: state.user?.id || 'system', updatedBy: state.user?.id || 'system', isDeleted: false } as TaxInvoiceRecord;
}

export async function updateTaxInvoiceDraft(invoiceId: string, form: TaxInvoiceFormState): Promise<TaxInvoiceRecord> {
  validateDraft(form);
  const state = useAppStore.getState();
  const company = resolveCompany(state.company);
  if (!company) throw new Error('Company configuration is required');

  const existing = await getOne<TaxInvoiceRecord>(COLLECTIONS.TAX_INVOICES, invoiceId);
  if (!existing) throw new Error(`Tax invoice ${invoiceId} not found`);
  if (String(existing.status || '').toLowerCase() !== 'draft') throw new Error('Only draft tax invoices can be edited');

  const payload = buildPersistedRecord(
    { ...form, id: invoiceId, invoiceNumber: existing.invoiceNumber, serialNumber: existing.serialNumber, fiscalYear: existing.fiscalYear, status: 'Draft' },
    company,
    existing.invoiceNumber,
    existing.serialNumber,
    existing.fiscalYear
  );

  await updateDocById(COLLECTIONS.TAX_INVOICES, invoiceId, {
    ...payload,
    updatedBy: state.user?.id || 'system',
  } as any);

  await logActivity('TaxInvoices', 'Updated Draft', invoiceId, {
    entityName: payload.invoiceNumber,
    actionLabel: 'Updated tax invoice draft',
    orderId: form.orderId,
    sourcePiId: form.sourcePiId,
  });

  return {
    ...(existing as TaxInvoiceRecord),
    ...payload,
    updatedBy: state.user?.id || 'system',
  };
}

export async function issueTaxInvoice(invoiceId: string): Promise<TaxInvoiceRecord> {
  const state = useAppStore.getState();
  const existing = await getOne<TaxInvoiceRecord>(COLLECTIONS.TAX_INVOICES, invoiceId);
  if (!existing) throw new Error(`Tax invoice ${invoiceId} not found`);
  if (String(existing.status || '').toLowerCase() !== 'draft') throw new Error('Only draft tax invoices can be issued');

  const issuedAt = new Date().toISOString();
  await updateDocById(COLLECTIONS.TAX_INVOICES, invoiceId, {
    status: 'Issued',
    issuedAt,
    updatedBy: state.user?.id || 'system',
  });

  await logActivity('TaxInvoices', 'Issued', invoiceId, {
    entityName: existing.invoiceNumber,
    actionLabel: 'Issued tax invoice',
  });

  const companyId = resolveNotificationCompanyId(state.activeCompanyId);
  void notifyRoleUsers(
    ['Accounts', 'Admin', 'Director'],
    NotificationType.INVOICE_UPDATED,
    'Tax invoice issued',
    `Tax invoice ${existing.invoiceNumber} was issued.`,
    'tax_invoice',
    invoiceId,
    companyId,
  );

  return {
    ...existing,
    status: 'Issued',
    issuedAt,
    updatedBy: state.user?.id || 'system',
  };
}

export async function cancelTaxInvoice(invoiceId: string, reason = ''): Promise<TaxInvoiceRecord> {
  const state = useAppStore.getState();
  const existing = await getOne<TaxInvoiceRecord>(COLLECTIONS.TAX_INVOICES, invoiceId);
  if (!existing) throw new Error(`Tax invoice ${invoiceId} not found`);
  if (String(existing.status || '').toLowerCase() === 'cancelled') throw new Error('Tax invoice is already cancelled');

  const cancelledAt = new Date().toISOString();
  await updateDocById(COLLECTIONS.TAX_INVOICES, invoiceId, {
    status: 'Cancelled',
    cancelledAt,
    cancellationReason: reason || 'Cancelled by user',
    updatedBy: state.user?.id || 'system',
  });

  await logActivity('TaxInvoices', 'Cancelled', invoiceId, {
    entityName: existing.invoiceNumber,
    actionLabel: 'Cancelled tax invoice',
    reason: reason || '',
  });

  const companyId = resolveNotificationCompanyId(state.activeCompanyId);
  void notifyRoleUsers(
    ['Accounts', 'Admin', 'Director'],
    NotificationType.INVOICE_UPDATED,
    'Tax invoice cancelled',
    `Tax invoice ${existing.invoiceNumber} was cancelled. Reason: ${reason || 'Cancelled by user'}`,
    'tax_invoice',
    invoiceId,
    companyId,
  );

  return {
    ...existing,
    status: 'Cancelled',
    cancelledAt,
    cancellationReason: reason || 'Cancelled by user',
    updatedBy: state.user?.id || 'system',
  };
}
