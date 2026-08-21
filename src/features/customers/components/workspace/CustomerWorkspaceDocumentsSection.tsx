/**
 * CustomerWorkspaceDocumentsSection — Customer Workspace adapter over the
 * generic Neozy DocumentManager (src/components/shared/DocumentManager.tsx).
 *
 * Shared Documents Architecture mission: `customer.documents` (+ legacy
 * single-slot fields) is now merged with lib/caseDocuments.ts's ONE shared
 * COLLECTIONS.DOCUMENTS collection (matched by customerId/leadId/caseId —
 * caseId covers projects too, since a Project upload stamps its own
 * customerId), so a document uploaded here is the SAME record the related
 * Lead/Project Workspace see — not a copy. New uploads and deletes of an
 * already-shared document go through that collection; legacy array/slot
 * data is preserved and still flattened/cleared exactly as before when a
 * legacy-only entry is deleted (see handleChange below).
 *
 * No duplication across Lead → Customer: convertLeadToCustomer()
 * (lib/leadWorkflow.ts) copies the lead's already-normalized document list
 * onto the new customer record once, at conversion time — the same document
 * reference (same Storage URL), not a re-upload. That one-time copy remains
 * untouched by this change.
 */
import { useMemo, useCallback } from 'react';
import DocumentManager, { NeozyDocument } from '../../../../components/shared/DocumentManager';
import { CustomerDomainService } from '../../../../services/CustomerDomainService';
import { useCurrentUser } from '../../../../store/useAppStore';
import { useCaseDocuments, useInvalidateCaseDocuments, resolveDocumentsFor, createCaseDocument, deleteCaseDocument, type CaseDocument } from '../../../../lib/caseDocuments';
import { resolveWriteCompanyId } from '../../../../lib/firestore';
import { captureLocation } from '../../../../lib/geo';

interface Props {
  customer: any;
  isEditing: boolean;
  activeCompanyId: string;
  onSaved: () => void;
}

/** Legacy single-slot document fields carried by older customer records —
 * matches the fields the retired CustomerDetailModal's Documents tab read
 * (CUSTOMER_WORKSPACE_FINAL_PRODUCTION_CERTIFICATION.md popup retirement). */
const LEGACY_SLOTS: { name: string; url: string; mime: string; size: string; date: string; label: string }[] = [
  { name: 'billUploadName',         url: 'billUploadUrl',         mime: 'billUploadMimeType',         size: 'billUploadSize',         date: 'billUploadDate',         label: 'Bill Upload' },
  { name: 'gstFileName',             url: 'gstUrl',                 mime: 'gstMimeType',                 size: 'gstSize',                 date: 'gstDate',                 label: 'GST Certificate' },
  { name: 'agreementFileName',       url: 'agreementUrl',           mime: 'agreementMimeType',           size: 'agreementSize',           date: 'agreementDate',           label: 'Agreement' },
  { name: 'panFileName',             url: 'panUrl',                 mime: 'panMimeType',                 size: 'panSize',                 date: 'panDate',                 label: 'PAN Card' },
  { name: 'electricityBillFileName', url: 'electricityBillUrl',     mime: 'electricityBillMimeType',     size: 'electricityBillSize',     date: 'electricityBillDate',     label: 'Electricity Bill' },
  { name: 'aadhaarFileName',         url: 'aadhaarUrl',             mime: 'aadhaarMimeType',             size: 'aadhaarSize',             date: 'aadhaarDate',             label: 'Aadhaar Card' },
  { name: 'attachmentName',          url: 'attachmentUrl',          mime: 'attachmentMimeType',          size: 'attachmentSize',          date: 'attachmentDate',          label: 'Attachment' },
];

