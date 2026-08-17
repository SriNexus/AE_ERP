/**
 * ProjectWorkspaceDocumentsSection — Project Workspace adapter over the
 * generic Neozy DocumentManager (src/components/shared/DocumentManager.tsx)
 * — the SAME shared component CustomerWorkspaceDocumentsSection.tsx and
 * LeadWorkspaceDocumentsSection.tsx already wrap.
 *
 * Shared Documents Architecture mission: this adapter no longer treats
 * project.documents as its own private store. It reads/writes through
 * lib/caseDocuments.ts's ONE shared COLLECTIONS.DOCUMENTS collection —
 * matched by projectId/customerId/leadId/caseId — so a document uploaded
 * here is the SAME record the related Customer/Lead Workspace see, not a
 * copy. See caseDocuments.ts's own doc comment for the full rationale
 * (why a copy-based mirror was rejected, why caseId alone isn't enough,
 * how legacy data is preserved).
 *
 * Legacy safety: project.documents (including any earlier Survey-mirror
 * copies) is NOT deleted or migrated — it is merged into the displayed
 * list (de-duplicated by id) so no existing document ever disappears.
 * New uploads and deletes of already-shared documents go through the new
 * collection; deletes of a still-legacy-only entry fall back to updating
 * project.documents directly, exactly as before, until it naturally moves
 * to the shared collection.
 */
import { useCallback, useMemo } from 'react';
import DocumentManager, { NeozyDocument } from '../../../../components/shared/DocumentManager';
import { updateDocById, resolveWriteCompanyId } from '../../../../lib/firestore';
import { COLLECTIONS } from '../../../../lib/firebase';
import { useCurrentUser } from '../../../../store/useAppStore';
import { useCaseDocuments, useInvalidateCaseDocuments, resolveDocumentsFor, createCaseDocument, deleteCaseDocument, type CaseDocument } from '../../../../lib/caseDocuments';
import type { ProjectRecord } from '../../types';

interface Props {
  project: ProjectRecord;
  isEditing: boolean;
  activeCompanyId: string;
  onSaved: () => void;
}

/** Exported so a future conversion/linking flow could reuse it the same way
 * leadWorkflow.ts reuses Lead's normalizeDocuments() — no duplicate mapping
 * logic if that's ever needed. Still the reader for the LEGACY
 * project.documents array (kept for backward compatibility — see file
 * doc comment). */
export function normalizeProjectDocuments(project: ProjectRecord): NeozyDocument[] {
  if (!Array.isArray(project?.documents)) return [];
  return project.documents
    .filter((d: any) => d && d.name)
    .map((d: any, i: number) => ({
      id: d.id || `doc-${i}-${d.name}`,
      name: d.name,
      url: d.url,
      mimeType: d.mimeType,
      size: d.size,
      uploadedAt: d.uploadedAt || d.date || project?.createdAt,
      label: d.label,
      uploadedBy: d.uploadedBy,
      uploaderName: d.uploaderName,
    }));
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

export default function ProjectWorkspaceDocumentsSection({ project, isEditing, activeCompanyId, onSaved }: Props) {
  const currentUser = useCurrentUser();
  const { data: allCaseDocs = [] } = useCaseDocuments();
  const invalidateCaseDocuments = useInvalidateCaseDocuments();

  const scope = useMemo(() => ({
    projectId: project?.id,
    customerId: project?.customerId || undefined,
    leadId: project?.leadId || undefined,
    caseId: (project as any)?.caseId || undefined,
  }), [project]);

  const sharedDocs = useMemo(() => resolveDocumentsFor(scope, allCaseDocs), [scope, allCaseDocs]);
  const legacyDocs = useMemo(() => normalizeProjectDocuments(project), [project]);

  const documents = useMemo(() => {
    const sharedIds = new Set(sharedDocs.map((d) => d.id));
    return [...sharedDocs.map(toNeozyDocument), ...legacyDocs.filter((d) => !sharedIds.has(d.id))];
  }, [sharedDocs, legacyDocs]);

  const storagePath = `companies/${resolveWriteCompanyId()}/projects/${project?.id || 'project'}/documents`;

  const handleChange = useCallback(async (next: NeozyDocument[]) => {
    if (!project?.id) return;
    const prevIds = new Set(documents.map((d) => d.id));
    const nextIds = new Set(next.map((d) => d.id));

    const added = next.filter((d) => !prevIds.has(d.id));
    const removedIds = documents.filter((d) => !nextIds.has(d.id)).map((d) => d.id);
    const sharedIdSet = new Set(sharedDocs.map((d) => d.id));
    const removedFromShared = removedIds.filter((id) => sharedIdSet.has(id));
    const removedFromLegacyOnly = removedIds.filter((id) => !sharedIdSet.has(id));

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
        sourceEntityType: 'project',
      })),
      ...removedFromShared.map((id) => deleteCaseDocument(id)),
    ]);

    if (removedFromLegacyOnly.length) {
      const nextLegacy = legacyDocs.filter((d) => !removedFromLegacyOnly.includes(d.id));
      await updateDocById(COLLECTIONS.PROJECTS, project.id, { documents: nextLegacy });
    }

    invalidateCaseDocuments();
    onSaved();
  }, [project, documents, sharedDocs, legacyDocs, scope, currentUser, invalidateCaseDocuments, onSaved]);

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
