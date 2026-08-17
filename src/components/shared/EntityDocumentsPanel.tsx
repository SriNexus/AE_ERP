/**
 * EntityDocumentsPanel — Phase 14 (Documents / Activities / Linked Records)
 *
 * The one real, shared-architecture Documents adapter for Order/Quotation/
 * ProformaInvoice(Invoice)/Dispatch/Payment — reuses `lib/caseDocuments.ts`'s
 * `resolveDocumentsFor()`/`createCaseDocument()`/`deleteCaseDocument()` over
 * the single shared `COLLECTIONS.DOCUMENTS` collection, and the same shared
 * `DocumentManager` UI component Lead/Customer/Project/Survey/Engineering
 * already use — no parallel document mechanism.
 *
 * Exported standalone (not private to UniversalDocumentsTab.tsx) so both the
 * generic WorkspaceShell 'documents' tab (used by the five dedicated
 * `/module/:id` workspace routes) AND a page's own bespoke detail view
 * (e.g. Orders.tsx's list-page quick-view modal) can mount the identical,
 * real capability rather than each inventing its own.
 */
import { useCallback, useMemo } from 'react';
import DocumentManager from './DocumentManager';
import {
  useCaseDocuments,
  useInvalidateCaseDocuments,
  resolveDocumentsFor,
  createCaseDocument,
  deleteCaseDocument,
  type CaseDocumentScope,
} from '../../lib/caseDocuments';
import { useCurrentUser } from '../../store/useAppStore';
import { resolveWriteCompanyId } from '../../lib/firestore';

export const ENTITY_SCOPE_FIELD = {
  orders: 'orderId',
  quotations: 'quotationId',
  invoices: 'invoiceId',
  dispatch: 'dispatchId',
  payments: 'paymentId',
} as const satisfies Record<string, keyof CaseDocumentScope>;

// 'dispatch' is not a plural of a singular form the way the other four
// entityType strings are — a naive `.slice(0, -1)` would silently mangle it
// ('dispatch' -> 'dispatc'), so the sourceEntityType mapping is explicit.
export const ENTITY_SOURCE_TYPE = {
  orders: 'order',
  quotations: 'quotation',
  invoices: 'invoice',
  dispatch: 'dispatch',
  payments: 'payment',
} as const satisfies Record<string, 'order' | 'quotation' | 'invoice' | 'dispatch' | 'payment'>;

export type ScopedDocumentEntityType = keyof typeof ENTITY_SCOPE_FIELD;

export function isScopedDocumentEntityType(value: string): value is ScopedDocumentEntityType {
  return Object.prototype.hasOwnProperty.call(ENTITY_SCOPE_FIELD, value);
}

function readStringField(record: Record<string, unknown> | null | undefined, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === 'string' && value ? value : undefined;
}

export interface EntityDocumentsPanelProps {
  entityId: string;
  entityType: ScopedDocumentEntityType;
  companyId: string;
  /** The full entity record — used to resolve cross-links (customerId/projectId/leadId/orderId/…) so a document uploaded here also surfaces from a genuinely related entity's own Documents view. */
  record: Record<string, unknown> | null | undefined;
  caseId?: string;
  isEditing: boolean;
}

export function EntityDocumentsPanel({ entityId, entityType, companyId, record, caseId, isEditing }: EntityDocumentsPanelProps) {
  const currentUser = useCurrentUser();
  const { data: allCaseDocs = [] } = useCaseDocuments();
  const invalidateCaseDocuments = useInvalidateCaseDocuments();
  const scopeField = ENTITY_SCOPE_FIELD[entityType];

  // Every relationship key this record genuinely carries — matches the
  // exact pattern ProjectWorkspaceDocumentsSection.tsx/surveyWorkflow.ts use
  // (read defensively; these five entities are not all strictly typed with
  // every one of these fields). Cross-links (e.g. a Payment's own
  // `invoiceId`, a PI's own `orderId`/`sourceOrderId`) are read generically
  // so a document uploaded here also surfaces from a genuinely linked
  // sibling entity's Documents view — the record's own id always wins for
  // its own entity type, overriding any stale self-referential field.
  const scope = useMemo<CaseDocumentScope>(() => {
    const base: CaseDocumentScope = {
      customerId: readStringField(record, 'customerId'),
      projectId: readStringField(record, 'projectId'),
      leadId: readStringField(record, 'leadId'),
      caseId,
      orderId: readStringField(record, 'orderId') || readStringField(record, 'sourceOrderId'),
      quotationId: readStringField(record, 'quotationId'),
      invoiceId: readStringField(record, 'invoiceId'),
      dispatchId: readStringField(record, 'dispatchId'),
      paymentId: readStringField(record, 'paymentId'),
    };
    base[scopeField] = entityId;
    return base;
  }, [scopeField, entityId, record, caseId]);

  const documents = useMemo(() => resolveDocumentsFor(scope, allCaseDocs), [scope, allCaseDocs]);

  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const storagePath = `companies/${resolveWriteCompanyId() || companyId || ''}/${entityType}/${entityId || entityType}/documents`;

  const handleChange = useCallback(async (next: Array<{ id: string; name: string; url?: string; mimeType?: string; size?: number; uploadedAt?: string; uploadedBy?: string; uploaderName?: string; label?: string }>) => {
    const prevIds = new Set(documents.map((d) => d.id));
    const nextIds = new Set(next.map((d) => d.id));
    const added = next.filter((d) => !prevIds.has(d.id));
    const removed = documents.filter((d) => !nextIds.has(d.id));

    await Promise.all([
      ...added.map((doc) => createCaseDocument({
        ...scope,
        name: doc.name,
        url: doc.url || '',
        mimeType: doc.mimeType,
        size: doc.size,
        uploadedAt: doc.uploadedAt,
        uploadedBy: currentUser.id,
        uploaderName: currentUser.name,
        label: doc.label,
        sourceEntityType: ENTITY_SOURCE_TYPE[entityType],
      })),
      ...removed.map((doc) => deleteCaseDocument(doc.id)),
    ]);

    invalidateCaseDocuments();
  }, [documents, scope, currentUser, entityType, invalidateCaseDocuments]);

  return (
    <DocumentManager
      documents={documents}
      isEditing={isEditing}
      storagePath={storagePath}
      onChange={handleChange}
      currentUser={{ id: currentUser.id, name: currentUser.name }}
    />
  );
}

export default EntityDocumentsPanel;
