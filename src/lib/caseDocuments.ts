/**
 * caseDocuments — the ONE canonical shared Documents system for Lead,
 * Customer and Project Workspace (Shared Documents Architecture mission).
 *
 * WHY THIS EXISTS: Lead/Customer/Project each used to own a PRIVATE
 * `documents: NeozyDocument[]` array on its own record (confirmed by
 * reading CustomerWorkspaceDocumentsSection.tsx/
 * LeadWorkspaceDocumentsSection.tsx/ProjectWorkspaceDocumentsSection.tsx —
 * same shared DocumentManager COMPONENT, but three separate private DATA
 * STORES). A prior fix mirrored Survey uploads by copying the same entry
 * into all three arrays — exactly the "copy into 3 arrays, hope they stay
 * synchronized" anti-pattern this mission explicitly rejects. This module
 * replaces that with one real collection (COLLECTIONS.DOCUMENTS) so a
 * document uploaded from ANY of Lead/Customer/Project is a SINGLE record,
 * discoverable by whichever of those entities it relates to — no copies,
 * no synchronization to keep correct.
 *
 * RELATIONSHIP MODEL: `caseId` (src/lib/casePropagation.ts — "ONE CUSTOMER
 * LIFECYCLE = ONE CASE", already propagated Lead→Customer→Project→Survey/
 * Engineering/etc. throughout this codebase) is the natural cross-entity
 * key. It is NOT used as the only key, though: a Customer or Project
 * created directly (no source Lead) may have no caseId at all (confirmed —
 * useCustomers.ts's create path never calls case propagation). So every
 * document also carries the direct leadId/customerId/projectId it was
 * uploaded against, and resolveDocumentsFor() matches on ANY of these,
 * caseId included when present — full cross-workspace sharing when a case
 * exists, graceful direct-relationship-only fallback when it doesn't.
 *
 * MIGRATION SAFETY: existing project.documents/customer.documents/
 * lead.documents arrays (including the earlier Survey mirror's copies) are
 * NOT deleted or rewritten — see normalizeLegacyEntityDocuments() below.
 * Each workspace's DocumentsSection merges the new collection's entries
 * with the legacy array, de-duplicated by id, so no history is lost and no
 * document is ever hidden by this migration.
 *
 * PERMISSIONS: COLLECTIONS.DOCUMENTS has no per-document owner and is not
 * its own permission module — see the matching carve-out added to
 * applyAccessFilters() in lib/firestore.ts (access is already correctly
 * gated by whichever parent entity/module the user opened to reach this
 * section).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createDocWithId, genId, getAll, softDelete } from './firestore';
import { COLLECTIONS } from './firebase';
import { queryKeys } from './queryKeys';
import { useAppStore } from '../store/useAppStore';
import type { BaseRecord } from '../types';

export interface CaseDocument extends BaseRecord {
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
  uploadedBy?: string;
  uploaderName?: string;
  label?: string;
  /** Relationship keys — as many as were known at upload time. A document
   * is discoverable by whichever workspace queries by any ONE of these,
   * regardless of which workspace it was uploaded from. */
  leadId?: string;
  customerId?: string;
  projectId?: string;
  caseId?: string;
  /** Phase 14: the five financial/logistics entities' own FK keys — same
   * "match on any relationship key present" model as leadId/customerId/
   * projectId/caseId above, so a document uploaded from an Order's
   * Documents tab is also discoverable from its linked Quotation/Project/
   * Customer workspace when those relationship ids were resolvable at
   * upload time (see ScopedDocumentsTab in UniversalDocumentsTab.tsx). */
  orderId?: string;
  quotationId?: string;
  invoiceId?: string;
  dispatchId?: string;
  paymentId?: string;
  /** Audit only — where the upload actually happened. Never used for
   * queries/visibility. */
  sourceEntityType?: 'lead' | 'customer' | 'project' | 'order' | 'quotation' | 'invoice' | 'dispatch' | 'payment';
  /** Vendor Lock / Scheme Registration (Channel Partner) denormalized
   * ownership + stage (spec §15) — written at upload time from the owning
   * project/case chain, never client-supplied. Used by the Registration
   * workspace's required-document checklist and by Storage-rule ownership
   * resolution through the owning case. NOT a query key — documents stay
   * discoverable by projectId/caseId. */
  partnerId?: string;
  partnerName?: string;
  stage?: string;
}

export interface CaseDocumentScope {
  leadId?: string;
  customerId?: string;
  projectId?: string;
  caseId?: string;
  orderId?: string;
  quotationId?: string;
  invoiceId?: string;
  dispatchId?: string;
  paymentId?: string;
}

/** Real shared documents for this scope — matches on ANY relationship key
 * present on both the scope and the document, de-duplicated by id (a
 * document can legitimately match more than one key, e.g. a Project
 * upload also carrying its customerId/caseId). */
