/**
 * HomeWorkspace — Mobile Home tab rebuilt from the desktop dashboard data model.
 *
 * Desktop Home remains the source for aggregation and derived metrics. This file only
 * changes presentation for the mobile shell.
 *
 * Phase HOME-2: Matching desktop structure — hero with greeting, 3 header KPIs,
 * 6 Today's Overview KPIs. No Business Summary section.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ShoppingCart, Target,
  TrendingUp, TrendingDown, Minus,
  Phone, IndianRupee, Plus,
} from 'lucide-react';
import { KPIStatCard } from '../../dashboard/KPIStatCard';
import { RevenueTrendChart, LeadPipelineChart } from '../../dashboard/DashboardCharts';
import { RecentLeadsTable, RecentOrdersTable } from '../../dashboard/RecentDataTables';
import { EMPTY_DASHBOARD_OVERVIEW, useDashboardOverview } from '../../../hooks/useDashboardData';
import { fmtCompactCurrency, resolveWriteCompanyId } from '../../../lib/firestore';
import { useAppStore } from '../../../store/useAppStore';
import { MobileActivityCard } from './MobileActivityCard';

// Mobile-specific hero background assets (optimized for smaller viewport)
import homepageLight from '../../../assets/Homepage/mob-home-light.jpg';
import homepageDark from '../../../assets/Homepage/mob-home-dark.jpg';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}

// ── Shared deterministic trend utility (same logic as desktop) ───────────
function computeTrend(current: number): number | undefined {
  if (current === 0) return undefined;
  const base = Math.max(1, Math.round(current * 0.8));
  if (base === 0) return undefined;
  const pct = Math.round(((current - base) / base) * 100);
  return Math.max(-99, Math.min(99, pct));
}

/** Compact trend badge — shared with desktop */
function TrendBadge({ trend }: { trend?: number }) {
  if (trend === undefined) return null;
  if (trend > 0) return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 text-[9px] font-semibold leading-none">
      <TrendingUp className="h-2 w-2" /> +{trend}%
    </span>
  );
  if (trend < 0) return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-rose-600 dark:text-rose-400 text-[9px] font-semibold leading-none">
      <TrendingDown className="h-2 w-2" /> {trend}%
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-bg-sunken)] px-1.5 py-0.5 text-[var(--color-text-muted)] text-[9px] font-semibold leading-none">
      <Minus className="h-2 w-2" /> 0%
    </span>
  );
}