/** Stable deterministic id for legacy-derived entries so re-normalization is idempotent. */
function legacyId(slot: string, name: string): string {
  return `legacy-${slot}-${name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
}

export function normalizeCustomerDocuments(customer: any): NeozyDocument[] {
  const list: NeozyDocument[] = [];
  const seenNames = new Set<string>();

  // 1) New model — customer.documents array (preferred, authoritative). This
  // is also where a converted lead's documents land (copied once, at
  // conversion time, by convertLeadToCustomer() — same reference, not a
  // re-upload) — so a document already visible in the Lead Workspace before
  // conversion appears here too, with no duplicate upload.
  if (Array.isArray(customer?.documents)) {
    customer.documents.forEach((d: any, i: number) => {
      if (!d || !d.name) return;
      list.push({
        id: d.id || legacyId('array', `${d.name}-${i}`),
        name: d.name,
        url: d.url,
        mimeType: d.mimeType,
        size: d.size,
        uploadedAt: d.uploadedAt || d.date || customer?.createdAt,
        label: d.label,
        uploadedBy: d.uploadedBy,
        uploaderName: d.uploaderName,
      });
      seenNames.add(d.name.toLowerCase());
    });
  }

  // 2) Legacy single-slot fields — only add if not already represented by an array entry.
  LEGACY_SLOTS.forEach((slot) => {
    const name = customer?.[slot.name];
    if (!name || seenNames.has(String(name).toLowerCase())) return;
    seenNames.add(String(name).toLowerCase());
    list.push({
      id: legacyId(slot.name, name),
      name,
      url: customer?.[slot.url],
      mimeType: customer?.[slot.mime],
      size: customer?.[slot.size],
      uploadedAt: customer?.[slot.date] || customer?.createdAt,
      label: slot.label,
    });
  });

  const legacyFile = customer?.fileName;
  if (legacyFile && !seenNames.has(String(legacyFile).toLowerCase())) {
    list.push({
      id: legacyId('fileName', legacyFile),
      name: legacyFile,
      url: customer?.fileUrl,
      uploadedAt: customer?.createdAt,
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
    location: doc.location,
  };
}

export default function CustomerWorkspaceDocumentsSection({ customer, isEditing, activeCompanyId, onSaved }: Props) {
  const currentUser = useCurrentUser();
  const { data: allCaseDocs = [] } = useCaseDocuments();
  const invalidateCaseDocuments = useInvalidateCaseDocuments();

  const scope = useMemo(() => ({
    customerId: customer?.id,
    leadId: customer?.sourceLeadId || undefined,
    caseId: customer?.caseId || undefined,
  }), [customer]);

  const sharedDocs = useMemo(() => resolveDocumentsFor(scope, allCaseDocs), [scope, allCaseDocs]);
  const legacyDocs = useMemo(() => normalizeCustomerDocuments(customer), [customer]);

  const documents = useMemo(() => {
    const sharedIds = new Set(sharedDocs.map((d) => d.id));
    return [...sharedDocs.map(toNeozyDocument), ...legacyDocs.filter((d) => !sharedIds.has(d.id))];
  }, [sharedDocs, legacyDocs]);

  const storagePath = `companies/${resolveWriteCompanyId()}/customers/${customer?.id || 'customer'}/documents`;

  const handleChange = useCallback(async (next: NeozyDocument[]) => {
    if (!customer?.id) return;
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
        location: doc.location,
        sourceEntityType: 'customer',
      })),
      ...removedFromShared.map((id) => deleteCaseDocument(id)),
    ]);

    if (removedFromLegacy.length) {
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
      await CustomerDomainService.update(customer.id, payload);
    }

    invalidateCaseDocuments();
    onSaved();
  }, [customer, documents, sharedDocs, legacyDocs, scope, currentUser, invalidateCaseDocuments, onSaved]);

  const handleCaptureLocation = useCallback(async () => {
    try {
      return await captureLocation();
    } catch {
      // GPS failure is non-fatal for document capture — the upload proceeds without location.
      return undefined;
    }
  }, []);

  return (
    <DocumentManager
      documents={documents}
      isEditing={isEditing}
      storagePath={storagePath}
      onChange={handleChange}
      maxDocuments={2}
      currentUser={{ id: currentUser.id, name: currentUser.name }}
      captureMode="both"
      onCaptureLocation={handleCaptureLocation}
    />
  );
}
