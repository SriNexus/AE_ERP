/**
 * PartnerCommissionDetailDrawer — Read-only commission detail modal for Partner Portal
 *
 * Displays: lead info, rule used, calculation inputs, commission amount,
 * approval history, payment details, generated date, notes, timeline.
 * Entirely read-only — no approve/reject/edit actions.
 */

import { Calendar, DollarSign, FileText, CheckCircle2, XCircle, Clock, Hash } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { fmtDate, fmtDateTime, fmtCurrency } from '../../lib/firestore';
import type { CommissionRecord } from '../../features/channel-partner/types';

interface PartnerCommissionDetailDrawerProps {
  record: CommissionRecord | null;
  open: boolean;
  onClose: () => void;
}

const STATUS_BADGES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  calculated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  voided: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  calculated: 'Calculated',
  approved: 'Approved',
  paid: 'Paid',
  voided: 'Voided',
};

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

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = STATUS_BADGES[s] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  const label = STATUS_LABELS[s] || s.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

export function PartnerCommissionDetailDrawer({ record, open, onClose }: PartnerCommissionDetailDrawerProps) {
  if (!record) return null;

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="space-y-6 text-sm">
        {/* ── Header: Status + Amount ─────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-[var(--color-primary)]" />
            <span className="font-semibold text-[var(--color-text)]">Commission Record</span>
          </div>
          <StatusPill status={record.status} />
        </div>

        <p className={`text-2xl font-bold ${
          record.status === 'paid' ? 'text-green-600 dark:text-green-400' :
          record.status === 'approved' ? 'text-emerald-600 dark:text-emerald-400' :
          record.status === 'voided' ? 'text-red-600 dark:text-red-400' :
          'text-[var(--color-text)]'
        }`}>
          {fmtCurrency(record.approvedAmount || record.amount || 0)}
        </p>

        {/* ── Record Info ────────────────────────────────── */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
          <DetailRow label="Record ID">
            <code className="text-xs font-mono bg-[var(--color-surface)] px-1.5 py-0.5 rounded">{record.id}</code>
          </DetailRow>
          <DetailRow label="Lead ID">
            <code className="text-xs font-mono">{record.leadId || '—'}</code>
          </DetailRow>
          <DetailRow label="Partner ID">
            <code className="text-xs font-mono">{record.partnerId || '—'}</code>
          </DetailRow>
          <DetailRow label="Generated Date">{fmtDate(record.generatedDate)}</DetailRow>
        </div>

        {/* ── Commission Configuration ────────────────────── */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
            Commission Configuration
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rule Name" value={record.ruleName || 'Default'} />
            <Field label="Rule Type" value={record.ruleType?.replace(/_/g, ' ') || '—'} />
            <Field label="Rule Value" value={record.ruleValue != null ? String(record.ruleValue) : '—'} />
            <Field label="System Size" value={record.systemSizeKW ? `${record.systemSizeKW} kW` : '—'} />
            <Field label="Deal Value" value={record.dealValue ? fmtCurrency(record.dealValue) : '—'} />
            <Field label="Commission Amount" value={fmtCurrency(record.amount || 0)} />
            {record.cappedAmount != null && (
              <Field label="Capped Amount" value={fmtCurrency(record.cappedAmount)} />
            )}
          </div>
        </div>

        {/* ── Approval Details ─────────────────────────────── */}
        {(record.approvedBy || record.approvedAt) && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
              Approval Details
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Approved By" value={record.approvedBy || '—'} />
              <Field label="Approved At" value={record.approvedAt ? fmtDateTime(record.approvedAt) : '—'} />
              {record.approvedAmount != null && (
                <Field label="Approved Amount" value={fmtCurrency(record.approvedAmount)} />
              )}
              {record.rejectionReason && (
                <Field label="Rejection Reason" value={<span className="text-red-600 dark:text-red-400">{record.rejectionReason}</span>} />
              )}
            </div>
          </div>
        )}

        {/* ── Payment Details ──────────────────────────────── */}
        {(record.paidAt || record.paidBy) && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
              Payment Details
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Paid At" value={record.paidAt ? fmtDateTime(record.paidAt) : '—'} />
              <Field label="Paid By" value={record.paidBy || '—'} />
              {record.paymentReference && (
                <Field label="Payment Reference" value={record.paymentReference} />
              )}
              {record.walletTransactionId && (
                <Field label="Wallet Txn ID" value={record.walletTransactionId} />
              )}
            </div>
          </div>
        )}

        {/* ── Status Timeline ──────────────────────────────── */}
        <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Status Timeline
          </p>
          <div className="px-4 pb-3 space-y-2">
            {/* Generated */}
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 shrink-0">
                <Clock className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Commission Generated</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {record.generatedDate ? fmtDateTime(record.generatedDate) : '—'}
                </p>
              </div>
            </div>

            {/* Rejected */}
            {record.status === 'voided' && (
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 shrink-0">
                  <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Voided / Rejected</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {record.approvedAt ? fmtDateTime(record.approvedAt) : '—'}
                    {record.rejectionReason ? ` · ${record.rejectionReason}` : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Approved */}
            {(record.status === 'approved' || record.status === 'paid') && (
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 shrink-0">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Approved</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {record.approvedAt ? fmtDateTime(record.approvedAt) : '—'}
                    {record.approvedBy ? ` by ${record.approvedBy}` : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Paid */}
            {record.status === 'paid' && (
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 shrink-0">
                  <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Paid</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {record.paidAt ? fmtDateTime(record.paidAt) : '—'}
                    {record.paymentReference ? ` · Ref: ${record.paymentReference}` : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Pending (no further action yet) */}
            {record.status === 'pending' && (
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 shrink-0">
                  <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Awaiting Approval</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Pending admin review
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default PartnerCommissionDetailDrawer;
