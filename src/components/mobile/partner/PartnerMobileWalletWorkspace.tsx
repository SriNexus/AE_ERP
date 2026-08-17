/**
 * PartnerMobileWalletWorkspace — Mobile Partner Wallet Workspace
 *
 * Displays wallet balance, recent transactions, and withdrawal button.
 * Desktop remains the source architecture — shares the same data layer.
 * Partner-only filtering via partnerId.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet, ArrowUpRight, ArrowDownLeft, Plus, RefreshCw, Eye } from 'lucide-react';
import { Card, Button, Pagination } from '../../ui';
import { fmtDate, fmtCurrency, fmtCompactCurrency, getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePartnerSelf } from '../../../features/channel-partner/hooks/usePartnerSelf';
import { mapToWalletTransaction } from '../../../features/channel-partner/utils/mappers';
import type { ChannelPartner, PartnerWalletTransaction } from '../../../features/channel-partner/types';
import { PartnerWithdrawalModal } from '../../partner/PartnerWithdrawalModal';
import { PartnerWalletTransactionDrawer } from '../../partner/PartnerWalletTransactionDrawer';
import { cn } from '../../../utils/cn';

const PER_PAGE = 10;

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

const TXN_TYPE_COLORS: Record<string, string> = {
  commission_credit: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
  withdrawal_request: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
  withdrawal_approved: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400',
  withdrawal_rejected: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400',
  withdrawal_paid: 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400',
  adjustment: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-400',
  reversal: 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-400',
};

const TXN_TYPE_LABELS: Record<string, string> = {
  commission_credit: 'Commission',
  withdrawal_request: 'Withdrawal',
  withdrawal_approved: 'Approved',
  withdrawal_rejected: 'Rejected',
  withdrawal_paid: 'Paid Out',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
};

function TxnSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
        </div>
        <div className="h-5 w-16 rounded bg-[var(--color-bg-sunken)]" />
      </div>
    </Card>
  );
}

export function PartnerMobileWalletWorkspace() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Wallet transactions ──────────────────────────────
  const { data: allTxns = [], isLoading: txnsLoading, refetch } = useQuery({
    queryKey: companyKeys.partnerWalletTxns,
    queryFn: () => getAll(COLLECTIONS.PARTNER_WALLET_TXNS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerTxns = useMemo(
    () => allTxns
      .filter((t: any) => t.partnerId === partner?.id && !t.isDeleted)
      .map((t: any) => mapToWalletTransaction(t))
      .sort((a: PartnerWalletTransaction, b: PartnerWalletTransaction) => {
        const da = toDateValue(a.createdAt)?.getTime() || 0;
        const db = toDateValue(b.createdAt)?.getTime() || 0;
        return db - da;
      }),
    [allTxns, partner?.id],
  );

  // ── State ─────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState<PartnerWalletTransaction | null>(null);

  const paginated = useMemo(
    () => partnerTxns.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [partnerTxns, page],
  );

  const loading = partnersLoading || txnsLoading;

  // ── Wallet KPIs ───────────────────────────────────────
  const pendingWithdrawal = useMemo(
    () => partnerTxns
      .filter((t) => t.type === 'withdrawal_request' && t.withdrawalStatus === 'pending')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [partnerTxns],
  );

  return (
    <div className="space-y-4 pb-4 pt-2">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Wallet</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowWithdrawal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Withdraw
          </button>
        </div>
      </div>

      {/* ── Balance Card ────────────────────────────────── */}
      <Card className="rounded-xl border border-[var(--color-border)] bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950/40 dark:to-indigo-900/20 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Wallet Balance</p>
            <p className="text-2xl font-extrabold text-[var(--color-text)] tabular-nums">
              {loading ? '—' : fmtCompactCurrency(partner?.walletBalance ?? 0)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-white/60 dark:bg-black/20 p-2.5">
            <p className="font-medium text-[var(--color-text-muted)]">Total Earned</p>
            <p className="font-bold text-[var(--color-text)]">{loading ? '—' : fmtCurrency(partner?.totalCommissionEarned ?? 0)}</p>
          </div>
          <div className="rounded-lg bg-white/60 dark:bg-black/20 p-2.5">
            <p className="font-medium text-[var(--color-text-muted)]">Pending Settlement</p>
            <p className="font-bold text-[var(--color-text)]">{loading ? '—' : fmtCompactCurrency(partner?.pendingBalance ?? 0)}</p>
          </div>
        </div>
        {pendingWithdrawal > 0 && (
          <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2.5 text-xs">
            <p className="font-medium text-amber-700 dark:text-amber-300">
              Pending withdrawal: {fmtCurrency(pendingWithdrawal)}
            </p>
          </div>
        )}
      </Card>

      {/* ── Recent Transactions ─────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-bold text-[var(--color-text)]">Recent Transactions</h2>
        <span className="text-xs text-[var(--color-text-muted)]">{partnerTxns.length} total</span>
      </div>

      <div className="space-y-2">
        {loading && Array.from({ length: 3 }).map((_, i) => <TxnSkeletonCard key={i} />)}

        {!loading && !partner && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
            <Wallet className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
            <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">No Partner Profile</p>
            <p className="text-xs text-[var(--color-text-muted)]">Contact your administrator.</p>
          </div>
        )}

        {!loading && partner && paginated.length === 0 && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
            <Wallet className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
            <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">No Transactions Yet</p>
            <p className="text-xs text-[var(--color-text-muted)]">Commissions will appear here once they start generating.</p>
          </div>
        )}

        {!loading && paginated.map((txn: PartnerWalletTransaction) => {
          const isCredit = txn.amount > 0;
          const typeColor = TXN_TYPE_COLORS[txn.type] || 'text-gray-600 bg-gray-50 dark:bg-gray-800';
          return (
            <button
              key={txn.id}
              type="button"
              onClick={() => setSelectedTxn(txn)}
              className="w-full text-left"
            >
              <Card className={cn(
                'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-all',
                'hover:shadow-[var(--shadow-enterprise-row)] active:scale-[0.99]',
              )}>
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${typeColor}`}>
                    {isCredit ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                        {TXN_TYPE_LABELS[txn.type] || txn.type.replace(/_/g, ' ')}
                      </p>
                      {txn.withdrawalStatus && txn.withdrawalStatus !== 'pending' && (
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                          txn.withdrawalStatus === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                          txn.withdrawalStatus === 'approved' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                          txn.withdrawalStatus === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        )}>
                          {txn.withdrawalStatus}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      {fmtDate(txn.createdAt)}{txn.description ? ` · ${txn.description}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn(
                      'text-sm font-bold tabular-nums',
                      isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                    )}>
                      {isCredit ? '+' : ''}{fmtCurrency(txn.amount)}
                    </p>
                  </div>
                </div>
              </Card>
            </button>
          );
        })}
      </div>

      {/* ── Pagination ──────────────────────────────────── */}
      {partnerTxns.length > PER_PAGE && (
        <Pagination
          page={page}
          total={partnerTxns.length}
          perPage={PER_PAGE}
          onChange={setPage}
        />
      )}

      {/* ── Withdrawal button (bottom) ──────────────────── */}
      {partner && partnerTxns.length > 0 && (
        <button
          type="button"
          onClick={() => setShowWithdrawal(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition-all active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> Request Withdrawal
        </button>
      )}

      {/* ── Modals ──────────────────────────────────────── */}
      <PartnerWithdrawalModal
        open={showWithdrawal}
        onClose={() => setShowWithdrawal(false)}
        partner={partner}
      />
      <PartnerWalletTransactionDrawer
        transaction={selectedTxn}
        open={!!selectedTxn}
        onClose={() => setSelectedTxn(null)}
      />
    </div>
  );
}

export default PartnerMobileWalletWorkspace;
