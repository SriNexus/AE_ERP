/**
 * PartnerMobileSettlementWorkspace — Mobile settlement & withdrawal history for partners
 *
 * Partner-facing mobile view showing:
 *   - Settlement history (completed batches)
 *   - Withdrawal request statuses
 *   - Wallet credit summary
 *   - Export history (read-only, partner's own)
 *   - Settlement audit timeline (read-only)
 *   - Scheduler status (read-only)
 *   - Last settlement/withdrawal dates
 *
 * Partners can view but cannot take admin actions.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DollarSign,
  RefreshCw,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Download,
  FileText,
  History,
  Activity,
} from 'lucide-react';
import { getAll, fmtDate, resolveWriteCompanyId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePartnerSelf } from '../../../features/channel-partner/hooks/usePartnerSelf';
import { mapToWalletTransaction } from '../../../features/channel-partner/utils/mappers';
import type { PartnerWalletTransaction } from '../../../features/channel-partner/types';
import { SettlementDetailDrawer } from '../../partner/SettlementDetailDrawer';
import { downloadCsv, exportSettlementsToCsv, exportWithdrawalsToCsv } from '../../../lib/settlementExport';
import { loadExportHistory, type ExportHistoryEntry } from '../../../lib/exportHistory';
import { loadSchedulerConfig } from '../../../lib/autoSettlementScheduler';

const TAB_OPTIONS = ['All', 'Settlements', 'Withdrawals', 'Exports'] as const;
type Tab = (typeof TAB_OPTIONS)[number];

const STATUS_STYLES: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  completed:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  paid:       'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  approved:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  rejected:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  processing: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  pending_wd: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const style = STATUS_STYLES[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function PartnerMobileSettlementWorkspace() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const companyKeys = queryKeys.forCompany(activeCompanyId);  const { data: partnerSelf } = usePartnerSelf();
  const partner = partnerSelf?.partner;

  const { data: allTxns = [], isLoading, refetch } = useQuery({
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

  const [tab, setTab] = useState<Tab>('All');
  const [viewSettlement, setViewSettlement] = useState<any>(null);
  const [exportView, setExportView] = useState<ExportHistoryEntry | null>(null);

  // ── Export history (partner's own) ──────────────────────
  const [exportHistory, setExportHistory] = useState<ExportHistoryEntry[]>([]);
  const [exportSearch, setExportSearch] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    if (!companyId || !partner?.id) return;
    setExportLoading(true);
    loadExportHistory(companyId, { partnerId: partner.id })
      .then(setExportHistory)
      .catch(() => setExportHistory([]))
      .finally(() => setExportLoading(false));
  }, [companyId, partner?.id]);

  // ── Scheduler status (read-only) ────────────────────────
  const [schedulerStatus, setSchedulerStatus] = useState<{
    enabled: boolean;
    lastRunAt?: string;
    nextRunAt?: string;
    mode?: string;
  }>({ enabled: false });

  useEffect(() => {
    loadSchedulerConfig().then((config) => {
      setSchedulerStatus({
        enabled: config.enabled,
        lastRunAt: config.lastRunAt,
        nextRunAt: config.nextRunAt,
        mode: config.mode,
      });
    }).catch(() => {});
  }, []);

  // Filter to this partner's records
  const partnerTxns: PartnerWalletTransaction[] = useMemo(
    () => allTxns
      .filter((t: any) => t.partnerId === partner?.id && !t.isDeleted)
      .map((t: any) => mapToWalletTransaction(t)),
    [allTxns, partner?.id],
  );

  // Settlements (txns with commissionIds array)
  const settlements = useMemo(
    () => partnerTxns
      .filter((t: any) => (t as any).commissionIds && Array.isArray((t as any).commissionIds))
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [partnerTxns],
  );

  // Withdrawals
  const withdrawals = useMemo(
    () => partnerTxns
      .filter((t) => t.type === 'withdrawal_request')
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [partnerTxns],
  );

  const displayed = tab === 'Settlements' ? settlements
    : tab === 'Withdrawals' ? withdrawals
    : tab === 'Exports' ? []
    : [...settlements, ...withdrawals].sort(
      (a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );

  // Filtered exports
  const filteredExports = useMemo(() => {
    if (!exportSearch.trim()) return exportHistory;
    const q = exportSearch.toLowerCase();
    return exportHistory.filter(
      (e) =>
        e.filename.toLowerCase().includes(q) ||
        e.exportType.toLowerCase().includes(q) ||
        e.format.toLowerCase().includes(q),
    );
  }, [exportHistory, exportSearch]);

  // Export helper
  const partnerNameMap = useMemo(() => {
    if (!partner) return {};
    return { [partner.id]: partner.firmName || partner.contactPerson || partner.id };
  }, [partner]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg)] px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--color-text)]">Settlements</h1>
              <p className="text-xs text-[var(--color-text-muted)]">
                {settlements.length} settlements · {withdrawals.length} withdrawals · {exportHistory.length} exports
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {tab !== 'Exports' && (
              <>
                <button
                  onClick={() => downloadCsv(exportSettlementsToCsv(settlements, partnerNameMap), 'my-settlements.csv')}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  title="Export settlements as CSV"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => downloadCsv(exportWithdrawalsToCsv(withdrawals, partnerNameMap), 'my-withdrawals.csv')}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  title="Export withdrawals as CSV"
                >
                  <FileText className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              onClick={() => refetch()}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ── Summary row ──────────────────────────────────── */}
        {partner && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {settlements.filter((s: any) => s.status === 'completed').length}
              </p>
              <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Completed</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                {withdrawals.filter((w) => w.withdrawalStatus === 'pending').length}
              </p>
              <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">Pending WD</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {withdrawals.filter((w) => w.withdrawalStatus === 'paid').length}
              </p>
              <p className="text-[10px] font-medium text-blue-700 dark:text-blue-300">Paid</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {exportHistory.length}
              </p>
              <p className="text-[10px] font-medium text-purple-700 dark:text-purple-300">Exports</p>
            </div>
          </div>
        )}

        {/* ── Scheduler status card (read-only) ────────────── */}
        {tab !== 'Exports' && schedulerStatus && (
          <div className="flex items-center gap-3 mb-3 px-2 py-1.5 bg-[var(--color-bg-sunken)] rounded-lg">
            <Activity className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
            <span className="text-[10px] text-[var(--color-text-muted)]">
              Scheduler: {schedulerStatus.enabled ? 'Active' : 'Inactive'}
              {schedulerStatus.lastRunAt && ` · Last: ${fmtDate(schedulerStatus.lastRunAt)}`}
              {schedulerStatus.nextRunAt && ` · Next: ${fmtDate(schedulerStatus.nextRunAt)}`}
            </span>
          </div>
        )}

        {/* ── Tab pills ────────────────────────────────────── */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TAB_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all whitespace-nowrap ${
                tab === t
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content Area ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {tab === 'Exports' ? (
          /* ── Export History Tab ──────────────────────────── */
          <div className="space-y-2">
            {/* Search */}
            <div className="relative">
              <input
                value={exportSearch}
                onChange={(e) => setExportSearch(e.target.value)}
                placeholder="Search exports..."
                className="w-full pl-8 pr-3 py-2 text-xs border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <History className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
            </div>

            {exportLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse bg-[var(--color-surface)] rounded-xl" />
                ))}
              </div>
            ) : filteredExports.length === 0 ? (
              <div className="flex flex-col items-center justify-center pt-12 text-center">
                <div className="h-12 w-12 rounded-2xl bg-[var(--color-surface-hover)] flex items-center justify-center mb-3">
                  <FileText className="h-6 w-6 text-[var(--color-text-muted)]" />
                </div>
                <p className="text-sm font-semibold text-[var(--color-text)]">No exports found</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {exportSearch ? 'No exports match your search.' : 'Exports you generate will appear here.'}
                </p>
              </div>
            ) : (
              filteredExports.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => setExportView(entry)}
                  className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3.5 cursor-pointer hover:bg-[var(--color-surface-hover)] transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                        entry.format === 'CSV' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-indigo-100 dark:bg-indigo-900/30'
                      }`}>
                        <FileText className={`h-4 w-4 ${
                          entry.format === 'CSV' ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'
                        }`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--color-text)] truncate max-w-[180px]">
                          {entry.filename}
                        </p>
                        <p className="text-[10px] text-[var(--color-text-muted)]">
                          {entry.exportType.replace('_', ' ')} · {entry.rowCount} rows
                        </p>
                      </div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      entry.format === 'CSV' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'
                    }`}>
                      {entry.format}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                    <Clock className="h-3 w-3" />
                    <span>{fmtDate(entry.generatedAt)}</span>
                    <span>·</span>
                    <span>by {entry.generatedByName}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* ── Settlements / Withdrawals List ──────────────── */
          <>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 animate-pulse bg-[var(--color-surface)] rounded-xl" />
                ))}
              </div>
            ) : displayed.length === 0 ? (
              <div className="flex flex-col items-center justify-center pt-12 text-center">
                <div className="h-12 w-12 rounded-2xl bg-[var(--color-surface-hover)] flex items-center justify-center mb-3">
                  <DollarSign className="h-6 w-6 text-[var(--color-text-muted)]" />
                </div>
                <p className="text-sm font-semibold text-[var(--color-text)]">No settlement activity yet</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">Settlements and withdrawals will appear here.</p>
              </div>
            ) : (
              displayed.map((item: any) => {
                const isSettlement = item.commissionIds && Array.isArray(item.commissionIds);
                const status = isSettlement ? item.status : item.withdrawalStatus;
                const isCredit = item.amount > 0;

                return (
                  <div
                    key={item.id}
                    onClick={() => isSettlement ? setViewSettlement(item) : undefined}
                    className={`bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3.5 ${isSettlement ? 'cursor-pointer hover:bg-[var(--color-surface-hover)]' : ''} transition-all`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                          isSettlement ? 'bg-indigo-100 dark:bg-indigo-900/30' : 'bg-red-100 dark:bg-red-900/30'
                        }`}>
                          {isSettlement ? (
                            <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4 text-red-600 dark:text-red-400" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-text)]">
                            {isSettlement ? 'Settlement Batch' : 'Withdrawal Request'}
                          </p>
                          <p className="text-[10px] font-mono text-[var(--color-text-muted)]">
                            {item.id?.slice(0, 12)}…
                          </p>
                        </div>
                      </div>
                      <StatusPill status={status} />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className={`text-base font-bold ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {isCredit ? '+' : '-'}{Math.abs(item.amount || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        {new Date(item.createdAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    {isSettlement && (
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                        <span>{item.commissionCount || 0} commissions</span>
                        {item.status === 'completed' && (
                          <>
                            <span>·</span>
                            <span className="text-emerald-600">{item.successCount || 0} success</span>
                            {(item.failedCount || 0) > 0 && <span className="text-red-500">{item.failedCount} failed</span>}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* ── Export Details Modal ────────────────────────────── */}
      {exportView && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setExportView(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative w-full max-w-sm bg-[var(--color-bg)] rounded-t-2xl p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[var(--color-text)]">Export Details</h3>
              <button
                onClick={() => setExportView(null)}
                className="h-7 w-7 rounded-lg flex items-center justify-center bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-1 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">File</span>
                <span className="font-semibold">{exportView.filename}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Type</span>
                <span className="font-semibold capitalize">{exportView.exportType.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Format</span>
                <span className={`font-semibold ${exportView.format === 'CSV' ? 'text-emerald-600' : 'text-indigo-600'}`}>
                  {exportView.format}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Rows</span>
                <span className="font-semibold">{exportView.rowCount}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Generated</span>
                <span className="font-semibold text-xs">{fmtDate(exportView.generatedAt)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--color-text-muted)]">By</span>
                <span className="font-semibold">{exportView.generatedByName}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Settlement Detail Drawer ──────────────────────────── */}
      <SettlementDetailDrawer
        settlement={viewSettlement}
        open={!!viewSettlement}
        onClose={() => setViewSettlement(null)}
      />
    </div>
  );
}

export default PartnerMobileSettlementWorkspace;
