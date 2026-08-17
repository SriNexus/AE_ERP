/**
 * DocumentManager — Generic reusable Neozy document manager.
 *
 * Intended to become the standard document manager across all Neozy modules:
 * Lead, Customer, Employee, Project, Vendor, AMC, Service, Installation, etc.
 *
 * DESIGN (list-based data model — NO single-slot overwrite):
 *   Documents are stored as an ordered array of NeozyDocument entries:
 *
 *     documents: NeozyDocument[] = [
 *       { id, name, url, mimeType, size, uploadedAt, label? },
 *       ...
 *     ]
 *
 *   Every upload APPENDS to the list. Nothing is ever overwritten unless the
 *   operator explicitly deletes it. The owner entity persists the array through
 *   the `onChange` callback.
 *
 * FEATURES:
 *   - Append-only upload (never replaces previous documents)
 *   - Upload progress state + immediate list refresh (no page reload)
 *   - Premium master-detail layout: a document list on the left, a large
 *     inline preview (image/PDF rendered directly, no modal needed to just
 *     look at a file) on the right — sized for a spacious center-panel
 *     Documents tab, not a cramped sidebar.
 *   - "Expand" still opens the full DocumentViewer modal for an even bigger
 *     look, reusing the same modal/hook — not a second preview implementation.
 *   - True download (fetch→blob) — never opens a new tab
 *   - Per-document delete with inline confirmation (edit mode only)
 *   - Empty state with upload CTA
 *
 * REUSED:
 *   - uploadFile from lib/storage (Firebase Storage pipeline + demo object-URL fallback)
 *   - DocumentViewer / DocumentPreviewContent / useDocumentViewer / formatFileSize / forceDownload from shared/DocumentViewer
 *   - genId from lib/firestore for document entry ids
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { File as FileIcon, FileImage, FileText, UploadCloud, Download, Trash2, X, Maximize2 } from 'lucide-react';
import { DocumentViewer, DocumentPreviewContent, useDocumentViewer, formatFileSize, forceDownload } from './DocumentViewer';
import { isLoadableUrl } from '../../lib/url';
import { uploadFile } from '../../lib/storage';
import { firebaseEnv } from '../../lib/firebase';
import { genId } from '../../lib/firestore';

export interface NeozyDocument {
  /** Stable unique id for this document entry */
  id: string;
  /** Original file name */
  name: string;
  /** Download/preview URL (Firebase Storage or object URL in demo) */
  url?: string;
  /** MIME type, when known */
  mimeType?: string;
  /** File size in bytes, when known */
  size?: number;
  /** Upload date (ISO string), when known */
  uploadedAt?: string;
  /** Optional category label (e.g. 'Electricity Bill', 'Agreement') */
  label?: string;
  /** User id of the uploader, when known */
  uploadedBy?: string;
  /** Display name of the uploader, when known */
  uploaderName?: string;
}

interface DocumentManagerProps {
  /** Current list of documents (source of truth owned by the parent entity) */
  documents: NeozyDocument[];
  /** Whether the manager is in edit mode (enables upload + delete) */
  isEditing?: boolean;
  /** Firebase Storage folder path, e.g. `companies/{companyId}/leads/{leadId}/documents` */
  storagePath: string;
  /** Persist the updated list. Called after every append/delete. */
  onChange: (docs: NeozyDocument[]) => void | Promise<void>;
  /** Section title (default: 'Documents') */
  title?: string;
  /** Accepted file types for the upload picker */
  accept?: string;
  /** Empty-state message */
  emptyText?: string;
  /** Optional cap on total documents. When set, uploads beyond this count are rejected with a clear message. Omit for no limit. */
  maxDocuments?: number;
  /** Current user, for uploader attribution. Omit to leave uploader fields blank. */
  currentUser?: { id: string; name: string };
}