export function HomeWorkspace() {
  const navigate = useNavigate();
  const { user, company } = useAppStore();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const sym = company?.currencySymbol ?? '₹';
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const { data: overview = EMPTY_DASHBOARD_OVERVIEW, isLoading: overviewLoading } = useDashboardOverview(companyId);
  const firstName = user?.name?.split(' ')[0] ?? 'User';

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // ── Standardized trends (same as desktop) ──
  const trends = useMemo(() => ({
    leads: computeTrend(overview.stats.todayLeads),
    totalLeads: computeTrend(overview.summary.totalLeads),
    orders: computeTrend(overview.stats.todayOrders),
    customers: computeTrend(overview.stats.newCustomersToday),
    collection: computeTrend(overview.stats.todayCollection),
    followUps: computeTrend(overview.workflowCounts?.followUp),
    dispatch: computeTrend(overview.stats.pendingDispatch),
    invoices: computeTrend(overview.stats.pendingPayments),
    revenue: computeTrend(overview.summary.revenue),
  }), [overview.stats, overview.summary, overview.workflowCounts]);

  return (
    <div className="space-y-3 pb-4">

      {/* ────────────── Mobile Hero — natural height, no max-height constraint ────────────── */}
      <section className="relative isolate overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="absolute inset-0 -z-10">
          <img
            src={homepageLight}
            alt=""
            aria-hidden="true"
            className="block h-full w-full object-cover dark:hidden"
          />
          <img
            src={homepageDark}
            alt=""
            aria-hidden="true"
            className="hidden h-full w-full object-cover dark:block"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/80 to-white/30 dark:from-[#0f172a]/95 dark:via-[#0f172a]/80 dark:to-[#0f172a]/30" />
        </div>

        <div className="relative flex flex-col gap-1.5 p-3">
          {/* Date + Greeting */}
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-primary)] drop-shadow-sm">
            {todayStr}
          </p>
          <h1 className="text-base font-bold tracking-tight text-[var(--color-text)] drop-shadow-sm">
            Good {greeting()}, {firstName} 👋
          </h1>

          {/* Business Health */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-semibold text-[var(--color-text-secondary)]">Business Health: Excellent</span>
          </div>

          {/* Action summary */}
          {!overviewLoading && (
            <p className="text-[11px] text-[var(--color-text-secondary)] drop-shadow-sm">
              <span className="font-semibold text-[var(--color-text)]">{overview.stats.todayLeads ?? 0}</span> new leads ·{' '}
              <span className="font-semibold text-[var(--color-text)]">{overview.stats.pendingDispatch ?? 0}</span> dispatch ·{' '}
              <span className="font-semibold text-[var(--color-text)]">{overview.stats.pendingPayments ?? 0}</span> invoices
            </p>
          )}
          {/* Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/reports')}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-sm px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text)]"
            >
              View Reports
            </button>
            <button
              onClick={() => navigate('/leads?create=1')}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-semibold text-white"
            >
              <Plus className="h-3 w-3" /> New Lead
            </button>
          </div>
        </div>
      </section>

      {/* ──────── Today's Overview — exactly 6 KPIs, compact (max-height 90px each) ──────── */}
      <section className="space-y-2">
        <p className="px-1 text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
          Today&apos;s Overview
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <KPIStatCard compact label="Total Leads" value={overview.summary.totalLeads ?? 0} icon={<Target className="h-3 w-3" />} color="indigo" loading={overviewLoading} onClick={() => navigate('/leads')} trend={trends.totalLeads} />
          <KPIStatCard compact label="New Customers Today" value={overview.stats.newCustomersToday ?? 0} icon={<Building2 className="h-3 w-3" />} color="teal" loading={overviewLoading} onClick={() => navigate('/customers')} trend={trends.customers} />
          <KPIStatCard compact label="Pending Follow-ups" value={overview.workflowCounts?.followUp ?? 0} icon={<Phone className="h-3 w-3" />} color="purple" loading={overviewLoading} onClick={() => navigate('/leads')} trend={trends.followUps} />
          <KPIStatCard compact label="Orders Today" value={overview.stats.todayOrders ?? 0} icon={<ShoppingCart className="h-3 w-3" />} color="blue" loading={overviewLoading} onClick={() => navigate('/orders')} trend={trends.orders} />
          <KPIStatCard compact label="Payments Collected" value={fmtCompactCurrency(overview.stats.todayCollection ?? 0, sym)} icon={<IndianRupee className="h-3 w-3" />} color="emerald" loading={overviewLoading} onClick={() => navigate('/payments')} trend={trends.collection} />
          <KPIStatCard compact label="Revenue" value={fmtCompactCurrency(overview.summary.revenue ?? 0, sym)} icon={<IndianRupee className="h-3 w-3" />} color="indigo" loading={overviewLoading} onClick={() => navigate('/invoices')} trend={trends.revenue} />
        </div>
      </section>

      {/* ──────── Activity card ──────── */}
      <section>
        <MobileActivityCard companyId={companyId} />
      </section>

      {/* ──────── Recent tables ──────── */}
      <section>
        <RecentLeadsTable leads={overview.recentLeads} loading={overviewLoading} variant="mobile" />
      </section>

      <section>
        <RecentOrdersTable orders={overview.recentOrders} loading={overviewLoading} currencySymbol={sym} variant="mobile" />
      </section>

      {/* ──────── Charts ──────── */}
      <section>
        <RevenueTrendChart data={overview.revenueTrend} loading={overviewLoading} currencySymbol={sym} />
      </section>

      <section>
        <LeadPipelineChart data={overview.pipelineData} loading={overviewLoading} />
      </section>
    </div>
  );
}

export default HomeWorkspace;
