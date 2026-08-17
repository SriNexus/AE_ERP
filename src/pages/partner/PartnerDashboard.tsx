/**
 * PartnerDashboard — Partner Portal Dashboard
 *
 * Landing page after partner login. Shows real data from existing ERP services.
 * Reuses: KPIStatCard, ActivityTimeline, EmptyState, AlertPanel, statusBadge
 * No business logic — consumes existing hooks and services only.
 * All data is filtered by the current partner's ID for data isolation.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Target,
  Users,
  Wallet,
  DollarSign,
  FileText,
  Plus,
  Upload,
  User,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Handshake,
} from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { KPIStatCard } from '../../components/dashboard/KPIStatCard';
import { EmptyState } from '../../components/shared/EmptyState';
import { statusBadge } from '../../components/ui/Badge';
import { useAppStore } from '../../store/useAppStore';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import { COLLECTIONS } from '../../lib/firebase';
import { getAll, fmtCurrency, fmtCompactCurrency, ageDays } from '../../lib/firestore';
import { queryKeys } from '../../lib/queryKeys';
import type { ChannelPartner, CommissionRecord } from '../../features/channel-partner/types';

// ── Lead pipeline stage statuses ─────────────────────────────

const PIPELINE_STAGES = [
  { key: 'status', values: ['New'], label: 'New', color: 'info' as const },
  { key: 'status', values: ['Contacted', 'Follow-up', 'Follow Up'], label: 'Contacted', color: 'purple' as const },
  { key: 'status', values: ['Survey', 'Surveyed', 'Site Survey'], label: 'Survey', color: 'warning' as const },
  { key: 'status', values: ['Proposal', 'Quotation', 'Negotiation'], label: 'Proposal', color: 'teal' as const },
  { key: 'status', values: ['Converted', 'Won'], label: 'Won', color: 'success' as const },
  { key: 'status', values: ['Lost', 'Cancelled'], label: 'Lost', color: 'danger' as const },
];

// ── Partner Alert Card ─────────────────────────────────────────

function PartnerAlertCard({ label, status, detail, count, onClick }: {
  label: string;
  status: 'ok' | 'alert' | 'complete';
  detail?: string;
  count?: number;
  onClick?: () => void;
}) {
  const colors = {
    ok:       { bg: 'bg-emerald-50 dark:bg-emerald-950/40', icon: 'text-emerald-500',   dot: 'bg-emerald-500', border: 'ring-emerald-200 dark:ring-emerald-800/60' },
    alert:    { bg: 'bg-rose-50 dark:bg-rose-950/40',       icon: 'text-rose-500',      dot: 'bg-rose-500',    border: 'ring-rose-200 dark:ring-rose-800/60' },
    complete: { bg: 'bg-blue-50 dark:bg-blue-950/40',       icon: 'text-blue-500',      dot: 'bg-blue-500',    border: 'ring-blue-200 dark:ring-blue-800/60' },
  };
  const c = colors[status];
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg p-3 text-left w-full transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${c.bg} ${c.icon} ${c.border}`}>
        {status === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : status === 'complete' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{label}</p>
        <p className="text-[10px] text-[var(--color-text-muted)]">{detail || (count != null ? `${count} pending` : 'No action needed')}</p>
      </div>
      {count != null && count > 0 && (
        <span className={`text-xs font-bold tabular-nums ${status === 'alert' ? 'text-rose-600' : 'text-emerald-600'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Component ────────────────────────────────────────────────

export default function PartnerDashboard() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  // ── Fetch partner record ───────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Fetch partner leads ────────────────────────────────
  const { data: allLeads = [], isLoading: leadsLoading } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerLeads = useMemo(
    () => allLeads.filter((l: any) => l.partnerId === partner?.id && !l.isDeleted),
    [allLeads, partner?.id],
  );

  // ── Fetch commission records ───────────────────────────
  const { data: allCommissions = [], isLoading: commissionsLoading } = useQuery({
    queryKey: companyKeys.partnersRoot,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerCommissions = useMemo(
    () => allCommissions.filter((c: any) => c.partnerId === partner?.id && !c.isDeleted) as CommissionRecord[],
    [allCommissions, partner?.id],
  );

  // ── Fetch wallet transactions ──────────────────────────
  const { data: allWalletTxns = [] } = useQuery({
    queryKey: companyKeys.partnerWalletTxns,
    queryFn: () => getAll(COLLECTIONS.PARTNER_WALLET_TXNS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerDebits = useMemo(
    () => allWalletTxns.filter((t: any) => t.partnerId === partner?.id && t.amount < 0 && !t.isDeleted),
    [allWalletTxns, partner?.id],
  );

  // ── Compute KPIs ───────────────────────────────────────
  const kpis = useMemo(() => {
    const totalLeads = partnerLeads.length;
    const activeLeads = partnerLeads.filter(
      (l: any) => l.status !== 'Converted' && l.status !== 'Lost' && l.status !== 'Cancelled',
    ).length;
    const convertedLeads = partnerLeads.filter(
      (l: any) => l.status === 'Converted',
    ).length;
    const walletBalance = partner?.walletBalance ?? 0;
    const pendingCommission = partnerCommissions
      .filter((c) => c.status === 'pending')
      .reduce((sum, c) => sum + (c.amount || 0), 0);
    const paidCommission = partnerCommissions
      .filter((c) => c.status === 'paid')
      .reduce((sum, c) => sum + (c.amount || 0), 0);
    const pendingDocs = partnerLeads.filter(
      (l: any) => l.documentationStatus === 'pending' || l.documentationStatus === 'rejected',
    ).length;

    return { totalLeads, activeLeads, convertedLeads, walletBalance, pendingCommission, paidCommission, pendingDocs };
  }, [partnerLeads, partnerCommissions, partner]);

  // ── Lead pipeline counts ───────────────────────────────
  const pipelineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const stage of PIPELINE_STAGES) {
      counts[stage.label] = partnerLeads.filter((l: any) =>
        stage.values.some((v) => l.status?.toLowerCase() === v.toLowerCase()),
      ).length;
    }
    return counts;
  }, [partnerLeads]);

  // ── Commission summary ─────────────────────────────────
  const commissionSummary = useMemo(() => {
    const approved = partnerCommissions.filter((c) => c.status === 'approved');
    const paid = partnerCommissions.filter((c) => c.status === 'paid');
    const pending = partnerCommissions.filter((c) => c.status === 'pending');
    const rejected = partnerCommissions.filter((c) => c.status === 'voided');
    return {
      approved: approved.reduce((s, c) => s + (c.amount || 0), 0),
      paid: paid.reduce((s, c) => s + (c.amount || 0), 0),
      pending: pending.reduce((s, c) => s + (c.amount || 0), 0),
      rejected: rejected.reduce((s, c) => s + (c.amount || 0), 0),
      total: partnerCommissions.reduce((s, c) => s + (c.amount || 0), 0),
    };
  }, [partnerCommissions]);

  // ── Recent leads (5 most recent) ───────────────────────
  const recentLeads = useMemo(
    () =>
      [...partnerLeads]
        .sort((a: any, b: any) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, 5),
    [partnerLeads],
  );

  // ── Alerts ─────────────────────────────────────────────
  const alerts = useMemo(() => {
    const pendingKyc = partner?.kycStatus === 'pending' || partner?.kycStatus === 'not_started';
    const pendingDocs = kpis.pendingDocs > 0;
    const pendingInstallations = partnerLeads.filter(
      (l: any) => l.installationStatus === 'pending',
    ).length;
    const pendingCommissionApproval = partnerCommissions.filter(
      (c) => c.status === 'pending',
    ).length;
    return { pendingKyc, pendingDocs, pendingInstallations, pendingCommissionApproval };
  }, [partner, kpis, partnerLeads, partnerCommissions]);

  // ── Wallet last transaction ────────────────────────────
  const lastTransaction = useMemo(() => {
    if (!partnerLeads.length) return null;
    const withCommissions = partnerCommissions.sort(
      (a, b) => new Date(b.generatedDate || 0).getTime() - new Date(a.generatedDate || 0).getTime(),
    );
    return withCommissions[0] || null;
  }, [partnerCommissions]);

  // ── Loading state ──────────────────────────────────────
  const loading = partnersLoading || leadsLoading || commissionsLoading;

  // ── Error / no partner ─────────────────────────────────
  if (!loading && !partner) {
    return (
      <PageShell
        title="Partner Dashboard"
        subtitle="Your channel partner performance at a glance"
        icon={<LayoutDashboard className="h-5 w-5" />}
      >
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
          <EmptyState
            icon={<Handshake className="h-12 w-12" />}
            title="No Partner Profile Found"
            description="Your user account is not yet linked to a channel partner profile. Contact your administrator to get set up."
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Dashboard"
      subtitle={partner?.firmName || 'Partner Portal'}
      icon={<LayoutDashboard className="h-5 w-5" />}
    >
      {/* ── Welcome Header ──────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
            <Handshake className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[var(--color-text)]">
              Welcome, {partner?.contactPerson || user?.name || 'Partner'}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {partner?.firmName}
              {partner?.gstNumber && ` · GST: ${partner.gstNumber}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(partner?.status || 'active')}
          {partner?.kycStatus === 'verified' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" /> KYC Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" /> KYC {partner?.kycStatus || 'Pending'}
            </span>
          )}
        </div>
      </div>

      {/* ── Row 1: KPI Cards ────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KPIStatCard
          label="Total Leads"
          value={kpis.totalLeads}
          icon={<Target className="h-4 w-4" />}
          color="indigo"
          loading={loading}
          onClick={() => navigate('/partner/leads')}
        />
        <KPIStatCard
          label="Active Leads"
          value={kpis.activeLeads}
          icon={<TrendingUp className="h-4 w-4" />}
          color="blue"
          loading={loading}
        />
        <KPIStatCard
          label="Converted"
          value={kpis.convertedLeads}
          icon={<Users className="h-4 w-4" />}
          color="emerald"
          loading={loading}
        />
        <KPIStatCard
          label="Wallet Balance"
          value={fmtCompactCurrency(kpis.walletBalance)}
          icon={<Wallet className="h-4 w-4" />}
          color="amber"
          loading={loading}
        />
        <KPIStatCard
          label="Comm. Pending"
          value={fmtCompactCurrency(kpis.pendingCommission)}
          icon={<DollarSign className="h-4 w-4" />}
          color="orange"
          loading={loading}
        />
        <KPIStatCard
          label="Comm. Paid"
          value={fmtCompactCurrency(kpis.paidCommission)}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="teal"
          loading={loading}
        />
      </div>

      {/* ── Row 2: Lead Pipeline (WorkflowStepper-style) ── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[var(--color-text)]">Lead Pipeline</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{partnerLeads.length} total leads</p>
          </div>
          <button
            onClick={() => navigate('/partner/leads')}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            View All <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {loading ? (
          <div className="flex gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex-1 animate-pulse space-y-2">
                <div className="h-10 w-10 rounded-xl bg-[var(--color-bg-sunken)]" />
                <div className="h-3 w-12 rounded bg-[var(--color-bg-sunken)]" />
                <div className="h-5 w-8 rounded bg-[var(--color-bg-sunken)]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-start gap-0 overflow-x-auto pb-1">
            {PIPELINE_STAGES.map((stage, idx) => {
              const count = pipelineCounts[stage.label] || 0;
              return (
                <div key={stage.label} className="flex min-w-[90px] flex-1 flex-col items-center gap-1 text-center">
                  <div className={`rounded-xl p-2 ring-1 transition-all duration-200 ${
                    count > 0
                      ? 'bg-indigo-50 text-indigo-600 ring-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-400 dark:ring-indigo-800/60'
                      : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] ring-[var(--color-border)]'
                  }`}>
                    {stage.label === 'New' && <Target className="h-4 w-4" />}
                    {stage.label === 'Contacted' && <Users className="h-4 w-4" />}
                    {stage.label === 'Survey' && <FileText className="h-4 w-4" />}
                    {stage.label === 'Proposal' && <DollarSign className="h-4 w-4" />}
                    {stage.label === 'Won' && <CheckCircle2 className="h-4 w-4" />}
                    {stage.label === 'Lost' && <AlertTriangle className="h-4 w-4" />}
                  </div>
                  <span className="text-[10px] font-semibold text-[var(--color-text-muted)] text-center leading-tight whitespace-nowrap">
                    {stage.label}
                  </span>
                  <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-full ${
                    count > 0
                      ? 'bg-indigo-500 text-white shadow-sm'
                      : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]'
                  }`}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Row 3: Recent Leads + Commission Summary ────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent Leads — 2/3 width on desktop — using DataTable pattern from RecentDataTables */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
              <h3 className="text-sm font-bold text-[var(--color-text)]">Recent Leads</h3>
              <button
                onClick={() => navigate('/partner/leads')}
                className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                View All <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm divide-y divide-[var(--color-border-subtle)]">
                <thead className="bg-[var(--color-bg-sunken)]">
                  <tr>
                    {['Lead', 'Status', 'Installation', 'Commission', 'Age'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                  {loading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          {Array.from({ length: 5 }).map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <div className="h-3 rounded bg-[var(--color-bg-sunken)] w-3/4" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : recentLeads.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-xs text-[var(--color-text-muted)]">
                          No leads yet
                        </td>
                      </tr>
                    )
                    : recentLeads.map((lead: any) => (
                        <tr
                          key={lead.id}
                          onClick={() => navigate(`/partner/leads/${lead.id}`)}
                          className="hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                                {(lead.name ?? '?')[0].toUpperCase()}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-[var(--color-text)] leading-tight">{lead.name}</p>
                                <p className="text-[10px] text-[var(--color-text-muted)]">{lead.city || '—'} · {lead.source || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">{statusBadge(lead.status ?? 'New')}</td>
                          <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                            {lead.installationStatus?.replace(/_/g, ' ') || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-amber-600 font-medium">
                            {lead.commissionStatus || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)] tabular-nums">
                            {lead.createdAt ? `${ageDays(lead.createdAt)}d` : '—'}
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Commission Summary + Wallet — 1/3 width on desktop */}
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 className="mb-3 text-sm font-bold text-[var(--color-text)]">Commission Summary</h3>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-4 animate-pulse rounded bg-[var(--color-bg-sunken)]" />
                ))}
              </div>
            ) : partnerCommissions.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">No commissions yet</p>
            ) : (
              <div className="space-y-2.5">
                {[
                  { label: 'Pending', amount: commissionSummary.pending, color: 'text-amber-600' },
                  { label: 'Approved', amount: commissionSummary.approved, color: 'text-emerald-600' },
                  { label: 'Paid', amount: commissionSummary.paid, color: 'text-teal-600' },
                  { label: 'Rejected', amount: commissionSummary.rejected, color: 'text-rose-600' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">{item.label}</span>
                    <span className={`text-xs font-bold tabular-nums ${item.color}`}>
                      {fmtCurrency(item.amount)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-[var(--color-border-subtle)] pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--color-text)]">Total Earned</span>
                    <span className="text-sm font-bold text-[var(--color-text)] tabular-nums">
                      {fmtCurrency(commissionSummary.total)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 className="mb-3 text-sm font-bold text-[var(--color-text)]">Wallet</h3>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">Current Balance</span>
                <span className="text-sm font-bold text-[var(--color-text)] tabular-nums">
                  {fmtCurrency(kpis.walletBalance)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">Pending Settlement</span>
                <span className="text-xs font-bold text-amber-600 tabular-nums">
                  {fmtCurrency(commissionSummary.approved)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">Recent Credits</span>
                <span className="text-xs font-bold text-emerald-600 tabular-nums">
                  {fmtCurrency(commissionSummary.paid)}
                </span>
              </div>
              {partnerDebits.length > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--color-text-muted)]">Recent Debits</span>
                  <span className="text-xs font-bold text-rose-600 tabular-nums">
                    {fmtCurrency(Math.abs(partnerDebits.reduce((s: number, t: any) => s + (t.amount || 0), 0)))}
                  </span>
                </div>
              ) : null}
              {lastTransaction && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--color-text-muted)]">Last Transaction</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                    {lastTransaction.generatedDate
                      ? new Date(lastTransaction.generatedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                      : '—'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 4: Partner Alerts (inline, partner-relevant labels) ── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className={`h-4 w-4 ${alerts.pendingKyc || alerts.pendingDocs || alerts.pendingInstallations > 0 || alerts.pendingCommissionApproval > 0 ? 'text-amber-500' : 'text-[var(--color-text-disabled)]'}`} />
          <h3 className="text-sm font-bold text-[var(--color-text)]">Attention Needed</h3>
        </div>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <PartnerAlertCard
              label="KYC Verification"
              status={partner?.kycStatus === 'verified' ? 'complete' : alerts.pendingKyc ? 'alert' : 'ok'}
              detail={partner?.kycStatus === 'verified' ? 'Complete' : (partner?.kycStatus || 'Not started')}
              onClick={() => navigate('/partner/profile')}
            />
            <PartnerAlertCard
              label="Pending Documentation"
              status={kpis.pendingDocs > 0 ? 'alert' : 'ok'}
              count={kpis.pendingDocs}
              onClick={() => navigate('/partner/leads')}
            />
            <PartnerAlertCard
              label="Pending Installation"
              status={alerts.pendingInstallations > 0 ? 'alert' : 'ok'}
              count={alerts.pendingInstallations}
              onClick={() => navigate('/partner/leads')}
            />
            <PartnerAlertCard
              label="Comm. Awaiting Approval"
              status={alerts.pendingCommissionApproval > 0 ? 'alert' : 'ok'}
              count={alerts.pendingCommissionApproval}
              onClick={() => navigate('/partner/commissions')}
            />
          </div>
        )}
      </div>

      {/* ── Row 5: Quick Actions + Activity Timeline ────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Quick Actions — 1/3 width */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="mb-4 text-sm font-bold text-[var(--color-text)]">⚡ Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => navigate('/partner/leads/new')}
              className="flex flex-col items-center gap-2 rounded-xl bg-[var(--color-bg-sunken)] p-3 ring-1 ring-[var(--color-border)] transition-all hover:bg-[var(--color-surface-hover)] hover:-translate-y-0.5 hover:shadow-sm"
            >
              <div className="text-[var(--color-primary)]"><Plus className="h-5 w-5" /></div>
              <span className="text-[10px] font-bold text-center text-[var(--color-primary-text)]">Create Lead</span>
            </button>
            <button
              onClick={() => navigate('/partner/wallet')}
              className="flex flex-col items-center gap-2 rounded-xl bg-[var(--color-bg-sunken)] p-3 ring-1 ring-[var(--color-border)] transition-all hover:bg-[var(--color-surface-hover)] hover:-translate-y-0.5 hover:shadow-sm"
            >
              <div className="text-amber-600"><Wallet className="h-5 w-5" /></div>
              <span className="text-[10px] font-bold text-center text-amber-700 dark:text-amber-300">View Wallet</span>
            </button>
            <button
              onClick={() => navigate('/partner/documents')}
              className="flex flex-col items-center gap-2 rounded-xl bg-[var(--color-bg-sunken)] p-3 ring-1 ring-[var(--color-border)] transition-all hover:bg-[var(--color-surface-hover)] hover:-translate-y-0.5 hover:shadow-sm"
            >
              <div className="text-emerald-600"><Upload className="h-5 w-5" /></div>
              <span className="text-[10px] font-bold text-center text-emerald-700 dark:text-emerald-300">Upload Docs</span>
            </button>
            <button
              onClick={() => navigate('/partner/profile')}
              className="flex flex-col items-center gap-2 rounded-xl bg-[var(--color-bg-sunken)] p-3 ring-1 ring-[var(--color-border)] transition-all hover:bg-[var(--color-surface-hover)] hover:-translate-y-0.5 hover:shadow-sm"
            >
              <div className="text-purple-600"><User className="h-5 w-5" /></div>
              <span className="text-[10px] font-bold text-center text-purple-700 dark:text-purple-300">View Profile</span>
            </button>
          </div>
        </div>

        {/* Activity Timeline — 2/3 width */}
        {/* TODO: Enhance ActivityTimeline component to support partner-scoped queries by
        accepting a `partnerId` prop that filters audit_logs by matching the partner's lead
        IDs or metadata.partnerId. The current component supports only mode='entity' (single
        entityId) or mode='global' (all company activities). mode='global' would leak other
        partners' data, so it's intentionally not used here. Once the component is enhanced,
        replace this placeholder with:
          <ActivityTimeline
            companyId={...}
            mode="global"
            limit={15}
            title="Recent Activity"
          />
        */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 className="mb-3 text-sm font-bold text-[var(--color-text)]">Recent Activity</h3>
            <div className="space-y-3">
              <EmptyState
                compact
                icon={<Clock className="h-8 w-8" />}
                title="No recent activity"
                description="Updates from your leads, commissions, and documents will appear here."
              />
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
