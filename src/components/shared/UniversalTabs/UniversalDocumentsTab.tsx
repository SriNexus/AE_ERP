/**
 * UniversalDocumentsTab — Document viewer and upload tab
 *
 * Phase 14 (Documents / Activities / Linked Records): this tab is mounted
 * generically for every module that lists 'documents' in its
 * workspaceConfig.ts tab list (Orders, Quotations, Invoices, Dispatch,
 * Payments, and ~14 others — AMC, Commissioning, NetMetering, Subsidy,
 * Handover, QC, Installations, Cases, Partners, Monitoring, Settlements,
 * CommissionRules, CommissionApprovals, ServiceTickets).
 *
 * FRESH-AUDIT FINDING (not in the original Gap Audit/Blueprint text, which
 * only flagged these five entities as having "zero document capability"):
 * this component's PRE-Phase-14 implementation never persisted anything —
 * `handleUpload`/`handleDelete` only mutated local React state seeded from
 * `record.documents[]`/`record.attachments[]` (a private-array-per-entity
 * shape `lib/caseDocuments.ts`'s own doc comment already explains was
 * rejected for Lead/Customer/Project for exactly this reason). A file
 * uploaded here vanished on refresh; a "deleted" document reappeared. This
 * was a real, live bug affecting all ~19 modules that mount this tab, not
 * merely an absent capability for the five Phase 14 owns.
 *
 * FIX: for the five Phase 14 entity types (orders/quotations/invoices/
 * dispatch/payments — ENTITY_SCOPE_FIELD below), this tab now renders
 * ScopedDocumentsTab, which reuses the exact same proven architecture as
 * Lead/Customer/Project (`lib/caseDocuments.ts`'s resolveDocumentsFor()/
 * createCaseDocument()/deleteCaseDocument()` over the one shared
 * COLLECTIONS.DOCUMENTS collection) via the same shared `DocumentManager`
 * UI component — no parallel document mechanism. For every OTHER module
 * still mounting this tab (outside Phase 14's scope), the original
 * LegacyLocalDocumentsTab behavior is preserved byte-for-byte, unchanged —
 * fixing them is a real, tracked, explicitly out-of-scope follow-up (see
 * Blueprint Appendix E), not silently done or silently left broken.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Download, Trash2, Upload, File, Eye } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { Button } from '../../ui/Button';
import { DocumentViewer, formatFileSize } from '../DocumentViewer';
import type { DocumentViewerFile } from '../DocumentViewer';
import { EntityDocumentsPanel, isScopedDocumentEntityType } from '../EntityDocumentsPanel';
import type { UniversalTabProps } from '../../../types';

// ── Phase 14: real, shared-architecture path for the five entities it owns ──

function ScopedDocumentsTab({ entityId, entityType, companyId, record, permissions, caseId }: UniversalTabProps) {
  if (!isScopedDocumentEntityType(entityType)) return null; // unreachable — guarded by the caller below
  // DocumentManager exposes one combined edit toggle (upload+delete) — no
  // separate canCreate/canDelete slots. canCreate is the closer-matching
  // permission for "may attach a supporting file to this record".
  const isEditing = permissions?.canCreate !== false;

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <EntityDocumentsPanel
        entityId={entityId}
        entityType={entityType}
        companyId={companyId}
        record={record}
        caseId={caseId}
        isEditing={isEditing}
      />
    </div>
  );
}

// ── Legacy path — unchanged behavior for every module Phase 14 does not own ──

interface DocRef {
  id: string;
  name: string;
  url?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
  uploadedBy?: string;
}

function LegacyLocalDocumentsTab({
  entityId,
  entityType,
  companyId,
  permissions,
  record,
}: UniversalTabProps) {
  const [documents, setDocuments] = useState<DocRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerDoc, setViewerDoc] = useState<DocumentViewerFile | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Extract documents from record.documents[] or record.attachments[]
  useEffect(() => {
    if (!record) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    const docs = (record as any).documents || (record as any).attachments || [];
    const mapped: DocRef[] = docs.map((doc: any, index: number) => ({
      id: doc.id || `doc-${index}`,
      name: doc.name || doc.fileName || doc.filename || `Document ${index + 1}`,
      url: doc.url || doc.downloadUrl || doc.path,
      mimeType: doc.mimeType || doc.type || doc.contentType || '',
      size: doc.size || doc.fileSize || 0,
      uploadedAt: doc.uploadedAt || doc.createdAt || '',
      uploadedBy: doc.uploadedBy || doc.createdBy || '',
    }));

    setDocuments(mapped);
    setLoading(false);
  }, [record]);

  const handleViewDocument = useCallback((doc: DocRef) => {
    setViewerDoc({
      name: doc.name,
      url: doc.url,
      mimeType: doc.mimeType,
      size: doc.size ?? 0,
    });
    setViewerOpen(true);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewerOpen(false);
    setTimeout(() => setViewerDoc(null), 200);
  }, []);

  const handleUpload = useCallback(async () => {
    // Storage upload requires Firebase configuration.
    // In non-configured environments, show a descriptive message.
    setUploading(true);
    try {
      const { uploadFile } = await import('../../../lib/storage');
      // Create a hidden file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          setUploading(false);
          return;
        }

        try {
          const path = `companies/${companyId}/${entityType}/${entityId}/documents`;
          const url = await uploadFile(path, file, true);

          const newDoc: DocRef = {
            id: `doc-${Date.now()}`,
            name: file.name,
            url,
            mimeType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString(),
          };

          setDocuments((prev) => [...prev, newDoc]);
        } catch (err: any) {
          console.warn('Document upload failed:', err.message);
        } finally {
          setUploading(false);
        }
      };
      input.click();
    } catch {
      setUploading(false);
    }
  }, [companyId, entityId, entityType]);

  const handleDownload = useCallback((doc: DocRef) => {
    if (!doc.url) return;
    const a = window.document.createElement('a');
    a.href = doc.url;
    a.download = doc.name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }, []);

  const handleDelete = useCallback((docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  const canCreate = permissions.canCreate !== false;

  const sortedDocs = useMemo(
    () => [...documents].sort((a, b) => {
      if (!a.uploadedAt) return 1;
      if (!b.uploadedAt) return -1;
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    }),
    [documents],
  );

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <FileText className="h-4 w-4" />
            <span>
              {documents.length} document{documents.length !== 1 ? 's' : ''}
            </span>
          </div>

          {canCreate && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Upload className="h-3.5 w-3.5" />}
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          )}
        </div>

        {/* Document list */}
        <div className="flex-1 overflow-y-auto p-6">
          {sortedDocs.length === 0 ? (
            <EmptyState
              title="No documents yet."
              description="Upload documents to this record."
              compact
            />
          ) : (
            <div className="space-y-2">
              {sortedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:border-[var(--color-border)] transition-all duration-150"
                >
                  {/* Icon */}
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-[var(--color-bg-sunken)] shrink-0">
                    <File className="h-5 w-5 text-[var(--color-text-muted)]" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">
                      {doc.name}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      {!!doc.size && <span>{formatFileSize(doc.size ?? 0)}</span>}
                      {doc.uploadedAt && (
                        <span>
                          {new Date(doc.uploadedAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      )}
                      {!doc.url && (
                        <span className="text-[var(--color-danger)]">(No URL)</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {doc.url && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleViewDocument(doc)}
                          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-sunken)] transition-colors"
                          title="Preview"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownload(doc)}
                          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-sunken)] transition-colors"
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    {permissions.canDelete !== false && (
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-light)] transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Document Viewer Modal */}
      <DocumentViewer
        document={viewerDoc}
        open={viewerOpen}
        onClose={handleCloseViewer}
      />
    </>
  );
}

// ── Entry point ──────────────────────────────────────────────

export function UniversalDocumentsTab(props: UniversalTabProps) {
  if (isScopedDocumentEntityType(props.entityType)) {
    return <ScopedDocumentsTab {...props} />;
  }
  return <LegacyLocalDocumentsTab {...props} />;
}

export default UniversalDocumentsTab;
