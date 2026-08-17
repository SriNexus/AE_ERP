/**
 * PartnerMobileCommissionsWorkspace — Mobile Commission History for Partner Portal
 *
 * Reuses mobile architecture from PartnerMobileWalletWorkspace.
 * Displays: summary cards, commission list, detail modal, filters.
 * No admin actions — entirely read-only for partners.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, AlertTriangle, Search, RefreshCw } from 'lucide-react';
import { getAll, fmtDate, fmtCurrency, fmtCompactCurrency, resolveWriteCompanyId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePartnerSelf } from '../../../features/channel-partner/hooks/usePartnerSelf';
import type { ChannelPartner, CommissionRecord } from '../../../features/channel-partner/types';
import { PartnerCommissionDetailDrawer } from '../../partner/PartnerCommissionDetailDrawer';

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

const COMMISSION_STATUS_BADGE: Record<string, string> = {
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

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = COMMISSION_STATUS_BADGE[s] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  const label = COMMISSION_LABELS[s] || s.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

export function PartnerMobileCommissionsWorkspace() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [viewRecord, setViewRecord] = useState<CommissionRecord | null>(null);

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Commission records (partner-only) ─────────────────
  const commissionQueryKey = ['commission_records', resolveWriteCompanyId()];
  const { data: allRecords = [], isLoading, refetch } = useQuery({
    queryKey: commissionQueryKey,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerRecords: CommissionRecord[] = useMemo(
    () => allRecords
      .filter((r: any) => r.partnerId === partner?.id && !r.isDeleted)
      .sort((a: any, b: any) => {
        const da = toDateValue(a.generatedDate)?.getTime() || 0;
        const db = toDateValue(b.generatedDate)?.getTime() || 0;
        return db - da;
      }) as CommissionRecord[],
    [allRecords, partner?.id],
  );

  // ── Leads lookup ──────────────────────────────────────
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

  // ── Filtering ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...partnerRecords];
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((r) =>
        [r.id, r.leadId, r.ruleName, r.status]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (statusFilter) {
      list = list.filter((r) => r.status === statusFilter);
    }
    return list;
  }, [partnerRecords, search, statusFilter]);

  // ── KPI calculations ──────────────────────────────────
  const kpis = useMemo(() => ({
    totalEarned: partnerRecords.reduce((s, r) => s + (r.approvedAmount || r.amount || 0), 0),
    pending: partnerRecords.filter((r) => r.status === 'pending').length,
    paid: partnerRecords.filter((r) => r.status === 'paid').length,
  }), [partnerRecords]);

  const STATUS_FILTERS = [
    { label: 'All', value: null, count: partnerRecords.length },
    { label: 'Pending', value: 'pending', count: partnerRecords.filter((r) => r.status === 'pending').length },
    { label: 'Approved', value: 'approved', count: partnerRecords.filter((r) => r.status === 'approved').length },
    { label: 'Paid', value: 'paid', count: partnerRecords.filter((r) => r.status === 'paid').length },
  ];

  if (!partner) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">No Partner Profile</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Your account isn't linked to a partner profile.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-lg font-extrabold text-[var(--color-text)]">Commission History</h1>
            <p className="text-xs text-[var(--color-text-muted)]">Track your earned commissions</p>
          </div>
          <button
            onClick={() => refetch()}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* ── Summary Cards ───────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 p-3 text-white">
            <p className="text-[10px] font-semibold opacity-80 uppercase tracking-wide">Earned</p>
            <p className="text-lg font-extrabold tabular-nums leading-tight mt-0.5">
              {fmtCompactCurrency(kpis.totalEarned)}
            </p>
          </div>
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3">
            <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Pending</p>
            <p className="text-lg font-extrabold text-amber-700 dark:text-amber-300 tabular-nums leading-tight mt-0.5">
              {kpis.pending}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 p-3">
            <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Paid</p>
            <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums leading-tight mt-0.5">
              {kpis.paid}
            </p>
          </div>
        </div>

        {/* ── Search Bar ──────────────────────────────────── */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commissions..."
            className="w-full h-10 pl-9 pr-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] transition-all"
          />
        </div>

        {/* ── Status Filter Chips ─────────────────────────── */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setStatusFilter(f.value)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                statusFilter === f.value
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]'
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>

      {/* ── Commission List ───────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 animate-pulse">
              <div className="h-4 w-24 bg-[var(--color-bg-sunken)] rounded mb-2" />
              <div className="h-3 w-40 bg-[var(--color-bg-sunken)] rounded mb-2" />
              <div className="h-3 w-16 bg-[var(--color-bg-sunken)] rounded" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <DollarSign className="h-10 w-10 text-[var(--color-text-muted)] mb-3" />
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {search || statusFilter ? 'No matching commissions' : 'No Commissions Yet'}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              {search || statusFilter
                ? 'Try adjusting your search or filters.'
                : 'Commissions appear after leads are completed.'}
            </p>
          </div>
        ) : (
          filtered.map((record: CommissionRecord) => {
            const leadName = leadNames[record.leadId] || record.leadId?.slice(0, 10) || '—';
            const amount = record.approvedAmount || record.amount || 0;
            return (
              <button
                key={record.id}
                onClick={() => setViewRecord(record)}
                className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-sm hover:border-[var(--color-border-strong)] transition-all active:scale-[0.98]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-[var(--color-text)] truncate">
                      {leadName}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {record.ruleName || record.ruleType || 'Commission'}
                      {record.systemSizeKW ? ` · ${record.systemSizeKW} kW` : ''}
                    </p>
                  </div>
                  <StatusPill status={record.status} />
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border-subtle)]">
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {fmtDate(record.generatedDate)}
                  </span>
                  <span className="text-sm font-extrabold text-[var(--color-text)] tabular-nums">
                    {fmtCurrency(amount)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ── Commission Detail Drawer ───────────────────────── */}
      <PartnerCommissionDetailDrawer
        record={viewRecord}
        open={!!viewRecord}
        onClose={() => setViewRecord(null)}
      />
    </div>
  );
}

export default PartnerMobileCommissionsWorkspace;