/** Hard cap enforced on every upload, after any compression attempt. */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Client-side compression for image uploads — downsamples to a sane max
 * dimension and re-encodes as JPEG at moderate quality before the file ever
 * reaches Firebase Storage. Non-image files (PDF, docx, audio, video, etc.)
 * pass through unchanged: meaningful audio/video compression needs a real
 * transcoder (server-side, or a multi-MB WASM one client-side), which is out
 * of scope here — they're still accepted, just subject to the same size cap
 * as everything else. Falls back to the original file on any error. */
async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  const MAX_DIMENSION = 1600;
  const QUALITY = 0.8;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 1_000_000) return file; // already small enough, skip work
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file; // compression didn't help, keep original
    const compressedName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], compressedName, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file; // never block an upload because compression failed
  }
}

function getDocumentIcon(mimeType?: string, name?: string) {
  if (!mimeType && !name) return <FileIcon className="h-4 w-4" />;
  if (mimeType?.startsWith('image/')) return <FileImage className="h-4 w-4 text-emerald-500" />;
  if (mimeType === 'application/pdf' || name?.toLowerCase().endsWith('.pdf')) return <FileText className="h-4 w-4 text-red-400" />;
  return <FileIcon className="h-4 w-4 text-[var(--color-text-muted)]" />;
}

function getFileTypeLabel(mimeType?: string, name?: string): string {
  if (mimeType?.startsWith('image/')) return 'Image';
  if (mimeType === 'application/pdf' || name?.toLowerCase().endsWith('.pdf')) return 'PDF';
  return 'Document';
}

/** Circular icon-only action button — deliberately hardcoded `rounded-full`
 * rather than the shared `--theme-radius` token, since "circular" here is a
 * specific request that must hold regardless of a tenant's chosen corner-
 * radius theme (the header's own Call/WhatsApp/Email chips already follow
 * the same precedent of a fixed, non-tokenized shape). */
function DocCircleButton({
  icon, onClick, title, tone = 'neutral',
}: { icon: React.ReactNode; onClick: () => void; title: string; tone?: 'neutral' | 'primary' | 'danger' }) {
  const toneCls = tone === 'primary'
    ? 'text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] hover:border-[var(--color-primary)]'
    : tone === 'danger'
      ? 'text-red-500 hover:bg-red-50 hover:border-red-200 dark:hover:bg-red-900/20 dark:hover:border-red-800'
      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)]';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={[
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition-all',
        'hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1',
        toneCls,
      ].join(' ')}
    >
      {icon}
    </button>
  );
}

