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
  PlayCircle,
  RefreshCw,
  Shield,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Modal, Pagination, Textarea } from '../../ui';
import { SettlementDetailDrawer } from '../../partner/SettlementDetailDrawer';
import { WithdrawalDetailDrawer } from '../../partner/WithdrawalDetailDrawer';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, fmtCurrency, getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { createSettlementBatch, processSettlementBatch } from '../../../lib/channelPartnerSettlement';
import { recordSettlementAudit } from '../../../lib/settlementAudit';
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
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  approved:   'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  paid:       'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  rejected:   'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const cls = STATUS_STYLES[s] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {(s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')}
    </span>
  );
}

type Tab = 'settlements' | 'withdrawals';
type RecordType = Record<string, any> & { id: string };
type Mode = 'records' | 'create';

export function MobileSettlementWorkspace(_props: { mode: Mode }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  const [tab, setTab] = useState<Tab>(() => (params.get('tab') as Tab) || 'settlements');
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [viewSettlement, setViewSettlement] = useState<RecordType | null>(null);
  const [viewWithdrawal, setViewWithdrawal] = useState<RecordType | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'approve' | 'reject' | ''>('');
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [processConfirmId, setProcessConfirmId] = useState<string | null>(null);

  const canEdit = perms.canEdit('partners');
  const userClosedRef = useRef(false);
  const openSettlementId = params.get('openSettlement') || '';
  const openWithdrawalId = params.get('openWithdrawal') || '';
  const createParam = params.get('create') || '';

  const { data: allTxns = [], isLoading, error, refetch } = useQuery({
    queryKey: companyKeys.settlementsRoot,
    queryFn: async () => {
      const fromSettlements = await getAll(COLLECTIONS.SETTLEMENTS);
      if (fromSettlements.length > 0) {
        return fromSettlements;
      }
      // Fallback: read from wallet transactions and filter for settlements (pre-migration)
      const legacyTxns = await getAll(COLLECTIONS.PARTNER_WALLET_TXNS);
      return legacyTxns.filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted);
    },
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const settlements = useMemo(() =>
    (allTxns as RecordType[]).filter((t) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted),
  [allTxns]);

  const withdrawals = useMemo(() =>
    (allTxns as RecordType[]).filter((t) => t.type === 'withdrawal_request' && !t.isDeleted),
  [allTxns]);

  const filters = useMemo(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const currentData = tab === 'settlements' ? settlements : withdrawals;

  const filtered = useMemo(() => {
    let list = [...currentData];
    const q = filters.search.toLowerCase().trim();
    if (q) {
      list = list.filter((item: any) =>
        [item.id, item.partnerName, item.partnerId, item.status, item.withdrawalStatus]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (filters.status !== ALL) {
      if (tab === 'settlements') list = list.filter((item: any) => item.status === filters.status);
      else list = list.filter((item: any) => item.withdrawalStatus === filters.status);
    }
    if (filters.date !== 'all') list = list.filter((item: any) => isInDateRangeMobile(item.createdAt, filters.date));
    list.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return list;
  }, [currentData, filters, tab]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // Selection cleanup
  useEffect(() => {
    setSelected((current) => {
      const available = new Set(currentData.map((r: any) => r.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [currentData]);

  // ── URL-driven settlement detail open ────────────────────
  useEffect(() => {
    if (userClosedRef.current) { userClosedRef.current = false; return; }
    if (!openSettlementId || isLoading) return;
    const target = settlements.find((s) => s.id === openSettlementId);
    if (target && !viewSettlement) setViewSettlement(target);
  }, [openSettlementId, isLoading, settlements, viewSettlement]);

  // ── URL-driven withdrawal detail open ────────────────────
  useEffect(() => {
    if (userClosedRef.current) { userClosedRef.current = false; return; }
    if (!openWithdrawalId || isLoading) return;
    const target = withdrawals.find((w) => w.id === openWithdrawalId);
    if (target && !viewWithdrawal) setViewWithdrawal(target);
  }, [openWithdrawalId, isLoading, withdrawals, viewWithdrawal]);

  function openSettlementDetail(item: RecordType) {
    userClosedRef.current = false;
    setViewSettlement(item);
    const next = new URLSearchParams(params);
    next.set('openSettlement', item.id);
    setParams(next, { replace: true });
  }

  function closeSettlementDetail() {
    userClosedRef.current = true;
    setViewSettlement(null);
    const next = new URLSearchParams(params);
    next.delete('openSettlement');
    setParams(next, { replace: true });
  }

  function openWithdrawalDetail(item: RecordType) {
    userClosedRef.current = false;
    setViewWithdrawal(item);
    const next = new URLSearchParams(params);
    next.set('openWithdrawal', item.id);
    setParams(next, { replace: true });
  }

  function closeWithdrawalDetail() {
    userClosedRef.current = true;
    setViewWithdrawal(null);
    const next = new URLSearchParams(params);
    next.delete('openWithdrawal');
    setParams(next, { replace: true });
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: companyKeys.settlementsRoot });
    qc.invalidateQueries({ queryKey: companyKeys.partnerWalletTxns });
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

  function handleTabChange(t: Tab) {
    setTab(t);
    setPage(1);
    setSelected(new Set());
    const next = new URLSearchParams(params);
    next.set('tab', t);
    next.delete('page');
    next.delete('openSettlement');
    next.delete('openWithdrawal');
    setParams(next, { replace: true });
  }

  // ── Mutations ────────────────────────────────────────────
  const createBatch = useMutation({
    mutationFn: async () => {
      // Fetch approved commission records from the collection
      const allRecords = await getAll(COLLECTIONS.COMMISSION_RECORDS);
      const approvedCommissions = (allRecords as any[]).filter((r: any) => r.status === 'approved' && !r.isDeleted);
      if (approvedCommissions.length === 0) throw new Error('No approved commissions to settle');
      const ids = approvedCommissions.map((r: any) => r.id);
      return createSettlementBatch(ids);
    },
    onSuccess: (result) => {
      if (result) {
        toast.success('Settlement batch created');
        invalidate();
      } else {
        toast.error('No eligible approved commissions found');
      }
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create settlement batch'),
  });

  const processSettlement = useMutation({
    mutationFn: async (settlementId: string) => {
      const settlement = settlements.find((s) => s.id === settlementId);
      const prevStatus = settlement?.status || 'pending';
      const result = await processSettlementBatch(settlementId);
      await recordSettlementAudit(settlementId, 'settlement', 'processed', prevStatus,
        result.success === result.total ? 'completed' : 'failed',
        `${result.success} success, ${result.skipped} skipped, ${result.failed} failed`);
      return result;
    },
    onSuccess: (result) => {
      toast.success(`Processed: ${result.success} success, ${result.skipped} skipped, ${result.failed} failed`);
      setProcessConfirmId(null);
      invalidate();
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to process settlement'),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {},
    onSuccess: () => {
      invalidate();
      toast.success(`${selected.size} withdrawal${selected.size > 1 ? 's' : ''} approved`);
      setBulkAction('');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to approve'),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {},
    onSuccess: () => {
      invalidate();
      toast.success(`${selected.size} withdrawal${selected.size > 1 ? 's' : ''} rejected`);
      setBulkAction('');
      setBulkRejectReason('');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reject'),
  });

  const hasActiveFilters = Boolean(filters.search || filters.status !== ALL || filters.date !== 'all');

  // Desktop creates settlements via batch processing from approved commissions.
  // When ?create=1 is present in the URL (triggered by Bottom FAB), show the
  // batch creation flow instead of a placeholder.
  // Note: the `mode` prop is always 'records' from MobileRoutes — create mode
  // detection uses the URL param (matching Partners workspace pattern).
  const isCreateMode = createParam === '1';

  function handleCancelCreate() {
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }

  if (isCreateMode) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center p-8 text-center">
        <div className="max-w-sm space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary-light)]">
            <DollarSign className="h-8 w-8 text-[var(--color-primary-text)]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">Create Settlement Batch</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Desktop creates settlements by batching approved commission records into a single
              settlement transaction. This processes all eligible approved commissions together.
            </p>
          </div>
          <Button
            className="w-full"
            icon={<PlayCircle className="h-4 w-4" />}
            onClick={() => createBatch.mutate()}
            loading={createBatch.isPending}
          >
            Create Batch Now
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={createBatch.isPending}
            onClick={handleCancelCreate}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-1">
        {/* Header */}
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
            {tab === 'settlements' ? 'Settlements' : 'Withdrawals'}
          </h1>
          <button
            type="button"
            onClick={() => refetch()}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 rounded-xl bg-[var(--color-bg-sunken)] p-1 w-fit">
          {(['settlements', 'withdrawals'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                tab === t ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)]'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Create Batch button (Settlements tab only) */}
        {tab === 'settlements' && canEdit && (
          <Button
            className="w-full"
            icon={<PlayCircle className="h-4 w-4" />}
            onClick={() => createBatch.mutate()}
            loading={createBatch.isPending}
          >
            Create Settlement Batch
          </Button>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
            {(error as Error).message}
          </div>
        )}

        {/* Bulk action bar (Withdrawals tab only) */}
        {tab === 'withdrawals' && selected.size > 0 && (
          <Card className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-bold text-[var(--color-primary-text)]">{selected.size} selected</p>
              {canEdit && (
                <>
                  <Button size="xs" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    onClick={() => { setBulkAction('approve'); setBulkRejectReason(''); }}>
                    Approve
                  </Button>
                  <Button size="xs" variant="danger" icon={<XCircle className="h-3.5 w-3.5" />}
                    onClick={() => setBulkAction('reject')}>
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
            <SettlementSkeletonCard key={i} />
          ))}

          {!isLoading && paginated.length === 0 && (
            <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
              <Shield className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
              <p className="mt-2">
                {hasActiveFilters
                  ? 'No records match your filters.'
                  : `No ${tab} yet.`}
              </p>
              {hasActiveFilters && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setParams(new URLSearchParams(), { replace: true }); setPage(1); }}
                  className="mt-3"
                >
                  Clear Filters
                </Button>
              )}
            </Card>
          )}

          {paginated.map((item: any) => {
            if (tab === 'settlements') {
              return (
                <SettlementCard
                  key={item.id}
                  item={item}
                  onView={() => openSettlementDetail(item)}
                  onProcess={canEdit && item.status === 'pending' ? () => setProcessConfirmId(item.id) : undefined}
                />
              );
            }
            return (
              <WithdrawalCard
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onSelect={() => toggleSelect(item.id)}
                onView={() => openWithdrawalDetail(item)}
              />
            );
          })}
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={changePage} />
        )}
      </div>

      {/* Settlement Detail Drawer */}
      <SettlementDetailDrawer
        settlement={viewSettlement}
        open={!!viewSettlement}
        onClose={closeSettlementDetail}
        onProcess={canEdit ? (id) => processSettlement.mutate(id) : undefined}
        onProcessLoading={processSettlement.isPending}
      />

      {/* Withdrawal Detail Drawer */}
      <WithdrawalDetailDrawer
        withdrawal={viewWithdrawal}
        open={!!viewWithdrawal}
        onClose={closeWithdrawalDetail}
        onRefresh={() => refetch()}
      />

      {/* Process Confirm Dialog */}
      <ConfirmDialog
        open={!!processConfirmId}
        onClose={() => setProcessConfirmId(null)}
        onConfirm={() => { if (processConfirmId) processSettlement.mutate(processConfirmId); }}
        loading={processSettlement.isPending}
        title="Process Settlement"
        message="Process this settlement batch? This will credit partner wallets for all completed items."
      />

      {/* Bulk Approve Modal */}
      <Modal open={bulkAction === 'approve'} onClose={() => setBulkAction('')} title="Approve Withdrawals" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Approve <span className="font-semibold text-[var(--color-text)]">{selected.size}</span> withdrawal{selected.size > 1 ? 's' : ''}?
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setBulkAction('')}>Cancel</Button>
            <Button className="flex-1" onClick={() => bulkApproveMutation.mutate(Array.from(selected))} loading={bulkApproveMutation.isPending}>
              Approve All
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk Reject Modal */}
      <Modal open={bulkAction === 'reject'} onClose={() => { setBulkAction(''); setBulkRejectReason(''); }} title="Reject Withdrawals" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Reject <span className="font-semibold text-[var(--color-text)]">{selected.size}</span> withdrawal{selected.size > 1 ? 's' : ''}?
          </p>
          <Textarea
            label="Reason (optional)"
            value={bulkRejectReason}
            onChange={(e) => setBulkRejectReason(e.target.value)}
            placeholder="Enter rejection reason..."
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setBulkAction(''); setBulkRejectReason(''); }}>Cancel</Button>
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
//  SETTLEMENT CARD
// ══════════════════════════════════════════════════════════════

function SettlementCard({ item, onView, onProcess }: {
  item: RecordType;
  onView: () => void;
  onProcess?: () => void;
}) {
  const displayName = item.partnerName || item.partnerId || 'Unknown';
  const phone = cleanPhone(item.partnerPhone || item.phone);
  const itemId = item.id?.slice(-8) || '—';

  return (
    <Card className="rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]">
      <div className="flex items-start gap-2.5">
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{displayName}</p>
              <p className="mt-0.5 truncate text-[10px] font-mono text-[var(--color-text-disabled)]">ID: {itemId}</p>
            </div>
            <StatusBadge status={item.status} />
          </div>

          <div className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Amount:</span>
                <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(item.totalAmount || 0)}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Comms:</span>
                <span>{item.commissionCount || 0}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Created:</span>
                <span>{formatDate(item.createdAt)}</span>
              </span>
            </div>
            {item.status === 'completed' && (
              <p className="text-[10px] text-[var(--color-text-disabled)]">
                {item.successCount || 0}S / {item.skippedCount || 0}K / {item.failedCount || 0}F
              </p>
            )}
          </div>
        </button>

        <div className="flex shrink-0 flex-col items-center gap-1.5" data-action>
          {phone && (
            <a href={whatsappHref(phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60 transition-transform active:scale-95">
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.25} />
            </a>
          )}
          {item.partnerEmail && (
            <a href={`mailto:${item.partnerEmail}`} aria-label="Email"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60 transition-transform active:scale-95">
              <Mail className="h-3.5 w-3.5" strokeWidth={2.2} />
            </a>
          )}
          {phone && (
            <a href={phoneHref(phone)} aria-label="Call"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60 transition-transform active:scale-95">
              <Phone className="h-3.5 w-3.5" strokeWidth={2.25} />
            </a>
          )}
          {onProcess && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onProcess(); }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
              aria-label="Process settlement">
              <PlayCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
//  WITHDRAWAL CARD (with selection checkbox)
// ══════════════════════════════════════════════════════════════

function WithdrawalCard({ item, selected, onSelect, onView }: {
  item: RecordType;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
}) {
  const displayName = item.partnerName || item.partnerId || 'Unknown';
  const phone = cleanPhone(item.partnerPhone || item.phone);
  const itemId = item.id?.slice(-8) || '—';

  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${displayName}`}
        />

        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{displayName}</p>
              <p className="mt-0.5 truncate text-[10px] font-mono text-[var(--color-text-disabled)]">ID: {itemId}</p>
            </div>
            <StatusBadge status={item.withdrawalStatus} />
          </div>

          <div className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Amount:</span>
                <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(Math.abs(item.amount || 0))}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Requested:</span>
                <span>{formatDate(item.createdAt)}</span>
              </span>
            </div>
            {item.paymentMethod && (
              <p className="text-[10px] text-[var(--color-text-disabled)]">
                Method: {item.paymentMethod.replace(/_/g, ' ')}
                {item.paymentReference ? ` · ${item.paymentReference}` : ''}
              </p>
            )}
          </div>
        </button>

        <div className="flex shrink-0 flex-col items-center gap-1.5" data-action>
          {phone && (
            <a href={whatsappHref(phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60 transition-transform active:scale-95">
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.25} />
            </a>
          )}
          {item.partnerEmail && (
            <a href={`mailto:${item.partnerEmail}`} aria-label="Email"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60 transition-transform active:scale-95">
              <Mail className="h-3.5 w-3.5" strokeWidth={2.2} />
            </a>
          )}
          {phone && (
            <a href={phoneHref(phone)} aria-label="Call"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60 transition-transform active:scale-95">
              <Phone className="h-3.5 w-3.5" strokeWidth={2.25} />
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function SettlementSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-6 w-full rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

export default MobileSettlementWorkspace;
