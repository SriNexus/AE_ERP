/**
 * DocumentViewer — Shared document preview component for Neozy
 *
 * Supports:
 *   - Images: jpg, png, webp (inline preview)
 *   - PDF: embedded viewer
 *   - Unsupported files: graceful fallback with download option
 *
 * Used by: Leads, Customers, Quotations, Projects, Orders, Service, AMC
 *
 * Desktop: Opens in a centered modal
 * Mobile:  Opens as a full-screen modal
 */

import { useState, useCallback } from 'react';
import { Download, ExternalLink, File, FileImage, FileText, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { isLoadableUrl } from '../../lib/url';

export type SupportedFormat = 'image' | 'pdf' | 'unsupported';

export function detectDocumentFormat(url?: string, mimeType?: string): SupportedFormat {
  if (!url) return 'unsupported';
  // Demo placeholders (demo://) and other non-fetchable schemes must never be
  // mounted into <img>/<iframe> src — that triggers ERR_UNKNOWN_URL_SCHEME.
  if (!isLoadableUrl(url)) return 'unsupported';
  // Check mime type first
  if (mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'application/pdf') return 'pdf';
    return 'unsupported';
  }
  // Fall back to extension
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'unsupported';
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(1)} ${units[unitIdx]}`;
}

/**
 * forceDownload — reliably downloads a file without opening a new tab.
 *
 * Cross-origin URLs (Firebase Storage) ignore the `download` attribute on an
 * anchor, which is why the previous implementation opened a new tab instead.
 * Fetching the file as a blob makes the browser download it directly.
 */
export async function forceDownload(url: string, name: string): Promise<void> {
  if (!isLoadableUrl(url)) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = objectUrl;
    a.download = name || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  } catch {
    // Fallback: plain anchor without target=_blank (best-effort download)
    const a = window.document.createElement('a');
    a.href = url;
    a.download = name || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

export interface DocumentViewerFile {
  /** Display name of the document */
  name: string;
  /** URL to view/download the document */
  url?: string;
  /** MIME type for format detection */
  mimeType?: string;
  /** File size in bytes */
  size?: number;
}

interface DocumentViewerProps {
  /** The document to view */
  document: DocumentViewerFile | null;
  /** Whether the viewer is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Optional title override (defaults to document name) */
  title?: string;
  /** Whether to render in full-screen mode (for mobile) */
  fullScreen?: boolean;
}

export interface DocumentPreviewContentProps {
  doc: DocumentViewerFile;
  onDownload: () => void;
  onOpenNewTab: () => void;
  /** <img> sizing class — default fits a modal (70vh tall). Pass a taller/
   * flex-based class (e.g. 'h-full max-w-full object-contain') for an inline
   * panel that fills its own container. */
  imgClassName?: string;
  /** PDF <iframe> wrapper height class — default fits a modal (70vh tall). */
  pdfHeightClassName?: string;
}

/**
 * DocumentPreviewContent — the actual format-aware preview body (image /
 * PDF / unsupported-fallback), extracted so it can render BOTH inside this
 * modal AND inline in a larger surface (DocumentManager's premium Documents
 * tab panel) without duplicating the image/PDF/fallback logic twice.
 */
export function DocumentPreviewContent({
  doc, onDownload, onOpenNewTab,
  imgClassName = 'max-h-[70vh] max-w-full rounded-lg object-contain shadow-md',
  pdfHeightClassName = 'h-[70vh]',
}: DocumentPreviewContentProps) {
  const [loadError, setLoadError] = useState(false);
  const format = detectDocumentFormat(doc.url, doc.mimeType);

  if (!doc.url) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-[var(--color-text-muted)]">
        <File className="h-16 w-16" />
        <p className="text-sm font-medium">{doc.name}</p>
        <p className="text-xs">Document URL not available</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-[var(--color-text-muted)]">
        <FileText className="h-16 w-16 text-red-400" />
        <p className="text-sm font-medium">Failed to load document</p>
        <p className="text-xs">The file may have been moved or deleted</p>
        <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={onDownload}>
          Download Instead
        </Button>
      </div>
    );
  }

  switch (format) {
    case 'image':
      // Deliberately no h-full here: the wrapper must size itself to the
      // image's own rendered dimensions (capped by imgClassName's max-h/
      // max-w, both viewport-relative so they never depend on an ancestor
      // having a definite height), not stretch to fill whatever space a
      // parent panel happens to have — that's what produced a big empty
      // box around a small image previously.
      return (
        <div className="flex items-center justify-center p-2">
          <img
            src={doc.url}
            alt={doc.name}
            className={imgClassName}
            onError={() => setLoadError(true)}
          />
        </div>
      );

    case 'pdf':
      return (
        <div className={['flex w-full flex-col', pdfHeightClassName].join(' ')}>
          <iframe
            src={`${doc.url}#view=FitH`}
            title={doc.name}
            className="h-full w-full rounded-lg border-0"
            onError={() => setLoadError(true)}
          />
          <div className="mt-2 flex items-center justify-between px-1 text-xs text-[var(--color-text-muted)]">
            <span>PDF document</span>
            <Button size="xs" variant="outline" icon={<ExternalLink className="h-3 w-3" />} onClick={onOpenNewTab}>
              Open in new tab
            </Button>
          </div>
        </div>
      );

    case 'unsupported':
    default:
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-[var(--color-text-muted)]">
          <File className="h-16 w-16 text-amber-400" />
          <p className="text-sm font-medium">{doc.name}</p>
          <p className="text-xs">Preview not available for this file type</p>
          {isLoadableUrl(doc.url) && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={onDownload}>
                Download
              </Button>
              <Button size="sm" variant="outline" icon={<ExternalLink className="h-4 w-4" />} onClick={onOpenNewTab}>
                Open in new tab
              </Button>
            </div>
          )}
        </div>
      );
  }
}