export function resolveDocumentsFor(scope: CaseDocumentScope, allDocs: CaseDocument[]): CaseDocument[] {
  const seen = new Set<string>();
  const result: CaseDocument[] = [];
  for (const doc of allDocs) {
    const matches = (scope.leadId && doc.leadId === scope.leadId)
      || (scope.customerId && doc.customerId === scope.customerId)
      || (scope.projectId && doc.projectId === scope.projectId)
      || (scope.caseId && doc.caseId === scope.caseId)
      || (scope.orderId && doc.orderId === scope.orderId)
      || (scope.quotationId && doc.quotationId === scope.quotationId)
      || (scope.invoiceId && doc.invoiceId === scope.invoiceId)
      || (scope.dispatchId && doc.dispatchId === scope.dispatchId)
      || (scope.paymentId && doc.paymentId === scope.paymentId);
    if (matches && !seen.has(doc.id)) {
      seen.add(doc.id);
      result.push(doc);
    }
  }
  return result;
}

export function useCaseDocuments() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  return useQuery({
    queryKey: queryKeys.forCompany(companyId).caseDocumentsAll,
    queryFn: () => getAll<CaseDocument>(COLLECTIONS.DOCUMENTS),
    staleTime: 30_000,
  });
}

export function useInvalidateCaseDocuments() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.forCompany(companyId).caseDocumentsRoot });
}

export interface CreateCaseDocumentInput extends CaseDocumentScope {
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
  uploadedBy?: string;
  uploaderName?: string;
  label?: string;
  sourceEntityType: 'lead' | 'customer' | 'project' | 'order' | 'quotation' | 'invoice' | 'dispatch' | 'payment';
  /** Explicit document id — pass this when the source record already has a
   * stable id of its own (e.g. a Survey photo's SurveyPhoto.id) so
   * re-running the same operation (a rejected Survey resubmitted with the
   * same photo) merges into the SAME record via createDocWithId's
   * set-with-merge semantics, rather than creating a duplicate. Omit to
   * generate a fresh id (the normal manual-upload path). */
  id?: string;
  /** Vendor Lock / Scheme Registration (spec §15) denormalized fields. */
  partnerId?: string;
  partnerName?: string;
  stage?: string;
}

/** Writes ONE document record — never a per-entity copy. Idempotent when
 * `input.id` is supplied (see CreateCaseDocumentInput.id above). */
export async function createCaseDocument(input: CreateCaseDocumentInput): Promise<CaseDocument> {
  const id = input.id || genId.generic('DOC');
  const payload: Omit<CaseDocument, 'id' | 'companyId' | 'createdBy' | 'updatedBy' | 'createdAt' | 'updatedAt' | 'isDeleted'> = {
    name: input.name,
    url: input.url,
    mimeType: input.mimeType,
    size: input.size,
    uploadedAt: input.uploadedAt || new Date().toISOString(),
    uploadedBy: input.uploadedBy,
    uploaderName: input.uploaderName,
    label: input.label,
    leadId: input.leadId || undefined,
    customerId: input.customerId || undefined,
    projectId: input.projectId || undefined,
    caseId: input.caseId || undefined,
    orderId: input.orderId || undefined,
    quotationId: input.quotationId || undefined,
    invoiceId: input.invoiceId || undefined,
    dispatchId: input.dispatchId || undefined,
    paymentId: input.paymentId || undefined,
    partnerId: input.partnerId || undefined,
    partnerName: input.partnerName || undefined,
    stage: input.stage || undefined,
    sourceEntityType: input.sourceEntityType,
  };
  const created = await createDocWithId(COLLECTIONS.DOCUMENTS, id, payload as any);
  return created as unknown as CaseDocument;
}

/** Soft-deletes ONE document record — same softDelete() primitive every
 * other archivable entity in this codebase already uses. */
export async function deleteCaseDocument(id: string): Promise<void> {
  await softDelete(COLLECTIONS.DOCUMENTS, id);
}

/** Diffs a DocumentManager `onChange(next)` call (which always receives the
 * COMPLETE list — one entry added, or one removed) against the previously
 * resolved list, and translates it into exactly one createCaseDocument()
 * or deleteCaseDocument() call. This is what lets every DocumentsSection
 * adapter keep using DocumentManager completely unmodified — the shared
 * component's existing whole-list contract never has to know a real
 * per-record collection sits underneath. */
export async function applyDocumentListChange(
  previous: CaseDocument[],
  next: Array<{ id: string; name: string; url?: string; mimeType?: string; size?: number; uploadedAt?: string; uploadedBy?: string; uploaderName?: string; label?: string }>,
  scope: CaseDocumentScope,
  sourceEntityType: 'lead' | 'customer' | 'project' | 'order' | 'quotation' | 'invoice' | 'dispatch' | 'payment',
): Promise<void> {
  const prevIds = new Set(previous.map((d) => d.id));
  const nextIds = new Set(next.map((d) => d.id));

  const added = next.filter((d) => !prevIds.has(d.id));
  const removed = previous.filter((d) => !nextIds.has(d.id));

  await Promise.all([
    ...added.map((doc) => createCaseDocument({
      ...scope,
      name: doc.name,
      url: doc.url || '',
      mimeType: doc.mimeType,
      size: doc.size,
      uploadedAt: doc.uploadedAt,
      uploadedBy: doc.uploadedBy,
      uploaderName: doc.uploaderName,
      label: doc.label,
      sourceEntityType,
    })),
    ...removed.map((doc) => deleteCaseDocument(doc.id)),
  ]);
}
