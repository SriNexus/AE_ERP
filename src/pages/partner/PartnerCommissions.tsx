/**
 * PartnerCommissions — Partner Commission History Workspace
 *
 * Full production workspace for partners to view their commission records.
 * Partners can view but cannot approve, reject, edit, delete, or recalculate commissions.
 * All state changes happen through the existing admin workflow.
 *
 * Reuses: PageShell, KPIStatCard, FilterBar, Table, Pagination, EmptyState
 * Consumes: CommissionRecord from existing domain layer
 * No duplicated commission engine, calculations, or business logic.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  DollarSign,
  Target,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { EmptyState } from '../../components/shared/EmptyState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Pagination } from '../../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { KPIStatCard } from '../../components/dashboard/KPIStatCard';
import { fmtDate, fmtCurrency, fmtCompactCurrency, getAll, resolveWriteCompanyId } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { queryKeys } from '../../lib/queryKeys';
import { useAppStore } from '../../store/useAppStore';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import type { ChannelPartner, CommissionRecord } from '../../features/channel-partner/types';
import { PartnerCommissionDetailDrawer } from '../../components/partner/PartnerCommissionDetailDrawer';

const PER_PAGE = 10;
const ALL = 'All';

const COMMISSION_DATE_RANGE_OPTIONS = [
  { label: 'All Time',    value: 'all' },
  { label: 'Today',       value: 'today' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Custom Range', value: 'custom' },
];

const COMMISSION_STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Statuses', value: ALL },
  { label: 'Pending',      value: 'pending' },
  { label: 'Calculated',   value: 'calculated' },
  { label: 'Approved',     value: 'approved' },
  { label: 'Paid',         value: 'paid' },
  { label: 'Voided',       value: 'voided' },
];

const COMMISSION_BADGE: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  calculated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  approved:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  paid:       'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  voided:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const COMMISSION_LABELS: Record<string, string> = {
  pending:    'Pending',
  calculated: 'Calculated',
  approved:   'Approved',
  paid:       'Paid',
  voided:     'Voided',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = COMMISSION_BADGE[s] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  const label = COMMISSION_LABELS[s] || s.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatDate(value: any): string {
  if (!value) return '—';
  const date = toDateValue(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB');
}

export default function PartnerCommissions() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Commission records (partner-only) ─────────────────
  const commissionQueryKey = ['commission_records', resolveWriteCompanyId()];
  const { data: allRecords = [], isLoading: recordsLoading, refetch } = useQuery({
    queryKey: commissionQueryKey,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerRecords: CommissionRecord[] = useMemo(
    () => allRecords
      .filter((r: any) => r.partnerId === partner?.id && !r.isDeleted) as CommissionRecord[],
    [allRecords, partner?.id],
  );

  // ── Leads lookup for lead names ───────────────────────
  const { data: allLeads = [] } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const leadNames = useMemo(() => {
    const map: Record<string, string> = {};
    allLeads.forEach((l: any) => {
      if (l.id) map[l.id] = l.name || l.company || l.id;
    });
    return map;
  }, [allLeads]);

  // ── Sort by most recent first ─────────────────────────
  const sortedRecords = useMemo(
    () => [...partnerRecords].sort((a, b) => {
      const da = toDateValue(a.generatedDate)?.getTime() || 0;
      const db = toDateValue(b.generatedDate)?.getTime() || 0;
      return db - da;
    }),
    [partnerRecords],
  );

  // ── View state from URL params ────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || ALL);
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [sortKey, setSortKey] = useState('generatedDate');
  const [sortDesc, setSortDesc] = useState(true);

  const [viewRecord, setViewRecord] = useState<CommissionRecord | null>(null);

  // ── Filtering ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...sortedRecords];

    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((r: CommissionRecord) =>
        [r.id, r.leadId, r.ruleName, r.ruleType, r.status]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (statusF !== ALL) {
      list = list.filter((r: CommissionRecord) => r.status === statusF);
    }

    // Sort
    list.sort((a: CommissionRecord, b: CommissionRecord) => {
      const av = String(a[sortKey as keyof CommissionRecord] || '');
      const bv = String(b[sortKey as keyof CommissionRecord] || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDesc ? -cmp : cmp;
    });

    // Date range filter
    if (dateRange !== 'all') {
      list = list.filter((r: CommissionRecord) => {
        const d = toDateValue(r.generatedDate);
        if (!d) return false;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        if (dateRange === 'today') return d.getTime() === now.getTime();
        if (dateRange === '7d') return (now.getTime() - d.getTime()) <= 7 * 86400000;
        if (dateRange === '30d') return (now.getTime() - d.getTime()) <= 30 * 86400000;
        if (dateRange === 'custom' && customFrom && customTo) {
          const from = new Date(customFrom);
          const to = new Date(customTo);
          return d >= from && d <= to;
        }
        return true;
      });
    }

    return list;
  }, [sortedRecords, search, statusF, dateRange, customFrom, customTo, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Reset page when filters change
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // ── Commission KPIs ───────────────────────────────────
  const kpis = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    return {
      totalEarned: partnerRecords.reduce((sum, r) => sum + (r.approvedAmount || r.amount || 0), 0),
      pending: partnerRecords.filter((r) => r.status === 'pending').length,
      approved: partnerRecords.filter((r) => r.status === 'approved').length,
      paid: partnerRecords.filter((r) => r.status === 'paid').length,
      voided: partnerRecords.filter((r) => r.status === 'voided').length,
      thisMonth: partnerRecords.filter((r) => {
        const d = toDateValue(r.generatedDate);
        if (!d) return false;
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      }).length,
    };
  }, [partnerRecords]);

  // ── URL sync ──────────────────────────────────────────
  function syncParams(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== ALL && v !== 'all') next.set(k, v);
      else next.delete(k);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch('');
    setStatusF(ALL);
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setPage(1);
    setSearchParams({}, { replace: true });
  }

  function sort(k: string) {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  const loading = partnersLoading || recordsLoading;
  const hasActiveFilters = Boolean(search || statusF !== ALL || dateRange !== 'all');

  return (
    <PageShell
      title="Commission History"
      subtitle="Track your earned commissions and approvals"
      icon={<DollarSign className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      }
    >
      {/* ── KPI Cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPIStatCard
          label="Total Earned"
          value={fmtCompactCurrency(kpis.totalEarned)}
          icon={<TrendingUp className="h-5 w-5" />}
          color="indigo"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Pending Approval"
          value={kpis.pending}
          icon={<Clock className="h-5 w-5" />}
          color="amber"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Approved"
          value={kpis.approved}
          icon={<CheckCircle2 className="h-5 w-5" />}
          color="emerald"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Paid"
          value={kpis.paid}
          icon={<DollarSign className="h-5 w-5" />}
          color="emerald"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Voided"
          value={kpis.voided}
          icon={<XCircle className="h-5 w-5" />}
          color="rose"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="This Month"
          value={kpis.thisMonth}
          icon={<Target className="h-5 w-5" />}
          color="purple"
          loading={loading}
          compact
        />
      </div>

      {/* ── FilterBar ─────────────────────────────────────── */}
      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); syncParams({ q: v, page: page > 1 ? String(page) : '' }); }}
        searchPlaceholder="Search by ID, lead, rule..."
        dateRange={dateRange}
        onDateRange={(v) => { setDateRange(v); setPage(1); syncParams({ date: v, page: page > 1 ? String(page) : '' }); }}
        dateRangeOptions={COMMISSION_DATE_RANGE_OPTIONS}
        customFrom={customFrom}
        customTo={customTo}
        onCustomRange={(f, t) => { setCustomFrom(f); setCustomTo(t); setPage(1); syncParams({ from: f, to: t, page: page > 1 ? String(page) : '' }); }}
        filters={[
          {
            label: 'Status',
            value: statusF,
            onChange: (v) => { setStatusF(v); setPage(1); },
            options: COMMISSION_STATUS_OPTIONS,
          },
        ]}
        count={filtered.length}
        total={sortedRecords.length}
        label="commission records"
        onClearAll={clearAll}
      />

      {/* ── Commissions Table ─────────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] overflow-hidden">
        <div className="min-h-0 overflow-x-auto">
          <Table>
            <Thead>
              <Th sortable sorted={sortKey === 'generatedDate'} desc={sortDesc} onSort={() => sort('generatedDate')}>DATE</Th>
              <Th>LEAD</Th>
              <Th className="hidden sm:table-cell">RULE</Th>
              <Th className="hidden md:table-cell">TYPE</Th>
              <Th className="hidden lg:table-cell">DEAL VALUE</Th>
              <Th sortable sorted={sortKey === 'amount'} desc={sortDesc} onSort={() => sort('amount')}>AMOUNT</Th>
              <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')}>STATUS</Th>
              <Th className="hidden lg:table-cell">PAYMENT DATE</Th>
              <Th className="w-20">ACTIONS</Th>
            </Thead>
            <Tbody>
              {loading ? (
                <SkeletonRows cols={9} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    {!partner ? (
                      <EmptyState
                        icon={<DollarSign className="h-8 w-8" />}
                        title="No Partner Profile"
                        description="Your account isn't linked to a partner profile."
                      />
                    ) : hasActiveFilters ? (
                      <EmptyState
                        icon={<DollarSign className="h-8 w-8" />}
                        title="No matching commissions"
                        description="Try adjusting your search or filters."
                      />
                    ) : (
                      <EmptyState
                        icon={<DollarSign className="h-8 w-8" />}
                        title="No Commissions Yet"
                        description="Your commission records will appear here after leads are completed and commissions are generated."
                        action={
                          <Button size="sm" disabled>
                            View Leads
                          </Button>
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((record: CommissionRecord) => (
                  <Tr
                    key={record.id}
                    onClick={() => setViewRecord(record)}
                    className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)]"
                  >
                    <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {formatDate(record.generatedDate)}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(leadNames[record.leadId] || '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--color-text)] text-sm leading-tight truncate max-w-[160px]">
                            {leadNames[record.leadId] || '—'}
                          </p>
                          <p className="text-[10px] font-mono text-[var(--color-text-muted)] truncate">
                            {record.leadId?.slice(0, 10)}…
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden sm:table-cell text-xs text-[var(--color-text-muted)] max-w-[140px] truncate">
                      {record.ruleName || '—'}
                    </Td>
                    <Td className="hidden md:table-cell text-[10px] text-[var(--color-text-muted)] capitalize">
                      {record.ruleType?.replace(/_/g, ' ') || '—'}
                    </Td>
                    <Td className="hidden lg:table-cell text-xs text-[var(--color-text-muted)] tabular-nums">
                      {record.dealValue ? fmtCurrency(record.dealValue) : '—'}
                    </Td>
                    <Td className="text-xs font-semibold tabular-nums text-[var(--color-text)]">
                      {fmtCurrency(record.approvedAmount || record.amount || 0)}
                    </Td>
                    <Td>
                      <StatusBadge status={record.status} />
                    </Td>
                    <Td className="hidden lg:table-cell text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {record.paidAt ? formatDate(record.paidAt) : '—'}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end opacity-75 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setViewRecord(record); }}
                          className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-sm transition-all hover:-translate-y-0.5 hover:opacity-90"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </div>

        {filtered.length > PER_PAGE && (
          <Pagination
            page={page}
            total={filtered.length}
            perPage={PER_PAGE}
            onChange={(p) => { setPage(p); syncParams({ page: p > 1 ? String(p) : '' }); }}
          />
        )}
      </div>

      {/* ── Commission Detail Drawer ───────────────────────── */}
      <PartnerCommissionDetailDrawer
        record={viewRecord}
        open={!!viewRecord}
        onClose={() => setViewRecord(null)}
      />
    </PageShell>
  );
}