export function DocumentViewer({ document, open, onClose, title, fullScreen = false }: DocumentViewerProps) {
  const doc = document;
  const format = doc ? detectDocumentFormat(doc.url, doc.mimeType) : 'unsupported';
  const displayTitle = title || doc?.name || 'Document';
  const sizeLabel = doc?.size ? formatFileSize(doc.size) : '';

  const handleDownload = useCallback(() => {
    if (!doc?.url || !isLoadableUrl(doc.url)) return;
    void forceDownload(doc.url, doc.name || 'document');
  }, [doc]);

  const handleOpenNewTab = useCallback(() => {
    if (!doc?.url || !isLoadableUrl(doc.url)) return;
    window.open(doc.url, '_blank', 'noopener,noreferrer');
  }, [doc]);

  if (!doc) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={displayTitle}
      size={fullScreen ? 'full' : '3xl'}
    >
      {sizeLabel && (
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">{sizeLabel}</p>
      )}
      <div className="min-h-0 flex-1">
        <DocumentPreviewContent doc={doc} onDownload={handleDownload} onOpenNewTab={handleOpenNewTab} />
      </div>
      {doc.url && isLoadableUrl(doc.url) && (
        <div className="mt-4 flex items-center justify-center gap-2 border-t border-[var(--color-border-subtle)] pt-4" data-action>
          <Button size="xs" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={handleDownload}>
            {format === 'unsupported' ? 'Download File' : 'Download'}
          </Button>
          <Button size="xs" variant="outline" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={handleOpenNewTab}>
            Open in New Tab
          </Button>
        </div>
      )}
    </Modal>
  );
}

/**
 * Convenience hook for managing DocumentViewer open/close state
 */
export function useDocumentViewer() {
  const [doc, setDoc] = useState<DocumentViewerFile | null>(null);
  const [open, setOpen] = useState(false);

  const viewDocument = useCallback((file: DocumentViewerFile) => {
    setDoc(file);
    setOpen(true);
  }, []);

  const closeViewer = useCallback(() => {
    setOpen(false);
    // Delay clearing doc so the close animation plays
    setTimeout(() => setDoc(null), 200);
  }, []);

  return {
    doc,
    open,
    viewDocument,
    closeViewer,
  };
}

export default DocumentViewer;
