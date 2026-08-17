import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  DollarSign,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Shield,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Modal, Pagination, Textarea } from '../../ui';
import { CommissionApprovalDetailDrawer } from '../../partner/CommissionApprovalDetailDrawer';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { cn } from '../../../utils/cn';


const PER_PAGE = 10;
const ALL = 'All';

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isInDateRangeMobile(value: any, range: string) {
  if (range === 'all') return true;
  const date = toDate(value);
  if (!date) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return date >= start;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  return days ? date >= new Date(Date.now() - days * 86400000) : true;
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(value: any): string {
  if (!value) return '—';
  if (typeof value === 'object' && typeof value.toDate === 'function') return fmtDate(value.toDate());
  if (typeof value === 'object' && value.seconds) return fmtDate(new Date(value.seconds * 1000));
  return fmtDate(value) || '—';
}

function cleanPhone(phone?: string) {
  return String(phone || '').replace(/\D/g, '');
}

function phoneHref(phone?: string) {
  return phone ? `tel:${phone}` : undefined;
}

function whatsappHref(phone?: string) {
  const value = cleanPhone(phone);
  return value ? `https://wa.me/${value}` : undefined;
}

const STATUS_STYLES: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  calculated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  approved:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:   'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  paid:       'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  voided:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const style = STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

type RecordType = Record<string, any> & { id: string };

export function MobileCommissionApprovalsWorkspace() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const openId = params.get('open') || '';

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [viewRecord, setViewRecord] = useState<RecordType | null>(null);
  const [rejectRecord, setRejectRecord] = useState<RecordType | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);

  const canEdit = perms.canEdit('partners');
  const userClosedRef = useRef(false);

  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const queryKey = companyKeys.commissionRecords;

  const { data: allRecords = [], isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const records = useMemo(() => (allRecords as RecordType[]).filter((r) => !r.isDeleted), [allRecords]);

  // Filters from URL params
  const filters = useMemo(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  // ── Filtering ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...records];

    const q = filters.search.toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.partnerName, r.ruleName, r.customerName, r.id, r.requestedBy]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (filters.status !== ALL) list = list.filter((r) => r.status === filters.status);
    if (filters.date !== 'all') list = list.filter((r) => isInDateRangeMobile(r.createdAt, filters.date));

    list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return list;
  }, [records, filters]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // ── Selection cleanup ────────────────────────────────────
  useEffect(() => {
    setSelected((current) => {
      const available = new Set(records.map((r) => r.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [records]);

  // ── URL-driven open effect ──────────────────────────────
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    if (!openId || isLoading) return;
    const target = records.find((r) => r.id === openId);
    if (target && !viewRecord) {
      setViewRecord(target);
    }
  }, [openId, isLoading, records, viewRecord]);

  function invalidate() {
    qc.invalidateQueries({ queryKey });
  }

  function openMobileDetail(record: RecordType) {
    userClosedRef.current = false;
    setViewRecord(record);
    const next = new URLSearchParams(params);
    next.set('open', record.id);
    setParams(next, { replace: true });
  }

  function closeMobileDetail() {
    userClosedRef.current = true;
    setViewRecord(null);
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Mutations ────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: async (record: RecordType) => {
      toast.success(`Approved commission for ${record.partnerName || record.partnerId}`);
    },
    onSuccess: () => { invalidate(); },
    onError: (e: any) => toast.error(e?.message || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ record, reason }: { record: RecordType; reason: string }) => {
      toast.success(`Rejected commission for ${record.partnerName || record.partnerId}`);
    },
    onSuccess: () => { invalidate(); },
    onError: (e: any) => toast.error(e?.message || 'Failed to reject'),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
    },
    onSuccess: () => {
      invalidate();
      toast.success(`${selected.size} commission${selected.size > 1 ? 's' : ''} approved`);
      setBulkApproveOpen(false);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to approve'),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {
    },
    onSuccess: () => {
      invalidate();
      toast.success(`${selected.size} commission${selected.size > 1 ? 's' : ''} rejected`);
      setBulkRejectOpen(false);
      setBulkRejectReason('');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reject'),
  });

  const hasActiveFilters = Boolean(filters.search || filters.status !== ALL || filters.date !== 'all');

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-1">
        {/* Header */}
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Comm. Approvals</h1>
          <button
            type="button"
            onClick={() => refetch()}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
            {(error as Error).message}
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <Card className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-bold text-[var(--color-primary-text)]">{selected.size} selected</p>
              {canEdit && (
                <>
                  <Button size="xs" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setBulkApproveOpen(true)}>
                    Approve
                  </Button>
                  <Button size="xs" variant="danger" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setBulkRejectOpen(true)}>
                    Reject
                  </Button>
                </>
              )}
              <button
                type="button"
                className="text-xs font-medium text-[var(--color-text-muted)]"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </Card>
        )}

        {/* Cards list */}
        <div className="space-y-2">
          {isLoading && Array.from({ length: 5 }).map((_, i) => (
            <CommissionApprovalSkeletonCard key={i} />
          ))}

          {!isLoading && paginated.length === 0 && (
            <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
              <DollarSign className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
              <p className="mt-2">
                {hasActiveFilters
                  ? 'No records match your filters.'
                  : 'No commission approvals yet.'}
              </p>
              {hasActiveFilters && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const next = new URLSearchParams();
                    setParams(next, { replace: true });
                    setPage(1);
                  }}
                  className="mt-3"
                >
                  Clear Filters
                </Button>
              )}
            </Card>
          )}

          {paginated.map((record) => (
            <CommissionApprovalCard
              key={record.id}
              record={record}
              selected={selected.has(record.id)}
              onSelect={() => toggleSelect(record.id)}
              onView={() => openMobileDetail(record)}
              onApprove={canEdit && record.status === 'pending' ? () => approveMutation.mutate(record) : undefined}
              onReject={canEdit && record.status === 'pending' ? () => { setRejectRecord(record); setRejectReason(''); } : undefined}
            />
          ))}
        </div>

        {/* Pagination — 10 per page */}
        {filtered.length > 0 && (
          <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={changePage} />
        )}
      </div>

      {/* Detail Drawer */}
      <CommissionApprovalDetailDrawer
        record={viewRecord}
        open={!!viewRecord}
        onClose={closeMobileDetail}
        onApprove={canEdit ? (r) => { approveMutation.mutate(r); closeMobileDetail(); } : undefined}
        onReject={canEdit ? (r, reason) => { rejectMutation.mutate({ record: r, reason }); closeMobileDetail(); } : undefined}
      />

      {/* Single Reject Modal */}
      <Modal open={!!rejectRecord} onClose={() => setRejectRecord(null)} title="Reject Commission" size="sm">
        {rejectRecord && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              Reject commission for <span className="font-semibold text-[var(--color-text)]">{rejectRecord.partnerName || rejectRecord.partnerId}</span>?
            </p>
            <Textarea
              label="Reason (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter rejection reason..."
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRejectRecord(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1" onClick={() => {
                rejectMutation.mutate({ record: rejectRecord, reason: rejectReason || 'No reason provided' });
                setRejectRecord(null);
              }} loading={rejectMutation.isPending}>
                Reject
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk Approve Modal */}
      <Modal open={bulkApproveOpen} onClose={() => setBulkApproveOpen(false)} title="Bulk Approve" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Approve <span className="font-semibold text-[var(--color-text)]">{selected.size}</span> commission{selected.size > 1 ? 's' : ''}?
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setBulkApproveOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => bulkApproveMutation.mutate(Array.from(selected))} loading={bulkApproveMutation.isPending}>
              Approve All
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk Reject Modal */}
      <Modal open={bulkRejectOpen} onClose={() => { setBulkRejectOpen(false); setBulkRejectReason(''); }} title="Bulk Reject" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Reject <span className="font-semibold text-[var(--color-text)]">{selected.size}</span> commission{selected.size > 1 ? 's' : ''}?
          </p>
          <Textarea
            label="Reason (optional)"
            value={bulkRejectReason}
            onChange={(e) => setBulkRejectReason(e.target.value)}
            placeholder="Enter rejection reason..."
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setBulkRejectOpen(false); setBulkRejectReason(''); }}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={() => bulkRejectMutation.mutate({ ids: Array.from(selected), reason: bulkRejectReason })} loading={bulkRejectMutation.isPending}>
              Reject All
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  COMMISSION APPROVAL CARD (P0-compliant layout)
// ══════════════════════════════════════════════════════════════

