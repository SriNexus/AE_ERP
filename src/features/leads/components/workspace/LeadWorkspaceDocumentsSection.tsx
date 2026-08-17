/**
 * LeadWorkspaceDocumentsSection — Lead Workspace adapter over the generic
 * Neozy DocumentManager (src/components/shared/DocumentManager.tsx).
 *
 * Shared Documents Architecture mission: `lead.documents` (+ legacy
 * single-slot fields) is now merged with lib/caseDocuments.ts's ONE shared
 * COLLECTIONS.DOCUMENTS collection (matched by leadId/customerId/caseId),
 * so a document uploaded here is the SAME record the related Customer/
 * Project Workspace see — not a copy. New uploads and deletes of an
 * already-shared document go through that collection; legacy array/slot
 * data is preserved and still flattened/cleared exactly as before when a
 * legacy-only entry is deleted (see handleChange below) — nothing existing
 * is lost or rewritten wholesale.
 *
 * All upload/preview/download/delete behavior lives in the generic
 * DocumentManager — this adapter only maps data in/out.
 */
import { useMemo, useCallback } from 'react';
import DocumentManager, { NeozyDocument } from '../../../../components/shared/DocumentManager';
import { LeadDomainService } from '../../../../services/LeadDomainService';
import { useCurrentUser } from '../../../../store/useAppStore';
import { useCaseDocuments, useInvalidateCaseDocuments, resolveDocumentsFor, createCaseDocument, deleteCaseDocument, type CaseDocument } from '../../../../lib/caseDocuments';
import { resolveWriteCompanyId } from '../../../../lib/firestore';

interface Props {
  lead: any;
  isEditing: boolean;
  activeCompanyId: string;
  onSaved: () => void;
}

/** Legacy single-slot document fields carried by older leads. */
const LEGACY_SLOTS: { name: string; url: string; mime: string; size: string; date: string; label: string }[] = [
  { name: 'electricityBillFileName', url: 'electricityBillUrl', mime: 'electricityBillMimeType', size: 'electricityBillSize', date: 'electricityBillDate', label: 'Electricity Bill' },
  { name: 'aadhaarFileName',        url: 'aadhaarUrl',        mime: 'aadhaarMimeType',        size: 'aadhaarSize',        date: 'aadhaarDate',        label: 'Aadhaar Card' },
  { name: 'panFileName',             url: 'panUrl',             mime: 'panMimeType',             size: 'panSize',             date: 'panDate',             label: 'PAN Card' },
  { name: 'attachmentName',          url: 'attachmentUrl',      mime: 'attachmentMimeType',      size: 'attachmentSize',      date: 'attachmentDate',      label: 'Attachment' },
];

