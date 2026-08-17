import { DEFAULT_COMPANY } from '../../config/company';
import { COLLECTIONS } from '../../lib/firebase';
import { getOne, resolveWriteCompanyId } from '../../lib/firestore';
import { useAppStore } from '../../store/useAppStore';
import { DEFAULT_DOCUMENT_SETTINGS } from './defaults';
import type { CompanyConfig } from '../../config/company';
import type { DocumentSettings, SettingsDocument } from './types';

export type DocumentNumberType = 'invoice' | 'quotation' | 'order';

export interface ResolvedDocumentSettings extends DocumentSettings {
  invoicePrefix: string;
  quotationPrefix: string;
  orderPrefix: string;
  sequencePadding: number;
}

const PREFIX_FALLBACKS: Record<Exclude<DocumentNumberType, never>, keyof Pick<ResolvedDocumentSettings, 'invoicePrefix' | 'quotationPrefix' | 'orderPrefix'>> = {
  invoice: 'invoicePrefix',
  quotation: 'quotationPrefix',
  order: 'orderPrefix',
};

const DEFAULT_PADDING = DEFAULT_DOCUMENT_SETTINGS.sequencePadding || 4;

function normalizePrefix(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  const trimmed = raw.replace(/[-_./\s]+$/g, '').replace(/[^A-Z0-9-]/g, '');
  return trimmed || fallback;
}

function normalizePadding(value: unknown, fallback = DEFAULT_PADDING): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  if (rounded < 2 || rounded > 8) return fallback;
  return rounded;
}

function normalizeValidityDays(value: unknown, fallback = DEFAULT_DOCUMENT_SETTINGS.piValidityDays): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  if (rounded < 1 || rounded > 3650) return fallback;
  return rounded;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function normalizeDocumentSettings(
  data?: Partial<DocumentSettings> & Partial<ResolvedDocumentSettings> | null,
  company?: Partial<CompanyConfig> | null,
): ResolvedDocumentSettings {
  const companyFallback = company || DEFAULT_COMPANY;
  const defaults: ResolvedDocumentSettings = {
    ...DEFAULT_DOCUMENT_SETTINGS,
    invoicePrefix: normalizePrefix(companyFallback.invoicePrefix ?? DEFAULT_DOCUMENT_SETTINGS.invoicePrefix, DEFAULT_DOCUMENT_SETTINGS.invoicePrefix),
    quotationPrefix: normalizePrefix(companyFallback.quotationPrefix ?? DEFAULT_DOCUMENT_SETTINGS.quotationPrefix, DEFAULT_DOCUMENT_SETTINGS.quotationPrefix),
    orderPrefix: normalizePrefix(companyFallback.orderPrefix ?? DEFAULT_DOCUMENT_SETTINGS.orderPrefix, DEFAULT_DOCUMENT_SETTINGS.orderPrefix),
    sequencePadding: DEFAULT_PADDING,
  };

  if (!data) return defaults;

  return {
    ...defaults,
    piValidityDays: normalizeValidityDays(data.piValidityDays, defaults.piValidityDays),
    defaultTerms: normalizeString(data.defaultTerms, defaults.defaultTerms),
    defaultNotes: normalizeString(data.defaultNotes, defaults.defaultNotes),
    invoicePrefix: normalizePrefix(data.invoicePrefix ?? companyFallback.invoicePrefix, defaults.invoicePrefix),
    quotationPrefix: normalizePrefix(data.quotationPrefix ?? companyFallback.quotationPrefix, defaults.quotationPrefix),
    orderPrefix: normalizePrefix(data.orderPrefix ?? companyFallback.orderPrefix, defaults.orderPrefix),
    sequencePadding: normalizePadding(data.sequencePadding, defaults.sequencePadding),
  };
}

export function getDocumentPrefixField(docType: DocumentNumberType): keyof Pick<ResolvedDocumentSettings, 'invoicePrefix' | 'quotationPrefix' | 'orderPrefix'> {
  return PREFIX_FALLBACKS[docType];
}

export function formatDocumentNumber(prefix: string, sequence: number, padding = DEFAULT_PADDING): string {
  const safePrefix = normalizePrefix(prefix, DEFAULT_DOCUMENT_SETTINGS.invoicePrefix);
  const safeSequence = Math.max(1, Math.trunc(sequence || 0));
  const safePadding = Math.max(2, Math.trunc(padding || DEFAULT_PADDING));
  return `${safePrefix}-${String(safeSequence).padStart(safePadding, '0')}`;
}

export function buildDocumentCounterId(companyId: string, docType: DocumentNumberType): string {
  return `${companyId}_${docType}`;
}

export async function resolveDocumentSettings(companyId?: string, companyFallback?: Partial<CompanyConfig> | null): Promise<ResolvedDocumentSettings> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder
  // (DEFAULT_COMPANY.id is 'default'; the previous fallback chain could resolve
  // to it during the pre-boot window and emit `_settings_documents` reads the
  // rules deny → the Admin settings 403 storm class).
  const resolvedCompanyId = companyId || resolveWriteCompanyId() || state.globalCompany?.id || '';
  const fallbackCompany = companyFallback || state.company || state.globalCompany || DEFAULT_COMPANY;
  // Fail closed: no resolvable company → the deterministic `_settings_documents`
  // doc cannot exist and a read would be denied by the rules (the Admin
  // settings 403-storm class). Return defaults without issuing the read.
  if (!resolvedCompanyId) {
    return normalizeDocumentSettings(null, fallbackCompany);
  }
  const docId = `${resolvedCompanyId}_settings_documents`;
  let doc: SettingsDocument | null = null;
  try {
    doc = await getOne<SettingsDocument>(COLLECTIONS.SETTINGS, docId);
  } catch {
    doc = null;
  }
  return normalizeDocumentSettings((doc?.data as Partial<DocumentSettings> | undefined) ?? null, fallbackCompany);
}