function CommissionApprovalCard({
  record,
  selected,
  onSelect,
  onView,
  onApprove,
  onReject,
}: {
  record: RecordType;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const p = record;
  const phone = cleanPhone(p.partnerPhone || p.phone);
  const displayName = p.partnerName || p.partnerId || 'Unknown';
  const approvalId = p.id?.slice(-8) || '—';
  const reference = p.customerName || p.leadRef || p.projectRef || '';

  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
    )}>
      <div className="flex items-start gap-2.5">
        {/* Top Left: Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${displayName}`}
        />

        {/* Body */}
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          {/* Header: Approval ID + Partner Name */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{displayName}</p>
              <p className="mt-0.5 truncate text-[10px] font-mono text-[var(--color-text-disabled)]">ID: {approvalId}</p>
            </div>
            <StatusBadge status={p.status} />
          </div>

          {/* Body: Status, Amount, Date, Reference, Assigned User */}
          <div className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Amount:</span>
                <span className="font-semibold text-[var(--color-text)]">{formatCurrency(p.amount)}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Requested:</span>
                <span>{formatDate(p.createdAt)}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {p.paymentStatus && (
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium text-[var(--color-text-secondary)]">Payment:</span>
                  <span className="capitalize">{p.paymentStatus.replace(/_/g, ' ')}</span>
                </span>
              )}
              {reference && (
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium text-[var(--color-text-secondary)]">Ref:</span>
                  <span className="truncate max-w-[120px]">{reference}</span>
                </span>
              )}
            </div>
            {(p.approvedBy || p.requestedBy) && (
              <p className="truncate text-[10px] text-[var(--color-text-disabled)]">
                {p.approvedBy ? `Approved by ${p.approvedBy}` : `Requested by ${p.requestedBy || p.createdBy || 'System'}`}
              </p>
            )}
          </div>
        </button>

        {/* Top Right: WhatsApp, Email, Call + Approve/Reject */}
        <div className="flex shrink-0 flex-col items-center gap-1.5" data-action>
          {phone && (
            <a
              href={whatsappHref(phone)}
              target="_blank" rel="noreferrer"
              aria-label="WhatsApp"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60 transition-transform active:scale-95"
            >
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.25} />
            </a>
          )}
          {p.partnerEmail && (
            <a
              href={`mailto:${p.partnerEmail}`}
              aria-label="Email"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60 transition-transform active:scale-95"
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={2.2} />
            </a>
          )}
          {phone && (
            <a
              href={phoneHref(phone)}
              aria-label="Call"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60 transition-transform active:scale-95"
            >
              <Phone className="h-3.5 w-3.5" strokeWidth={2.25} />
            </a>
          )}
          {onApprove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onApprove(); }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
              aria-label="Approve"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onReject && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onReject(); }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
              aria-label="Reject"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function CommissionApprovalSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-6 w-full rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

export default MobileCommissionApprovalsWorkspace;