/** Stable deterministic id for legacy-derived entries so re-normalization is idempotent. */
function legacyId(slot: string, name: string): string {
  return `legacy-${slot}-${name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
}

/** Exported (Left Panel/Tabs/Documents/Footer UI standardization mission) so
 * the Lead→Customer conversion flow (lib/leadWorkflow.ts) can carry a lead's
 * already-normalized document list forward onto the new customer record —
 * the same document reference, not a re-upload. See
 * CustomerWorkspaceDocumentsSection.tsx for the customer-side counterpart. */
export function normalizeDocuments(lead: any): NeozyDocument[] {
  const list: NeozyDocument[] = [];
  // Tracks file names already represented in `list`, so a legacy single-slot
  // field isn't re-added when it's already been migrated into the array —
  // NOT used to dedupe array entries against each other (see below).
  const seenNames = new Set<string>();

  // 1) New model — lead.documents array (preferred, authoritative). Every
  // entry here already carries its own unique id from upload, so these are
  // NEVER deduped against each other by name: two different uploads that
  // happen to share a file name (e.g. two phone photos both named
  // "IMG_0001.jpg") must still both render as their own card, not collapse
  // into one.
  if (Array.isArray(lead?.documents)) {
    lead.documents.forEach((d: any, i: number) => {
      if (!d || !d.name) return;
      list.push({
        id: d.id || legacyId('array', `${d.name}-${i}`),
        name: d.name,
        url: d.url,
        mimeType: d.mimeType,
        size: d.size,
        uploadedAt: d.uploadedAt || d.date || lead?.createdAt,
        label: d.label,
        uploadedBy: d.uploadedBy,
        uploaderName: d.uploaderName,
      });
      seenNames.add(d.name.toLowerCase());
    });
  }

  // 2) Legacy single-slot fields — name-based dedupe belongs here: only add
  // a legacy slot if it isn't already represented by an array entry.
  LEGACY_SLOTS.forEach((slot) => {
    const name = lead?.[slot.name];
    if (!name || seenNames.has(String(name).toLowerCase())) return;
    seenNames.add(String(name).toLowerCase());
    list.push({
      id: legacyId(slot.name, name),
      name,
      url: lead?.[slot.url],
      mimeType: lead?.[slot.mime],
      size: lead?.[slot.size],
      uploadedAt: lead?.[slot.date] || lead?.createdAt,
      label: slot.label,
    });
  });

  // Legacy attachment also accepts fileName/fileUrl aliases
  const legacyFile = lead?.fileName;
  if (legacyFile && !seenNames.has(String(legacyFile).toLowerCase())) {
    list.push({
      id: legacyId('fileName', legacyFile),
      name: legacyFile,
      url: lead?.fileUrl,
      uploadedAt: lead?.createdAt,
      label: 'Attachment',
    });
  }

  return list;
}

function toNeozyDocument(doc: CaseDocument): NeozyDocument {
  return {
    id: doc.id,
    name: doc.name,
    url: doc.url,
    mimeType: doc.mimeType,
    size: doc.size,
    uploadedAt: doc.uploadedAt,
    label: doc.label,
    uploadedBy: doc.uploadedBy,
    uploaderName: doc.uploaderName,
  };
}

export default function LeadWorkspaceDocumentsSection({ lead, isEditing, activeCompanyId, onSaved }: Props) {
  const currentUser = useCurrentUser();
  const { data: allCaseDocs = [] } = useCaseDocuments();
  const invalidateCaseDocuments = useInvalidateCaseDocuments();

  const scope = useMemo(() => ({
    leadId: lead?.id,
    customerId: lead?.convertedCustomerId || undefined,
    caseId: lead?.caseId || undefined,
  }), [lead]);

  const sharedDocs = useMemo(() => resolveDocumentsFor(scope, allCaseDocs), [scope, allCaseDocs]);
  const legacyDocs = useMemo(() => normalizeDocuments(lead), [lead]);

  const documents = useMemo(() => {
    const sharedIds = new Set(sharedDocs.map((d) => d.id));
    return [...sharedDocs.map(toNeozyDocument), ...legacyDocs.filter((d) => !sharedIds.has(d.id))];
  }, [sharedDocs, legacyDocs]);

  const storagePath = `companies/${resolveWriteCompanyId()}/leads/${lead?.id || 'lead'}/documents`;

  const handleChange = useCallback(async (next: NeozyDocument[]) => {
    if (!lead?.id) return;
    const prevIds = new Set(documents.map((d) => d.id));
    const nextIds = new Set(next.map((d) => d.id));

    const added = next.filter((d) => !prevIds.has(d.id));
    const removedIds = documents.filter((d) => !nextIds.has(d.id)).map((d) => d.id);
    const sharedIdSet = new Set(sharedDocs.map((d) => d.id));
    const removedFromShared = removedIds.filter((id) => sharedIdSet.has(id));
    const removedFromLegacy = removedIds.filter((id) => !sharedIdSet.has(id));

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
        sourceEntityType: 'lead',
      })),
      ...removedFromShared.map((id) => deleteCaseDocument(id)),
    ]);

    if (removedFromLegacy.length) {
      // Same flatten-and-clear behavior as before: persist the remaining
      // legacy entries as the array, and clear the migrated legacy slots
      // so old fields never re-appear alongside their array copies.
      const nextLegacyList = legacyDocs.filter((d) => !removedFromLegacy.includes(d.id));
      const payload: Record<string, unknown> = { documents: nextLegacyList };
      LEGACY_SLOTS.forEach((slot) => {
        payload[slot.name] = '';
        payload[slot.url] = '';
        payload[slot.mime] = '';
        payload[slot.size] = '';
        payload[slot.date] = '';
      });
      payload.fileName = '';
      payload.fileUrl = '';
      await LeadDomainService.update(lead.id, payload);
    }

    invalidateCaseDocuments();
    onSaved();
  }, [lead, documents, sharedDocs, legacyDocs, scope, currentUser, invalidateCaseDocuments, onSaved]);

  return (
    <DocumentManager
      documents={documents}
      isEditing={isEditing}
      storagePath={storagePath}
      onChange={handleChange}
      maxDocuments={2}
      currentUser={{ id: currentUser.id, name: currentUser.name }}
    />
  );
}
