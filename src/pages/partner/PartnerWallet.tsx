/**
 * PartnerWallet — Partner Portal Wallet Workspace
 *
 * Full production workspace for partners to view their wallet balance,
 * transaction history, and request withdrawals.
 *
 * Consumes existing domain layer. No duplicated business logic.
 * Partner-only filtering via partnerId.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Wallet,
  Target,
  TrendingUp,
  DollarSign,
  RefreshCw,
  Eye,
  Plus,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { EmptyState } from '../../components/shared/EmptyState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Pagination } from '../../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { KPIStatCard } from '../../components/dashboard/KPIStatCard';
import { fmtDate, fmtCurrency, fmtCompactCurrency, getAll } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { queryKeys } from '../../lib/queryKeys';
import { useAppStore } from '../../store/useAppStore';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import { mapToWalletTransaction } from '../../features/channel-partner/utils/mappers';
import type { ChannelPartner, PartnerWalletTransaction } from '../../features/channel-partner/types';
import { PartnerWithdrawalModal } from '../../components/partner/PartnerWithdrawalModal';
import { PartnerWalletTransactionDrawer } from '../../components/partner/PartnerWalletTransactionDrawer';

const PER_PAGE = 10;
const ALL = 'All';

const WALLET_DATE_RANGE_OPTIONS = [
  { label: 'All Time',   value: 'all' },
  { label: 'Today',      value: 'today' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Custom Range', value: 'custom' },
];

const TXN_TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Types', value: ALL },
  { label: 'Commission Credit', value: 'commission_credit' },
  { label: 'Withdrawal Requested', value: 'withdrawal_request' },
  { label: 'Withdrawal Approved', value: 'withdrawal_approved' },
  { label: 'Withdrawal Paid', value: 'withdrawal_paid' },
  { label: 'Withdrawal Rejected', value: 'withdrawal_rejected' },
  { label: 'Adjustment', value: 'adjustment' },
  { label: 'Reversal', value: 'reversal' },
];

const TXN_TYPE_BADGE: Record<string, string> = {
  commission_credit: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  withdrawal_request: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  withdrawal_approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  withdrawal_rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  withdrawal_paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  adjustment: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  reversal: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

const TXN_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
};

function TXN_TYPE_LABEL(type: string): string {
  const map: Record<string, string> = {
    commission_credit: 'Commission',
    withdrawal_request: 'Withdrawal Req.',
    withdrawal_approved: 'Approved',
    withdrawal_rejected: 'Rejected',
    withdrawal_paid: 'Paid',
    adjustment: 'Adjustment',
    reversal: 'Reversal',
  };
  return map[type] || type.replace(/_/g, ' ');
}

function TransactionTypeBadge({ type }: { type: string }) {
  const style = TXN_TYPE_BADGE[type] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {TXN_TYPE_LABEL(type)}
    </span>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const style = TXN_STATUS_BADGE[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  const label = WITHDRAWAL_STATUS_LABELS[status] || status;
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

export default function PartnerWallet() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Wallet transactions (partner-only) ────────────────
  const { data: allTxns = [], isLoading: txnsLoading, refetch } = useQuery({
    queryKey: companyKeys.partnerWalletTxns,
    queryFn: () => getAll(COLLECTIONS.PARTNER_WALLET_TXNS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerTxns: PartnerWalletTransaction[] = useMemo(
    () => allTxns
      .filter((t: any) => t.partnerId === partner?.id && !t.isDeleted)
      .map((t: any) => mapToWalletTransaction(t)),
    [allTxns, partner?.id],
  );

  // ── Sort by most recent first ─────────────────────────
  const sortedTxns = useMemo(
    () => [...partnerTxns].sort((a, b) => {
      const da = toDateValue(a.createdAt)?.getTime() || 0;
      const db = toDateValue(b.createdAt)?.getTime() || 0;
      return db - da;
    }),
    [partnerTxns],
  );

  // ── View state from URL params ────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [typeFilter, setTypeFilter] = useState(() => searchParams.get('type') || ALL);
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDesc, setSortDesc] = useState(true);

  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState<PartnerWalletTransaction | null>(null);

  // ── Filtering ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...sortedTxns];

    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((t: PartnerWalletTransaction) =>
        [t.id, t.description, t.type, t.sourceType]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (typeFilter !== ALL) {              list = list.filter((t: PartnerWalletTransaction) => t.type === typeFilter);
    }

    // Sort
    list.sort((a: PartnerWalletTransaction, b: PartnerWalletTransaction) => {
      if (sortKey === 'createdAt') {
        const da = toDateValue(a.createdAt)?.getTime() || 0;
        const db = toDateValue(b.createdAt)?.getTime() || 0;
        return sortDesc ? db - da : da - db;
      }
      if (sortKey === 'amount') {
        return sortDesc ? Math.abs(b.amount) - Math.abs(a.amount) : Math.abs(a.amount) - Math.abs(b.amount);
      }
      return 0;
    });

    if (dateRange !== 'all') {
      list = list.filter((t: PartnerWalletTransaction) => {
        const d = toDateValue(t.createdAt);
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
  }, [sortedTxns, search, typeFilter, dateRange, customFrom, customTo, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Reset page when filters change
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // ── Wallet KPIs ───────────────────────────────────────
  const walletKpis = useMemo(() => {
    const pendingWithdrawal = partnerTxns
      .filter((t) => t.type === 'withdrawal_request' && t.withdrawalStatus === 'pending')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const lastSettlement = partnerTxns
      .filter((t) => t.type === 'commission_credit')
      .sort((a, b) => {
        const da = toDateValue(a.createdAt)?.getTime() || 0;
        const db = toDateValue(b.createdAt)?.getTime() || 0;
        return db - da;
      })[0];

    return {
      walletBalance: partner?.walletBalance ?? 0,
      pendingBalance: partner?.pendingBalance ?? 0,
      totalEarned: partner?.totalCommissionEarned ?? 0,
      totalPaid: partner?.totalCommissionPaid ?? 0,
      pendingWithdrawal,
      lastSettlementDate: lastSettlement?.createdAt || null,
    };
  }, [partnerTxns, partner]);

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
    setTypeFilter(ALL);
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setPage(1);
    setSearchParams({}, { replace: true });
  }

  const loading = partnersLoading || txnsLoading;
  const hasActiveFilters = Boolean(search || typeFilter !== ALL || dateRange !== 'all');

  return (
    <PageShell
      title="Wallet"
      subtitle="Your earnings and transaction history"
      icon={<Wallet className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
            Refresh
          </Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowWithdrawal(true)}>
            Withdraw
          </Button>
        </div>
      }
    >
      {/* ── KPI Cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPIStatCard
          label="Wallet Balance"
          value={fmtCompactCurrency(walletKpis.walletBalance)}
          icon={<Wallet className="h-5 w-5" />}
          color="indigo"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Pending Settlement"
          value={fmtCompactCurrency(walletKpis.pendingBalance)}
          icon={<Clock className="h-5 w-5" />}
          color="amber"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Total Earned"
          value={fmtCurrency(walletKpis.totalEarned)}
          icon={<TrendingUp className="h-5 w-5" />}
          color="emerald"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Total Paid"
          value={fmtCurrency(walletKpis.totalPaid)}
          icon={<DollarSign className="h-5 w-5" />}
          color="emerald"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Pending Withdrawal"
          value={fmtCurrency(walletKpis.pendingWithdrawal)}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="orange"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Last Settlement"
          value={walletKpis.lastSettlementDate ? fmtCompactCurrency(walletKpis.totalEarned) : '—'}
          sub={walletKpis.lastSettlementDate ? fmtDate(walletKpis.lastSettlementDate) : undefined}
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
        searchPlaceholder="Search by ID, description, type..."
        dateRange={dateRange}
        onDateRange={(v) => { setDateRange(v); setPage(1); syncParams({ date: v, page: page > 1 ? String(page) : '' }); }}
        dateRangeOptions={WALLET_DATE_RANGE_OPTIONS}
        customFrom={customFrom}
        customTo={customTo}
        onCustomRange={(f, t) => { setCustomFrom(f); setCustomTo(t); setPage(1); syncParams({ from: f, to: t, page: page > 1 ? String(page) : '' }); }}
        filters={[
          {
            label: 'Type',
            value: typeFilter,
            onChange: (v) => { setTypeFilter(v); setPage(1); },
            options: TXN_TYPE_OPTIONS,
          },
        ]}
        count={filtered.length}
        total={sortedTxns.length}
        label="transactions"
        onClearAll={clearAll}
      />

      {/* ── Transactions Table ────────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] overflow-hidden">
        <div className="min-h-0 overflow-x-auto">
          <Table>
            <Thead>
              <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => { if (sortKey === 'createdAt') setSortDesc(d => !d); else { setSortKey('createdAt'); setSortDesc(true); } }}>DATE</Th>
              <Th>TXN ID</Th>
              <Th>TYPE</Th>
              <Th className="hidden sm:table-cell">DESCRIPTION</Th>
              <Th sortable sorted={sortKey === 'amount'} desc={sortDesc} onSort={() => { if (sortKey === 'amount') setSortDesc(d => !d); else { setSortKey('amount'); setSortDesc(true); } }}>CREDIT</Th>
              <Th>DEBIT</Th>
              <Th className="hidden md:table-cell">BALANCE</Th>
              <Th className="w-16">STATUS</Th>
              <Th className="w-16">ACTIONS</Th>
            </Thead>
            <Tbody>
              {loading ? (
                <SkeletonRows cols={9} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    {!partner ? (
                      <EmptyState
                        icon={<Wallet className="h-8 w-8" />}
                        title="No Partner Profile"
                        description="Your account isn't linked to a partner profile."
                      />
                    ) : hasActiveFilters ? (
                      <EmptyState
                        icon={<Wallet className="h-8 w-8" />}
                        title="No matching transactions"
                        description="Try adjusting your search or filters."
                      />
                    ) : (
                      <EmptyState
                        icon={<Wallet className="h-8 w-8" />}
                        title="No Transactions Yet"
                        description="Your wallet transactions will appear here once commissions start generating."
                        action={
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowWithdrawal(true)} disabled>
                            Request Withdrawal
                          </Button>
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((txn: PartnerWalletTransaction) => {
                  const isCredit = txn.amount > 0;
                  return (
                    <Tr
                      key={txn.id}
                      onClick={() => setSelectedTxn(txn)}
                      className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)]"
                    >
                      <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                        {fmtDate(txn.createdAt)}
                      </Td>
                      <Td>
                        <code className="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-bg-sunken)] px-1.5 py-0.5 rounded">
                          {(txn.id || '').slice(0, 12)}…
                        </code>
                      </Td>
                      <Td>
                        <TransactionTypeBadge type={txn.type} />
                      </Td>
                      <Td className="hidden sm:table-cell text-xs text-[var(--color-text-muted)] max-w-[200px] truncate">
                        {txn.description || '—'}
                      </Td>
                      <Td className="text-xs font-semibold">
                        {isCredit ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            +{fmtCurrency(txn.amount)}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-disabled)]">—</span>
                        )}
                      </Td>
                      <Td className="text-xs font-semibold">
                        {!isCredit ? (
                          <span className="text-red-600 dark:text-red-400">
                            {fmtCurrency(Math.abs(txn.amount))}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-disabled)]">—</span>
                        )}
                      </Td>
                      <Td className="hidden md:table-cell text-xs text-[var(--color-text-muted)]">
                        {fmtCurrency(txn.balanceAfter)}
                      </Td>
                      <Td>
                        <StatusBadge status={txn.withdrawalStatus} />
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end opacity-75 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedTxn(txn); }}
                            className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-sm transition-all hover:-translate-y-0.5 hover:opacity-90"
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })
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

      {/* ── Withdrawal Modal ──────────────────────────────── */}
      <PartnerWithdrawalModal
        open={showWithdrawal}
        onClose={() => setShowWithdrawal(false)}
        partner={partner}
      />

      {/* ── Transaction Detail Drawer ─────────────────────── */}
      <PartnerWalletTransactionDrawer
        transaction={selectedTxn}
        open={!!selectedTxn}
        onClose={() => setSelectedTxn(null)}
      />
    </PageShell>
  );
}
