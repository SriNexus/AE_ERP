/**
 * PartnerCommissions — Commission Record Approval (Admin View)
 *
 * Displays pending commission records with approve/reject actions.
 * Reuse: DataTable, FilterBar, Pagination, ConfirmDialog, Modal patterns.
 *
 * No business logic — uses partnerLeadIntegration workflow functions.
 * No wallet/settlement logic — this is state management only.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { Card, PageHeader } from '../components/ui/Card';
import { Button, IconButton } from '../components/ui/Button';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Select, Input, Textarea } from '../components/ui/Input';
import { FilterBar, KpiTile } from '../components/ui/FilterBar';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../components/ui/Table';
import { Pagination } from '../components/ui/Pagination';
import {
  DollarSign, RefreshCw, CheckCircle, XCircle, Eye,
  FileText, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { approveCommissionRecord } from '../lib/partnerLeadIntegration';
import type { CommissionRecord } from '../features/channel-partner/types';

// ── Constants ────────────────────────────────────────────

const PER_PAGE = 15;

const COMMISSION_STATUS_OPTIONS = [
  { label: 'All Statuses', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Voided', value: 'voided' },
  { label: 'Paid', value: 'paid' },
];

const COMMISSION_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  voided: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  paid: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
};

function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const style = COMMISSION_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function formatDate(value: any): string {
  if (!value) return '—';
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().toLocaleDateString('en-GB');
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000).toLocaleDateString('en-GB');
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-GB');
}

function formatCurrency(value: number | null | undefined): string {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// ─────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────

export default function PartnerCommissions() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filters ──────────────────────────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');

  // ── Table state ──────────────────────────────────────────
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('generatedDate');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Modal state ──────────────────────────────────────────
  const [viewRecord, setViewRecord] = useState<CommissionRecord | null>(null);
  const [approveModal, setApproveModal] = useState<{ type: 'approve' | 'reject'; record: CommissionRecord } | null>(null);
  const [approvedAmount, setApprovedAmount] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // ── Queries ──────────────────────────────────────────────
  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ['commission_records', activeCompanyId],
    queryFn: async () => {
      const all = await getAll(COLLECTIONS.COMMISSION_RECORDS);
      return all.filter((r: any) => !r.isDeleted);
    },
    staleTime: 30000,
  });

  // ── Mutations ────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: async ({ recordId, approved, amount, reason }: {
      recordId: string; approved: boolean; amount?: number; reason?: string;
    }) => {
      await approveCommissionRecord(recordId, approved, {
        approvedAmount: amount,
        rejectionReason: reason,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission_records'] });
      qc.invalidateQueries({ queryKey: ['channel_partners'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success(approveModal?.type === 'approve' ? 'Commission approved' : 'Commission rejected');
      setApproveModal(null);
      setApprovedAmount('');
      setRejectionReason('');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Filtering ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...(records as any[])];

    const q = search.toLowerCase();
    if (q) {
      list = list.filter((r: any) =>
        [r.leadId, r.partnerId, r.ruleName, r.id]
          .some((v: any) => String(v || '').toLowerCase().includes(q))
      );
    }

    if (statusF) list = list.filter((r: any) => r.status === statusF);

    if (dateRange !== 'all') {
      const now = new Date();
      list = list.filter((r: any) => {
        const date = r.generatedDate ? new Date(r.generatedDate) : null;
        if (!date) return false;
        if (dateRange === 'today') return date.toDateString() === now.toDateString();
        if (dateRange === 'week') {
          const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
          return date >= weekAgo;
        }
        if (dateRange === 'month') {
          return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
        }
        if (dateRange === 'custom' && customFrom && customTo) {
          return date >= new Date(customFrom) && date <= new Date(customTo);
        }
        return true;
      });
    }

    list.sort((a: any, b: any) => {
      const av = String(a[sortKey] || '').toLowerCase();
      const bv = String(b[sortKey] || '').toLowerCase();
      const cmp = av.localeCompare(bv);
      return sortDesc ? -cmp : cmp;
    });

    return list;
  }, [records, search, statusF, dateRange, customFrom, customTo, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── Stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = records as any[];
    return {
      total: all.length,
      pending: all.filter((r: any) => r.status === 'pending').length,
      approved: all.filter((r: any) => r.status === 'approved').length,
      voided: all.filter((r: any) => r.status === 'voided').length,
      totalAmount: all.filter((r: any) => r.status === 'approved')
        .reduce((s: number, r: any) => s + (r.approvedAmount || r.amount || 0), 0),
    };
  }, [records]);

  // ── Handlers ─────────────────────────────────────────────
  const handleApproveConfirm = () => {
    if (!approveModal) return;
    approveMutation.mutate({
      recordId: approveModal.record.id,
      approved: true,
      amount: approvedAmount ? Number(approvedAmount) : undefined,
    });
  };

  const handleRejectConfirm = () => {
    if (!approveModal) return;
    if (!rejectionReason) return toast.error('Rejection reason required');
    approveMutation.mutate({
      recordId: approveModal.record.id,
      approved: false,
      reason: rejectionReason,
    });
  };

  function handleBulkAction(approved: boolean) {
    const ids = Array.from(selected);
    let successCount = 0;
    Promise.all(
      ids.map((id) =>
        approveCommissionRecord(id, approved).then(() => { successCount++; }).catch(() => {})
      )
    ).then(() => {
      qc.invalidateQueries({ queryKey: ['commission_records'] });
      qc.invalidateQueries({ queryKey: ['channel_partners'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success(`${successCount} record${successCount > 1 ? 's' : ''} ${approved ? 'approved' : 'rejected'}`);
      setSelected(new Set());
    });
  }

  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    }), []);

  const toggleAll = () =>
    setSelected((s) =>
      s.size === paginated.length ? new Set() : new Set(paginated.map((r: any) => r.id))
    );

  const allSel = selected.size === paginated.length && paginated.length > 0;

  function sort(k: string) {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setDateRange('all');
    setCustomFrom(''); setCustomTo(''); setPage(1);
  }

  const KPI_TILES = [
    { label: 'TOTAL', value: stats.total, color: 'border-l-[var(--color-border-strong)]', key: '' },
    { label: 'PENDING', value: stats.pending, color: 'border-l-amber-500', key: 'pending' },
    { label: 'APPROVED', value: stats.approved, color: 'border-l-emerald-500', key: 'approved' },
    { label: 'REJECTED', value: stats.voided, color: 'border-l-red-500', key: 'voided' },
    { label: 'TOTAL VALUE', value: formatCurrency(stats.totalAmount), color: 'border-l-purple-500', key: '' },
  ];

  // ─────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      <PageHeader
        title="Commission Approvals"
        icon={<DollarSign className="h-5 w-5" />}
        breadcrumbs={['Home', 'Sales', 'Channel Partners', 'Commission Approvals']}
        className="mb-0"
        actions={
          <IconButton
            icon={<RefreshCw className="h-4 w-4" />}
            title="Refresh"
            onClick={() => refetch()}
            variant="outline"
          />
        }
      />

      {/* ── KPI Tiles ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {KPI_TILES.map((k) => (
          <KpiTile
            key={k.key}
            label={k.label}
            value={k.value}
            color={k.color}
            active={statusF === k.key}
            onClick={() => {
              const nextStatus = statusF === k.key ? '' : k.key;
              setStatusF(nextStatus);
              setPage(1);
            }}
          />
        ))}
      </div>

      {/* ── Main Card ─────────────────────────────────────── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-enterprise-surface)]">
        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="px-4 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)] rounded-t-xl">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} record{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button
                size="sm" variant="outline"
                icon={<CheckCircle className="h-3.5 w-3.5" />}
                onClick={() => handleBulkAction(true)}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30"
              >
                Bulk Approve
              </Button>
              <Button
                size="sm" variant="outline"
                icon={<XCircle className="h-3.5 w-3.5" />}
                onClick={() => handleBulkAction(false)}
                className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30"
              >
                Bulk Reject
              </Button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1"
              >
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <FilterBar
          search={search}
          onSearch={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search by lead ID, partner ID, rule..."
          dateRange={dateRange}
          onDateRange={(v) => { setDateRange(v); setPage(1); }}
          customFrom={customFrom}
          customTo={customTo}
          onCustomRange={(f, t) => { setCustomFrom(f); setCustomTo(t); setPage(1); }}
          filters={[
            {
              label: 'Status',
              value: statusF,
              onChange: (v) => { setStatusF(v); setPage(1); },
              options: COMMISSION_STATUS_OPTIONS,
            },
          ]}
          count={filtered.length}
          total={(records as any[]).length}
          label="commission records"
          onClearAll={clearAll}
        />

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <Thead>
              <Th className="w-8">
                <input type="checkbox" checked={allSel} onChange={toggleAll}
                  className="rounded border-[var(--color-border)] text-indigo-600 cursor-pointer" />
              </Th>
              <Th>RECORD ID</Th>
              <Th sortable sorted={sortKey === 'leadId'} desc={sortDesc} onSort={() => sort('leadId')}>
                LEAD
              </Th>
              <Th>RULE</Th>
              <Th sortable sorted={sortKey === 'systemSizeKW'} desc={sortDesc} onSort={() => sort('systemSizeKW')}>
                SYSTEM
              </Th>
              <Th sortable sorted={sortKey === 'amount'} desc={sortDesc} onSort={() => sort('amount')}>
                AMOUNT
              </Th>
              <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')}>
                STATUS
              </Th>
              <Th sortable sorted={sortKey === 'generatedDate'} desc={sortDesc} onSort={() => sort('generatedDate')}>
                GENERATED
              </Th>
              <Th className="text-right">ACTIONS</Th>
            </Thead>
            <Tbody>
              {isLoading ? (
                <SkeletonRows cols={9} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-[var(--color-text-disabled)]">
                      <FileText className="h-10 w-10" />
                      <p className="text-sm text-[var(--color-text-muted)]">
                        {search || statusF
                          ? 'No commission records match filters'
                          : 'No commission records yet. Records are auto-generated when installations complete.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((r: any) => (
                  <tr
                    key={r.id}
                    className={`group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] ${
                      selected.has(r.id) ? 'bg-indigo-50/30 dark:bg-indigo-900/10' : ''
                    }`}
                    onClick={() => setViewRecord(r)}
                  >
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(r.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(r.id)}
                        className="rounded border-[var(--color-border)] text-indigo-600 cursor-pointer" />
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-[var(--color-text-muted)]">
                      {r.id?.slice(0, 10)}...
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-medium text-[var(--color-text)]">{r.leadId || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {r.ruleName || `${r.ruleType || '—'}`}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-[var(--color-text)]">
                      {r.systemSizeKW ? `${r.systemSizeKW} kW` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold tabular-nums text-[var(--color-text)]">
                      {formatCurrency(r.approvedAmount || r.amount || 0)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={r.status || 'pending'} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {formatDate(r.generatedDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {r.status === 'pending' && perms.canEdit('partners') ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setApprovedAmount(String(r.amount || '')); setApproveModal({ type: 'approve', record: r }); }}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 px-2 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                          >
                            <CheckCircle className="h-3 w-3" />
                            Approve
                          </button>
                          <button
                            onClick={() => { setRejectionReason(''); setApproveModal({ type: 'reject', record: r }); }}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-red-50 dark:bg-red-900/30 px-2 text-[10px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
                          >
                            <XCircle className="h-3 w-3" />
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-[var(--color-text-muted)] italic">
                          {r.status === 'approved' ? 'Approved' : r.status === 'voided' ? 'Rejected' : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </Tbody>
          </Table>
        </div>

        <div className="shrink-0">
          <Pagination
            page={page}
            total={filtered.length}
            perPage={perPage}
            onChange={(p) => setPage(p)}
            onPerPageChange={(n) => { setPerPage(n); setPage(1); }}
          />
        </div>
      </Card>

      {/* ── Approve Confirm Modal ──────────────────────────── */}
      <Modal
        open={approveModal?.type === 'approve'}
        onClose={() => { setApproveModal(null); setApprovedAmount(''); }}
        title="Approve Commission Record"
        size="sm"
      >
        {approveModal && approveModal.type === 'approve' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 p-4 text-sm">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                Confirm Commission Approval
              </p>
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                Record: {approveModal.record.id?.slice(0, 10)}...<br />
                Rule: {approveModal.record.ruleName || approveModal.record.ruleType || 'N/A'}<br />
                System: {approveModal.record.systemSizeKW || 0} kW
              </p>
            </div>
            <Input
              label="Approved Amount (₹)"
              type="number"
              value={approvedAmount}
              onChange={(e) => setApprovedAmount(e.target.value)}
              placeholder={`Default: ${approveModal.record.amount || 0}`}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setApproveModal(null); setApprovedAmount(''); }}>
                Cancel
              </Button>
              <Button
                variant="success"
                icon={<CheckCircle className="h-4 w-4" />}
                onClick={handleApproveConfirm}
                loading={approveMutation.isPending}
              >
                Approve Commission
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Reject Confirm Modal ───────────────────────────── */}
      <Modal
        open={approveModal?.type === 'reject'}
        onClose={() => { setApproveModal(null); setRejectionReason(''); }}
        title="Reject Commission Record"
        size="sm"
      >
        {approveModal && approveModal.type === 'reject' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-4 text-sm">
              <p className="font-semibold text-red-700 dark:text-red-300">
                Confirm Rejection
              </p>
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                Record: {approveModal.record.id?.slice(0, 10)}...<br />
                This action cannot be undone.
              </p>
            </div>
            <Textarea
              label="Rejection Reason *"
              required
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Why is this commission being rejected?"
              rows={3}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setApproveModal(null); setRejectionReason(''); }}>
                Cancel
              </Button>
              <Button
                variant="danger"
                icon={<XCircle className="h-4 w-4" />}
                onClick={handleRejectConfirm}
                loading={approveMutation.isPending}
                disabled={!rejectionReason}
              >
                Reject Commission
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── View Record Modal ──────────────────────────────── */}
      <Modal
        open={!!viewRecord}
        onClose={() => setViewRecord(null)}
        title="Commission Record Details"
        size="md"
      >
        {viewRecord && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Record ID</p>
                <p className="mt-1 text-sm font-mono text-[var(--color-text)]">{viewRecord.id}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</p>
                <p className="mt-1"><StatusBadge status={viewRecord.status || 'pending'} /></p>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Lead ID</p>
                <p className="mt-1 text-sm text-[var(--color-text)]">{viewRecord.leadId || '—'}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Partner ID</p>
                <p className="mt-1 text-sm text-[var(--color-text)]">{viewRecord.partnerId || '—'}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Generated Date</p>
                <p className="mt-1 text-sm text-[var(--color-text)]">{formatDate(viewRecord.generatedDate)}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">System Size</p>
                <p className="mt-1 text-sm text-[var(--color-text)]">{viewRecord.systemSizeKW ? `${viewRecord.systemSizeKW} kW` : '—'}</p>
              </div>
            </div>

            <div className="border-t border-[var(--color-border-subtle)] pt-4">
              <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Commission Configuration</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Rule</p>
                  <p className="mt-1 text-sm text-[var(--color-text)]">{viewRecord.ruleName || 'Default'}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Rule Type</p>
                  <p className="mt-1 text-sm capitalize text-[var(--color-text)]">{viewRecord.ruleType?.replace(/_/g, ' ') || '—'}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Rule Value</p>
                  <p className="mt-1 text-sm text-[var(--color-text)]">{viewRecord.ruleValue || 0}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Commission Amount</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">
                    {formatCurrency(viewRecord.approvedAmount || viewRecord.amount || 0)}
                  </p>
                </div>
              </div>
            </div>

            {viewRecord.approvedBy && (
              <div className="border-t border-[var(--color-border-subtle)] pt-4">
                <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Approval Details</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Approved By</p>
                    <p className="mt-1 text-sm text-[var(--color-text)]">{viewRecord.approvedBy || '—'}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Approved At</p>
                    <p className="mt-1 text-sm text-[var(--color-text)]">{formatDate(viewRecord.approvedAt) || '—'}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-[var(--color-border-subtle)]">
              <Button variant="outline" size="sm" onClick={() => setViewRecord(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