function docDateLabel(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function DocumentManager({
  documents,
  isEditing = false,
  storagePath,
  onChange,
  title = 'Documents',
  accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,audio/*,video/*',
  emptyText = 'No documents uploaded yet.',
  maxDocuments,
  currentUser,
}: DocumentManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { doc: viewerDoc, open: viewerOpen, viewDocument, closeViewer } = useDocumentViewer();

  // Local mirror of the list so uploads/deletes reflect immediately without a
  // page refresh. Re-syncs when the parent pushes a fresh list back.
  const [docs, setDocs] = useState<NeozyDocument[]>(documents);
  const prevDocsRef = useRef(documents);
  useEffect(() => {
    if (prevDocsRef.current !== documents) {
      prevDocsRef.current = documents;
      setDocs(documents);
    }
  }, [documents]);

  // Master-detail selection for the inline preview pane — defaults to the
  // first document, and re-settles onto a valid entry whenever the list
  // changes (e.g. the selected document was just deleted, or the list just
  // loaded for the first time).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!docs.some(d => d.id === selectedId)) {
      setSelectedId(docs[0]?.id ?? null);
    }
  }, [docs, selectedId]);
  const selectedDoc = docs.find(d => d.id === selectedId) || null;

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof maxDocuments === 'number' && docs.length >= maxDocuments) {
      toast.error(`Maximum of ${maxDocuments} document${maxDocuments === 1 ? '' : 's'} allowed. Remove one before uploading another.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    // Deliberately no same-filename block: two different real files (e.g. two
    // phone photos both named IMG_0001.jpg) can share a name — each upload
    // still gets its own unique id/url/timestamp and must render as its own
    // card, never be treated as a duplicate to reject.

    setUploading(true);
    const prev = docs;
    try {
      const uploadFileObj = await compressImageIfNeeded(file);

      if (uploadFileObj.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`"${file.name}" is ${formatFileSize(uploadFileObj.size)} — the maximum allowed size is 5 MB.`);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      let downloadUrl: string;
      if (!firebaseEnv.isConfigured) {
        // Demo / offline fallback — the file is immediately usable via a local
        // object URL (same pattern as surveyStorage / engineeringStorage).
        downloadUrl = URL.createObjectURL(uploadFileObj);
      } else {
        downloadUrl = await uploadFile(storagePath, uploadFileObj, true);
      }

      const entry: NeozyDocument = {
        id: genId.generic('DOC'),
        name: file.name,
        url: downloadUrl,
        mimeType: uploadFileObj.type || undefined,
        size: uploadFileObj.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: currentUser?.id,
        uploaderName: currentUser?.name,
      };

      // APPEND — never overwrite the previous list
      const next = [...docs, entry];
      setDocs(next);
      await onChange(next);
      toast.success('Document uploaded');
    } catch (err: any) {
      setDocs(prev);
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [docs, storagePath, onChange]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const prev = docs;
    const target = docs.find(d => d.id === deleteTarget);
    try {
      // Remove ONLY the targeted document — never touch the others
      const next = docs.filter(d => d.id !== deleteTarget);
      setDocs(next);
      await onChange(next);
      toast.success(`Removed ${target?.name || 'document'}`);
      setDeleteTarget(null);
    } catch (err: any) {
      setDocs(prev);
      toast.error(err?.message || 'Failed to remove document');
    }
  }, [deleteTarget, docs, onChange]);

  const handleView = useCallback((doc: NeozyDocument) => {
    if (!doc.url) {
      toast.error('Document file is not available for preview.');
      return;
    }
    viewDocument({
      name: doc.name,
      url: doc.url,
      mimeType: doc.mimeType,
      size: doc.size,
    });
  }, [viewDocument]);

  const handleDownload = useCallback((doc: NeozyDocument) => {
    if (!doc.url) {
      toast.error('Document file is not available for download.');
      return;
    }
    void forceDownload(doc.url, doc.name);
  }, []);

  const handleOpenNewTab = useCallback((doc: NeozyDocument) => {
    if (!doc.url || !isLoadableUrl(doc.url)) return;
    window.open(doc.url, '_blank', 'noopener,noreferrer');
  }, []);

  const atLimit = typeof maxDocuments === 'number' && docs.length >= maxDocuments;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-3 pb-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text)]">{title}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            {docs.length} document{docs.length === 1 ? '' : 's'}
            {typeof maxDocuments === 'number' && <span className="text-[var(--color-text-disabled)]"> · limit {maxDocuments}</span>}
          </p>
        </div>
        {isEditing && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || atLimit}
            title={atLimit ? `Maximum of ${maxDocuments} documents reached` : undefined}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[var(--color-primary-hover)] hover:shadow-md active:translate-y-0 active:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none"
          >
            {uploading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <UploadCloud className="h-3.5 w-3.5" />}
            {uploading ? 'Uploading...' : 'Upload Document'}
          </button>
        )}
        <input
          type="file"
          accept={accept}
          ref={fileInputRef}
          onChange={handleUpload}
          className="hidden"
        />
      </div>

      {/* ── Master-detail: document list + large inline preview ── */}
      {docs.length > 0 ? (
        // items-start (not the default `stretch`): the Preview column must
        // size to its own content — a small image should not be stretched
        // tall just because the document List column happens to be taller.
        <div className="flex min-h-0 flex-1 items-start gap-5">
          {/* List column */}
          <div className="w-full max-w-[300px] shrink-0 space-y-2 overflow-y-auto pr-1">
            {docs.map(doc => {
              const active = doc.id === selectedId;
              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedId(doc.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(doc.id); }}
                  className={[
                    'flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 transition-colors',
                    active
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                      : 'border-[var(--color-border-subtle)] bg-[var(--color-bg)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]',
                  ].join(' ')}
                >
                  <div className="shrink-0">{getDocumentIcon(doc.mimeType, doc.name)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-[var(--color-text)] leading-tight" title={doc.name}>
                      {doc.name}
                    </p>
                    <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      <span className="font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{getFileTypeLabel(doc.mimeType, doc.name)}</span>
                      {doc.size && doc.size > 0 && <span>• {formatFileSize(doc.size)}</span>}
                      {doc.uploaderName && <span>• {doc.uploaderName}</span>}
                    </div>
                  </div>
                  {isEditing && (
                    <DocCircleButton
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      title="Delete document"
                      tone="danger"
                      onClick={() => setDeleteTarget(doc.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Preview column */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)]">
            {selectedDoc && (
              <>
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[var(--color-text)]" title={selectedDoc.name}>{selectedDoc.name}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      <span className="font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{getFileTypeLabel(selectedDoc.mimeType, selectedDoc.name)}</span>
                      {selectedDoc.size && selectedDoc.size > 0 && <span>• {formatFileSize(selectedDoc.size)}</span>}
                      {selectedDoc.uploadedAt && <span>• {docDateLabel(selectedDoc.uploadedAt)}</span>}
                      {selectedDoc.uploaderName && <span>• {selectedDoc.uploaderName}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <DocCircleButton icon={<Download className="h-3.5 w-3.5" />} title="Download document" onClick={() => handleDownload(selectedDoc)} />
                    <DocCircleButton icon={<Maximize2 className="h-3.5 w-3.5" />} title="Expand" tone="primary" onClick={() => handleView(selectedDoc)} />
                  </div>
                </div>
                {/* No flex-1/min-h-0 here — with the row above no longer
                    forcing this column to stretch, this wrapper sizes to
                    its own content (the image's real rendered height,
                    capped at a sane vh so a huge photo can't blow out the
                    layout) instead of reserving a large empty area around
                    a small image. PDF keeps its own generous min-height —
                    a document viewer genuinely needs room to be usable. */}
                <div className="overflow-auto p-4">
                  <DocumentPreviewContent
                    doc={selectedDoc}
                    onDownload={() => handleDownload(selectedDoc)}
                    onOpenNewTab={() => handleOpenNewTab(selectedDoc)}
                    imgClassName="max-h-[65vh] max-w-full rounded-lg object-contain shadow-md"
                    pdfHeightClassName="h-[65vh] min-h-[420px]"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* ── Empty State ────────────────────────────────── */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] py-16 text-center transition-colors hover:border-[var(--color-border-strong)]">
          <UploadCloud className="h-10 w-10 text-[var(--color-text-disabled)]" />
          <p className="text-[13px] font-medium text-[var(--color-text-muted)]">
            {emptyText}
          </p>
          <p className="text-[11px] text-[var(--color-text-disabled)]">
            Upload agreements, identity documents, or supporting files.
          </p>
          {isEditing && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50 shadow-sm"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              {uploading ? 'Uploading...' : 'Upload Document'}
            </button>
          )}
        </div>
      )}

      {/* ── Delete confirmation (per document) ──────────── */}
      {deleteTarget && (
        <div className="mt-3 shrink-0 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-3">
          <p className="text-[11px] font-medium text-red-700 dark:text-red-400">
            Remove this document? Only this file will be deleted — other documents stay.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleDelete}
              className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-red-600 transition-colors"
            >
              <Trash2 className="h-3 w-3" /> Remove
            </button>
            <button
              onClick={() => setDeleteTarget(null)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Fullscreen expand — reuses the same modal viewer for a bigger
           look than the inline pane; not required to see a document (the
           inline preview above already shows it), just a bonus. ── */}
      <DocumentViewer
        document={viewerDoc}
        open={viewerOpen}
        onClose={closeViewer}
      />
    </div>
  );
}
