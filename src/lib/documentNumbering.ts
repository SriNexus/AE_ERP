import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { COLLECTIONS, db } from './firebase';
import { resolveWriteCompanyId } from './firestore';
import { useAppStore } from '../store/useAppStore';
import { sanitizePayload } from './sanitizer';
import { buildDocumentCounterId, formatDocumentNumber, getDocumentPrefixField, normalizeDocumentSettings, resolveDocumentSettings, type DocumentNumberType, type ResolvedDocumentSettings } from '../features/settings/documentRuntime';
import { DEFAULT_COMPANY } from '../config/company';

export type DocumentNumberResult = {
  companyId: string;
  docType: DocumentNumberType;
  sequenceNumber: number;
  documentNumber: string;
  counterId: string;
  settings: ResolvedDocumentSettings;
};

function resolveCompanyContext(companyId?: string) {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder
  // (DEFAULT_COMPANY.id is 'default'; the previous fallback chain could resolve
  // to it during the pre-boot window and emit where('companyId','==','default')
  // reads from existingMaxSequence → the Admin 403 storm class).
  const resolvedCompanyId = companyId || resolveWriteCompanyId() || state.globalCompany?.id || '';
  const company = state.company || state.globalCompany || DEFAULT_COMPANY;
  return { resolvedCompanyId, company };
}

const NUMBER_SOURCES: Record<DocumentNumberType, { collection: string; fields: string[] }> = {
  quotation: { collection: COLLECTIONS.QUOTATIONS, fields: ['quotationNumber', 'quoteNumber', 'refNo'] },
  order: { collection: COLLECTIONS.ORDERS, fields: ['orderNumber', 'orderNo'] },
  invoice: { collection: COLLECTIONS.PROFORMA_INVOICES, fields: ['invoiceNumber', 'piNumber', 'refNo'] },
};

export function sequenceFromDocumentNumber(value: unknown, prefix: string): number {
  const normalized = String(value || '').trim().toUpperCase();
  const normalizedPrefix = String(prefix || '').trim().toUpperCase();
  if (!normalizedPrefix || !normalized.startsWith(normalizedPrefix)) return 0;
  const suffix = normalized.slice(normalizedPrefix.length).replace(/^-/, '');
  return /^\d+$/.test(suffix) ? Number(suffix) || 0 : 0;
}

async function existingMaxSequence(companyId: string, docType: DocumentNumberType, prefix: string) {
  const source = NUMBER_SOURCES[docType];
  const snapshot = await getDocs(query(collection(db, source.collection), where('companyId', '==', companyId)));
  return snapshot.docs.reduce((max, candidate) => {
    const data = candidate.data() as Record<string, unknown>;
    return Math.max(max, ...source.fields.map((field) => sequenceFromDocumentNumber(data[field], prefix)));
  }, 0);
}
export async function getNextDocumentNumber(companyId: string, docType: DocumentNumberType): Promise<DocumentNumberResult> {
  const { resolvedCompanyId, company } = resolveCompanyContext(companyId);
  const settings = await resolveDocumentSettings(resolvedCompanyId, company);
  const prefixField = getDocumentPrefixField(docType);
  const prefix = settings[prefixField];
  const counterId = buildDocumentCounterId(resolvedCompanyId, docType);
  const counterRef = doc(db, COLLECTIONS.DOCUMENT_COUNTERS, counterId);
  const existingMax = await existingMaxSequence(resolvedCompanyId, docType, prefix);

  const sequenceNumber = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const currentNumber = Math.max(snap.exists() ? Number((snap.data() as { currentNumber?: unknown }).currentNumber) || 0 : 0, existingMax);
    const nextNumber = currentNumber + 1;
    transaction.set(counterRef, sanitizePayload({
      id: counterId,
      companyId: resolvedCompanyId,
      docType,
      currentNumber: nextNumber,
      prefix,
      sequencePadding: settings.sequencePadding,
      createdAt: snap.exists() ? (snap.data() as { createdAt?: unknown }).createdAt || serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
      isDeleted: false,
    }), { merge: true });
    return nextNumber;
  });

  return {
    companyId: resolvedCompanyId,
    docType,
    sequenceNumber,
    documentNumber: formatDocumentNumber(prefix, sequenceNumber, settings.sequencePadding),
    counterId,
    settings,
  };
}

export async function resolveDocumentDefaults(companyId?: string) {
  const { resolvedCompanyId, company } = resolveCompanyContext(companyId);
  return {
    companyId: resolvedCompanyId,
    settings: normalizeDocumentSettings(await resolveDocumentSettings(resolvedCompanyId, company), company),
  };
}
