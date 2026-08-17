import { useMemo, useState, type ChangeEvent } from 'react';
import toast from 'react-hot-toast';

import { CalendarDays, FileText, ImageIcon, Paperclip, Upload, X } from 'lucide-react';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { cn } from '../../utils/cn';
import { isLoadableUrl } from '../../lib/url';
import { fmtDateTime } from '../../lib/firestore';

export interface VaultDocument {
  id: string;
  name: string;
  url?: string;
  type?: string;
  size?: number;
  uploadedAt?: string;
  uploadedBy?: string;
  category?: string;
  description?: string;
}

export interface DocumentVaultProps {
  documents?: VaultDocument[];
  title?: string;
  description?: string;
  accept?: string;
  multiple?: boolean;
  uploadLabel?: string;
  emptyLabel?: string;
  loading?: boolean;
  readOnly?: boolean;
  maxItems?: number;
  className?: string;
  onUpload?: (files: File[]) => void | Promise<void>;
  onDelete?: (doc: VaultDocument) => void | Promise<void>;
  onOpen?: (doc: VaultDocument) => void;
}

export function formatVaultFileSize(size?: number) {
  const bytes = Number(size || 0);
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Number(mb.toFixed(mb >= 10 ? 0 : 1))} MB`;
  const kb = bytes / 1024;
  return `${Number(kb.toFixed(kb >= 10 ? 0 : 1))} KB`;
}

export function normalizeVaultDocuments(documents: VaultDocument[] = []) {
  return [...documents]
    .filter((doc) => Boolean(doc?.id && doc?.name))
    .sort((a, b) => {
      const left = new Date(String(b.uploadedAt || '')).getTime();
      const right = new Date(String(a.uploadedAt || '')).getTime();
      return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
    });
}

function documentIcon(type?: string) {
  const value = String(type || '').toLowerCase();
  if (value.includes('image')) return <ImageIcon className="h-4 w-4" />;
  if (value.includes('pdf')) return <FileText className="h-4 w-4" />;
  return <Paperclip className="h-4 w-4" />;
}

export function DocumentVault({
  documents = [],
  title = 'Document Vault',
  description,
  accept = '*/*',
  multiple = true,
  uploadLabel = 'Upload',
  emptyLabel = 'No documents uploaded yet.',
  loading = false,
  readOnly = false,
  maxItems,
  className,
  onUpload,
  onDelete,
  onOpen,
}: DocumentVaultProps) {
  const [preview, setPreview] = useState<VaultDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = useMemo(() => normalizeVaultDocuments(documents), [documents]);
  const fileCount = normalized.length;

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || !onUpload) return;
    setBusy(true);
    try {
      await onUpload(files);
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
          {description && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</p>}
        </div>
        {!readOnly && onUpload && (
          <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] transition hover:bg-[var(--color-surface-hover)]', (busy || loading || (typeof maxItems === 'number' && fileCount >= maxItems)) && 'cursor-not-allowed opacity-50')}>
            <Upload className="h-3.5 w-3.5" />
            {busy ? 'Uploading…' : uploadLabel}
            <input
              type="file"
              className="hidden"
              accept={accept}
              multiple={multiple}
              disabled={busy || loading || (typeof maxItems === 'number' && fileCount >= maxItems)}
              onChange={handleUpload}
            />
          </label>
        )}
      </div>

      <div className="p-4">
        {normalized.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-4 py-10 text-center">
            <Paperclip className="h-8 w-8 text-[var(--color-text-disabled)]" />
            <p className="text-sm text-[var(--color-text-muted)]">{emptyLabel}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {normalized.map((doc) => (
              <div
                key={doc.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (doc.url) setPreview(doc);
                    onOpen?.(doc);
                  }}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
                    {documentIcon(doc.type)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--color-text)]">{doc.name}</p>
                      {doc.category && <Badge variant="info">{doc.category}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                      <span>{formatVaultFileSize(doc.size)}</span>
                      {doc.uploadedAt && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{fmtDateTime(doc.uploadedAt)}</span>}
                      {doc.uploadedBy && <span>By {doc.uploadedBy}</span>}
                    </div>
                    {doc.description && <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{doc.description}</p>}
                  </div>
                </button>

                {!readOnly && onDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    icon={<X className="h-3.5 w-3.5" />}
                    onClick={() => onDelete(doc)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={Boolean(preview?.url)} onClose={() => setPreview(null)} title={preview?.name} size="lg">
        {preview?.url && isLoadableUrl(preview.url) ? (
          <div className="space-y-4">
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[60vh] w-full rounded-2xl border border-[var(--color-border)] object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--color-text-secondary)]">
              <span>{formatVaultFileSize(preview.size)}</span>
              <span>{preview.uploadedAt ? fmtDateTime(preview.uploadedAt) : '—'}</span>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
