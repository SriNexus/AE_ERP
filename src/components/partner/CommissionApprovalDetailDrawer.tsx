/**
 * CommissionApprovalDetailDrawer — Read-only commission approval detail modal
 *
 * Displays: approval info, rule details, documents, activity timeline.
 * Supports Approve/Reject actions with reason input.
 */

import { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, Clock, File, Eye, DollarSign } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { fmtDate, fmtDateTime } from '../../lib/firestore';
import { DocumentViewer, useDocumentViewer, formatFileSize } from '../shared/DocumentViewer';
import type { DocumentViewerFile } from '../shared/DocumentViewer';

interface CommissionApprovalDetailDrawerProps {
  record: any;
  open: boolean;
  onClose: () => void;
  onApprove?: (record: any) => void;
  onReject?: (record: any, reason: string) => void;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0 min-w-[120px]">{label}</span>
      <span className="text-sm font-medium text-[var(--color-text)] text-right break-all">{children}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{value}</div>
    </div>
  );
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const STATUS_BADGE: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  calculated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  approved:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:   'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  paid:       'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  voided:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[s] || 'bg-gray-100 text-gray-600'}`}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}

export function CommissionApprovalDetailDrawer({ record, open, onClose, onApprove, onReject }: CommissionApprovalDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const { doc: viewerDoc, open: viewerOpen, viewDocument, closeViewer } = useDocumentViewer();

  // Document attachments — moved BEFORE early return to preserve hook order
  const documents = useMemo(() => {
    if (!record) return [];
    const p = record as any;
    const docs: { label: string; doc: DocumentViewerFile; metadata: { date?: string; size?: number } }[] = [];
    if (p?.docFileName || p?.docUrl) {
      docs.push({ label: 'Document', doc: { name: p.docFileName || 'document.pdf', url: p.docUrl || '', mimeType: p.docMimeType, size: p.docSize }, metadata: { date: p.docDate || p.createdAt, size: p.docSize } });
    }
    if (p?.attachmentName || p?.fileUrl) {
      docs.push({ label: 'Attachment', doc: { name: p.attachmentName || 'attachment.pdf', url: p.fileUrl || p.attachmentUrl || '', mimeType: p.attachmentMimeType, size: p.attachmentSize }, metadata: { date: p.attachmentDate || p.createdAt, size: p.attachmentSize } });
    }
    return docs.filter((d) => d.doc?.name && d.doc?.url);
  }, [record]);

  if (!record) return null;

  const p = record as any;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'rule', label: 'Rule Details' },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="flex h-[78vh] max-h-[700px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-4">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-[var(--color-primary)]" />
            <div>
              <h2 className="font-semibold text-[var(--color-text)]">
                Commission {p.partnerName ? `— ${p.partnerName}` : ''}
              </h2>
              {p.ruleName && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{p.ruleName}</p>}
            </div>
          </div>
          <StatusBadge status={p.status} />
        </div>

        {/* ── Tabs ─────────────────────────────────────────── */}
        <nav className="shrink-0 flex gap-1 border-b border-[var(--color-border-subtle)] py-3">
          {tabs.map((tab) => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.key ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* ── Tab Content ──────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto pt-4 space-y-4">
          {activeTab === 'overview' && (
            <>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
                <DetailRow label="Record ID"><code className="text-xs font-mono bg-[var(--color-surface)] px-1.5 py-0.5 rounded">{p.id}</code></DetailRow>
                <DetailRow label="Partner">{p.partnerName || p.partnerId || '—'}</DetailRow>
                <DetailRow label="Rule">{p.ruleName || '—'}</DetailRow>
                <DetailRow label="Customer">{p.customerName || '—'}</DetailRow>
                <DetailRow label="Amount">{formatCurrency(p.amount)}</DetailRow>
                <DetailRow label="Status"><StatusBadge status={p.status} /></DetailRow>
                <DetailRow label="Requested By">{p.requestedBy || p.createdBy || '—'}</DetailRow>
                <DetailRow label="Requested On">{p.createdAt ? fmtDate(p.createdAt) : '—'}</DetailRow>
                {p.approvedBy && <DetailRow label="Approved By">{p.approvedBy}</DetailRow>}
                {p.approvedAt && <DetailRow label="Approved On">{fmtDate(p.approvedAt)}</DetailRow>}
                {p.remarks && <DetailRow label="Remarks"><p className="whitespace-pre-wrap text-right text-sm">{p.remarks}</p></DetailRow>}
              </div>
            </>
          )}

          {activeTab === 'rule' && (
            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Rule Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Rule Name" value={p.ruleName || '—'} />
                <Field label="Rule ID" value={p.ruleId ? <code className="text-xs font-mono">{p.ruleId}</code> : '—'} />
                <Field label="Commission Type" value={p.commissionType || p.ruleType || '—'} />
                <Field label="Rate / Value" value={p.rate != null ? `${p.rate}${p.commissionType === 'percentage' ? '%' : ''}` : '—'} />
                {p.customerId && <Field label="Customer ID" value={<code className="text-xs font-mono">{p.customerId}</code>} />}
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Documents</p>
              {documents.length > 0 ? (
                <div className="space-y-2">
                  {documents.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <File className="h-4 w-4 shrink-0 text-[var(--color-primary-text)]" />
                          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{item.doc.name}{item.metadata.size ? ` · ${formatFileSize(item.metadata.size)}` : ''}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2" data-action>
                        {item.doc.url && (
                          <Button size="xs" variant="outline" icon={<Eye className="h-3 w-3" />} onClick={() => viewDocument(item.doc)}>View</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No documents attached.</p>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Timeline</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 shrink-0">
                    <Clock className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">Commission Created</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{p.createdAt ? fmtDateTime(p.createdAt) : '—'}{p.requestedBy ? ` by ${p.requestedBy}` : ''}</p>
                  </div>
                </div>
                {p.approvedAt && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 shrink-0">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text)]">Approved</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(p.approvedAt)}{p.approvedBy ? ` by ${p.approvedBy}` : ''}</p>
                    </div>
                  </div>
                )}
                {p.rejectedAt && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/40 shrink-0">
                      <XCircle className="h-3 w-3 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text)]">Rejected</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(p.rejectedAt)}{p.rejectedBy ? ` by ${p.rejectedBy}` : ''}{p.rejectionReason ? ` — ${p.rejectionReason}` : ''}</p>
                    </div>
                  </div>
                )}
                {p.updatedAt && !p.approvedAt && !p.rejectedAt && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 shrink-0">
                      <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text)]">Last Modified</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(p.updatedAt)}{p.updatedBy ? ` by ${p.updatedBy}` : ''}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Actions ─────────────────────────────────────── */}
        <div className="shrink-0 flex items-center justify-between pt-4 border-t border-[var(--color-border-subtle)]">
          {showRejectInput ? (
            <div className="flex items-center gap-2 w-full">
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter rejection reason..."
                className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                autoFocus
              />
              <Button size="sm" variant="outline" onClick={() => { setShowRejectInput(false); setRejectReason(''); }}>Cancel</Button>
              <Button size="sm" variant="danger" onClick={() => { onReject?.(record, rejectReason || 'No reason provided'); setShowRejectInput(false); setRejectReason(''); }}>
                Confirm Reject
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 ml-auto">
              {onApprove && p.status === 'pending' && (
                <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onApprove(record)}>
                  Approve
                </Button>
              )}
              {onReject && p.status === 'pending' && (
                <Button size="sm" variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setShowRejectInput(true)}>
                  Reject
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <DocumentViewer document={viewerDoc} open={viewerOpen} onClose={closeViewer} fullScreen />
    </Modal>
  );
}

export default CommissionApprovalDetailDrawer;
