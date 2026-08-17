/**
 * PartnerDocumentDetailDrawer — Read-only document detail modal for Partner Portal
 *
 * Displays: document type, related lead, uploaded date, verification status,
 * rejection reason, expiry, notes, activity history.
 * Entirely read-only — no approve/reject/edit actions.
 *
 * The document type is derived from a Lead's documentVerifications array.
 */

import { FileText, CheckCircle2, XCircle, Clock, AlertTriangle, ExternalLink, Upload } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { fmtDate, fmtDateTime } from '../../lib/firestore';

export interface PartnerDocumentView {
  id: string;
  leadId: string;
  leadName: string;
  documentName: string;
  status: 'pending' | 'submitted' | 'verified' | 'rejected';
  rejectionReason?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  submittedAt?: string | null;
  notes?: string | null;
  leadStatus?: string;
}

interface PartnerDocumentDetailDrawerProps {
  document: PartnerDocumentView | null;
  open: boolean;
  onClose: () => void;
  /** Called when partner wants to replace a rejected document */
  onReplace?: (doc: PartnerDocumentView) => void;
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  verified:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  pending:   'Pending',
  submitted: 'Submitted',
  verified:  'Verified',
  rejected:  'Rejected',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = STATUS_STYLES[s] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  const label = STATUS_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0 min-w-[120px]">
        {label}
      </span>
      <span className="text-sm font-medium text-[var(--color-text)] text-right break-all">
        {children}
      </span>
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

export function PartnerDocumentDetailDrawer({ document, open, onClose, onReplace }: PartnerDocumentDetailDrawerProps) {
  if (!document) return null;

  const isRejected = document.status === 'rejected';

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="space-y-6 text-sm">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[var(--color-primary)]" />
            <span className="font-semibold text-[var(--color-text)]">Document Details</span>
          </div>
          <StatusBadge status={document.status} />
        </div>

        <p className="text-base font-bold text-[var(--color-text)]">
          {document.documentName}
        </p>

        {/* ── Rejection Alert ─────────────────────────────── */}
        {isRejected && document.rejectionReason && (
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-300 text-xs">Document Rejected</p>
              <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{document.rejectionReason}</p>
              {onReplace && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReplace(document); }}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-300 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Replace Document
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Record Info ─────────────────────────────────-- */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
          <DetailRow label="Document Name">
            <span className="font-semibold">{document.documentName}</span>
          </DetailRow>
          <DetailRow label="Related Lead">
            {document.leadName}
          </DetailRow>
          <DetailRow label="Lead Status">{document.leadStatus || '—'}</DetailRow>
          <DetailRow label="Submitted">
            {document.submittedAt ? fmtDateTime(document.submittedAt) : '—'}
          </DetailRow>
          {document.verifiedAt && (
            <DetailRow label="Verified At">{fmtDateTime(document.verifiedAt)}</DetailRow>
          )}
        </div>

        {/* ── Verification Details ─────────────────────────── */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
            Verification Details
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Status"
              value={<StatusBadge status={document.status} />}
            />
            <Field label="Verified By" value={document.verifiedBy || '—'} />
            {document.rejectionReason && (
              <Field
                label="Rejection Reason"
                value={<span className="text-red-600 dark:text-red-400">{document.rejectionReason}</span>}
              />
            )}
            {document.notes && (
              <Field label="Notes" value={document.notes} />
            )}
          </div>
        </div>

        {/* ── Status Timeline ──────────────────────────────── */}
        <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Status Timeline
          </p>
          <div className="px-4 pb-3 space-y-2">
            {/* Submitted */}
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 shrink-0">
                <Upload className="h-3 w-3 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Document Submitted</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {document.submittedAt ? fmtDateTime(document.submittedAt) : '—'}
                </p>
              </div>
            </div>

            {/* Rejected */}
            {isRejected && (
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 shrink-0">
                  <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Rejected</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {document.verifiedAt ? fmtDateTime(document.verifiedAt) : '—'}
                    {document.rejectionReason ? ` · ${document.rejectionReason}` : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Verified */}
            {document.status === 'verified' && (
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 shrink-0">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Verified</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {document.verifiedAt ? fmtDateTime(document.verifiedAt) : '—'}
                    {document.verifiedBy ? ` by ${document.verifiedBy}` : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Pending */}
            {(document.status === 'pending' || document.status === 'submitted') && (
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 shrink-0">
                  <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Awaiting Verification</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Pending admin review
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Replace Button (if rejected) ─────────────────── */}
        {isRejected && onReplace && (
          <div className="flex justify-center">
            <Button
              size="sm"
              icon={<ExternalLink className="h-4 w-4" />}
              onClick={() => onReplace(document)}
              variant="outline"
            >
              Replace Document
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default PartnerDocumentDetailDrawer;
