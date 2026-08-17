/**
 * UniversalAttachmentsTab — Ad-hoc file attachments tab
 *
 * Phase 0C: Distinction from Documents:
 * - Attachments = ad-hoc files (screenshots, scanned notes)
 * - Documents = formal business documents (quotation PDF, signed handover)
 *
 * Features:
 * - List of file references from record.photos[] or record.attachments[]
 * - Preview support via DocumentViewer (images)
 * - Download support
 * - Permission aware
 * - Empty state: "No attachments yet."
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Paperclip, Download, Eye, Trash2, Image, File } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { EmptyState } from '../EmptyState';
import { DocumentViewer } from '../DocumentViewer';
import type { DocumentViewerFile } from '../DocumentViewer';
import type { UniversalTabProps } from '../../../types';

// ── Attachment interface ────────────────────────────────────

interface Attachment {
  id: string;
  name: string;
  url?: string;
  mimeType?: string;
  size?: number;
  type: 'image' | 'file';
  uploadedAt?: string;
}

// ── Main Component ──────────────────────────────────────────

export function UniversalAttachmentsTab({
  permissions,
  record,
}: UniversalTabProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerDoc, setViewerDoc] = useState<DocumentViewerFile | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  // Extract attachments from record.photos[] or record.attachments[]
  useEffect(() => {
    if (!record) {
      setAttachments([]);
      setLoading(false);
      return;
    }

    const items = (record as any).photos || (record as any).attachments || (record as any).images || [];
    const mapped: Attachment[] = items.map((item: any, index: number) => {
      const url = item.url || item.path || item.dataUrl || item;
      const name = item.name || item.fileName || `Attachment ${index + 1}`;
      const isImage = typeof url === 'string' && (
        url.startsWith('data:image') ||
        url.match(/\.(jpg|jpeg|png|webp|gif|svg|bmp)(\?.*)?$/i) ||
        item.type?.startsWith('image/')
      );

      return {
        id: item.id || `att-${index}`,
        name,
        url: typeof url === 'string' ? url : undefined,
        mimeType: item.mimeType || item.type || (isImage ? 'image/jpeg' : ''),
        size: item.size || 0,
        type: isImage ? 'image' : 'file',
        uploadedAt: item.uploadedAt || item.createdAt || '',
      };
    });

    setAttachments(mapped);
    setLoading(false);
  }, [record]);

  const handleView = useCallback((att: Attachment) => {
    if (!att.url) return;
    setViewerDoc({
      name: att.name,
      url: att.url,
      mimeType: att.mimeType,
      size: att.size,
    });
    setViewerOpen(true);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewerOpen(false);
    setTimeout(() => setViewerDoc(null), 200);
  }, []);

  const handleDownload = useCallback((att: Attachment) => {
    if (!att.url) return;
    const a = window.document.createElement('a');
    a.href = att.url;
    a.download = att.name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }, []);

  const sorted = useMemo(
    () => [...attachments].sort((a, b) => {
      if (!a.uploadedAt) return 1;
      if (!b.uploadedAt) return -1;
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    }),
    [attachments],
  );

  if (loading) {
    return (
      <div className="p-6 grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="aspect-square bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
          <Paperclip className="h-4 w-4" />
          <span>
            {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Attachment grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {sorted.length === 0 ? (
            <EmptyState
              title="No attachments yet."
              description="Upload files to attach to this record."
              compact
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {sorted.map((att) => (
                <div
                  key={att.id}
                  className="group relative aspect-square rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] overflow-hidden hover:border-[var(--color-border)] transition-all duration-150"
                >
                  {/* Thumbnail or icon */}
                  {att.type === 'image' && att.url ? (
                    <img
                      src={att.url}
                      alt={att.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <File className="h-8 w-8 text-[var(--color-text-muted)]" />
                      <span className="text-[10px] text-[var(--color-text-muted)] text-center px-2 truncate max-w-full">
                        {att.name}
                      </span>
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-150 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    {att.url && (
                      <button
                        type="button"
                        onClick={() => handleView(att)}
                        className="p-1.5 rounded-lg bg-white/90 text-slate-800 hover:bg-white transition-colors"
                        title="Preview"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    )}
                    {att.url && (
                      <button
                        type="button"
                        onClick={() => handleDownload(att)}
                        className="p-1.5 rounded-lg bg-white/90 text-slate-800 hover:bg-white transition-colors"
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* File name */}
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
                    <p className="text-[10px] text-white truncate">{att.name}</p>
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

export default UniversalAttachmentsTab;
