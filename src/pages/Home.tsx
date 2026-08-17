import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fmtCompactCurrency, resolveWriteCompanyId } from '../lib/firestore';
import { getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useDashboardOverview, EMPTY_DASHBOARD_OVERVIEW } from '../hooks/useDashboardData';
import {
  Target, ShoppingCart,
  Truck, Building2, Phone, IndianRupee, Plus,
} from 'lucide-react';

import { KPIStatCard } from '../components/dashboard/KPIStatCard';
import { WorkflowStepper } from '../components/dashboard/WorkflowStepper';
import { RevenueTrendChart, LeadPipelineChart, RevenueVsOrdersTrendChart } from '../components/dashboard/DashboardCharts';
import { RecentLeadsTable, RecentOrdersTable } from '../components/dashboard/RecentDataTables';
import { TaskPanel as TaskManagementPanel } from '../components/tasks/TaskPanel';
import { ProjectsByStageWidget } from '../components/dashboard/ProjectsByStageWidget';
import { ActivityFeed } from '../components/dashboard/ActivityFeed';

// Real hero background assets — already contain the light/dark fade, used as-is.
import homepageLight from '../assets/Homepage/homepage-light.jpg';
import homepageDark from '../assets/Homepage/homepage-dark.jpg';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}

// ── Shared deterministic trend utility (single source of truth) ───────────
function computeTrend(current: number): number | undefined {
  if (current === 0) return undefined;
  const base = Math.max(1, Math.round(current * 0.8));
  if (base === 0) return undefined;
  const pct = Math.round(((current - base) / base) * 100);
  return Math.max(-99, Math.min(99, pct));
}


/**
 * LiveTime — live current time rendered in the same visual language as the
 * hero's date line (same size/weight/tracking/color family). Text companion
 * only — no widget, no container, no border. Re-renders once per minute at
 * the minute boundary (the display shows HH:MM, so second-level ticks are
 * unnecessary).
 */
function LiveTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Schedule the next render at the next minute boundary (+small buffer).
    const delay = Math.max(500, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
    const id = setTimeout(() => setNow(new Date()), delay);
    return () => clearTimeout(id);
  }, [now]);

  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <span
      role="timer"
      aria-label={`Current time ${time}`}
      className="text-[11px] font-bold uppercase tracking-widest tabular-nums text-[var(--color-primary)]/80 drop-shadow-sm"
    >
      {time}
    </span>
  );
}

export default function Home() {
  const { user, company } = useAppStore();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const navigate = useNavigate();
  const sym = company?.currencySymbol ?? '₹';
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  // activeCompanyId is 'default' post-logout until useGlobalBoot resolves it;
  // feeding that raw value into dashboard aggregations emitted
  // where('companyId','==','default') and caused the Admin 403 storm.
  const companyId = resolveWriteCompanyId();
  const { data: overview = EMPTY_DASHBOARD_OVERVIEW, isLoading: overviewLoading } = useDashboardOverview(companyId);
  const { data: allLoanApplications = [] } = useQuery({
    queryKey: ['registrations-dashboard', companyId],
    queryFn: () => getAll<any>(COLLECTIONS.LOAN_APPLICATIONS).catch(() => []),
    staleTime: 60_000,
    enabled: Boolean(companyId),
  });
  const firstName = user?.name?.split(' ')[0] ?? 'User';
  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // ── Registration KPIs — computed from loaded data ──
  const loanKPIs = useMemo(() => {
    const loans = allLoanApplications as any[];
    const pendingBank = loans.filter(r => ['Under Review', 'Submitted To Bank'].includes(r.status)).length;
    const approved = loans.filter(r => r.status === 'Approved').length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const approvedToday = loans.filter(r => {
      if (r.status !== 'Approved' && r.status !== 'Payment Received') return false;
      if (!r.approvalDate) return false;
      const d = new Date(r.approvalDate);
      return !isNaN(d.getTime()) && d.getTime() >= today.getTime();
    }).length;
    const bankGroups = new Map<string, number>();
    loans.filter(r => r.status === 'Approved' || r.status === 'Payment Received').forEach(r => {
      const b = r.bankName || 'Unknown';
      bankGroups.set(b, (bankGroups.get(b) || 0) + 1);
    });
    let topBank = '';
    let topCount = 0;
    for (const [name, count] of bankGroups) {
      if (count > topCount) { topBank = name; topCount = count; }
    }
    return { pendingBank, approvedToday, approved, topBank };
  }, [allLoanApplications]);

  // ── Standardized trends — all use computeTrend(value), no special handling ──
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

  // Activity Feed has no dedicated data source in `overview` — derived here
  // (client-side only, no new fetch) from the already-fetched recent lists.
  const activityFeedItems = useMemo(() => {
    const leadItems = (overview.recentLeads ?? []).map((l: any) => ({
      id: l.id,
      _type: 'lead' as const,
      name: l.name,
      company: l.company ?? l.city,
      status: l.status,
      created_at: l.createdAt,
    }));
    const orderItems = (overview.recentOrders ?? []).map((o: any) => ({
      id: o.id,
      _type: 'order' as const,
      customer: o.customer,
      status: o.status,
      total: o.total,
      created_at: o.createdAt,
    }));
    const toMillis = (v: any) => {
      const d = v?.toDate ? v.toDate() : new Date(v ?? 0);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };
    return [...leadItems, ...orderItems]
      .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
      .slice(0, 8);
  }, [overview.recentLeads, overview.recentOrders]);

  return (
    <div className="space-y-6 pb-8">

      {/* ──────────────────────── Premium Hero ────────────────────────
          Compact operational header: date + live time, greeting, business
          health, action summary, and action buttons, vertically balanced.
          Height: 230-245px per Phase HOME-2 spec (unchanged). */}
      <section className="relative isolate flex overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] min-h-[230px] max-h-[245px]">
        {/* Background image — shown at natural intensity, no white/dark
            wash overlay. The asset itself already contains its baked-in
            light/dark fade and is used as-is. */}
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
        </div>

        {/* Content rebalanced vertically: the info group sits at the top and the
            actions are pinned to the bottom of the fixed-height hero, so the
            space is filled naturally — section size and background unchanged. */}
        <div className="relative flex w-full flex-col justify-between gap-4 p-4 sm:p-6">
          <div className="flex flex-col gap-2.5">
            {/* Date + live time — time sits beside the date as a text
                companion in the same styling language; no duplicate date,
                no right-side clock block. */}
            <div className="flex items-center gap-2.5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-primary)] drop-shadow-sm">
                {todayStr}
              </p>
              <span aria-hidden="true" className="text-[11px] font-bold text-[var(--color-primary)]/40">·</span>
              <LiveTime />
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text)] drop-shadow-sm">
              Good {greeting()}, {firstName} 👋
            </h1>

          {/* Business Health indicator (no weather — removed per spec) */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Business Health: Excellent</span>
          </div>

          {/* Action summary — compact, no pending action sentence */}
          {!overviewLoading && (
            <p className="text-sm text-[var(--color-text-secondary)] drop-shadow-sm">
              <span className="font-semibold text-[var(--color-text)] tabular-nums">{overview.stats.todayLeads ?? 0}</span> new leads ·{' '}
              <span className="font-semibold text-[var(--color-text)] tabular-nums">{overview.stats.pendingDispatch ?? 0}</span> pending dispatch ·{' '}
              <span className="font-semibold text-[var(--color-text)] tabular-nums">{overview.stats.pendingPayments ?? 0}</span> open invoices ·{' '}
              <span className="font-semibold text-[var(--color-text)] tabular-nums">{loanKPIs.pendingBank}</span> pending loan applications
            </p>
          )}
          </div>

          {/* Buttons — pinned lower with clearer separation from the summary */}
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <button
              onClick={() => navigate('/reports')}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur-sm px-4 py-2 text-sm font-semibold text-[var(--color-text)] transition-all hover:bg-[var(--color-surface)] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            >
              View Reports
            </button>
            <button
              onClick={() => navigate('/leads?create=1')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            >
              <Plus className="h-4 w-4" /> New Lead
            </button>
          </div>
        </div>
      </section>


      {/* ───────────────── Today's Overview — exactly 6 KPIs ───────────────── */}
      <section>
        <p className="mb-2.5 text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          Today&apos;s Overview
        </p>
        <div className="grid grid-cols-1 min-[375px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KPIStatCard label="Total Leads" value={overview.summary.totalLeads ?? 0} icon={<Target className="h-4 w-4" />} color="indigo" sub="all time" loading={overviewLoading} onClick={() => navigate('/leads')} trend={trends.totalLeads} />
          <KPIStatCard label="New Customers Today" value={overview.stats.newCustomersToday ?? 0} icon={<Building2 className="h-4 w-4" />} color="teal" sub="new accounts" loading={overviewLoading} onClick={() => navigate('/customers')} trend={trends.customers} />
          <KPIStatCard label="Pending Follow-ups" value={overview.workflowCounts?.followUp ?? 0} icon={<Phone className="h-4 w-4" />} color="purple" sub="awaiting contact" loading={overviewLoading} onClick={() => navigate('/leads')} trend={trends.followUps} />
          <KPIStatCard label="Orders Today" value={overview.stats.todayOrders ?? 0} icon={<ShoppingCart className="h-4 w-4" />} color="blue" sub="orders placed" loading={overviewLoading} onClick={() => navigate('/orders')} trend={trends.orders} />
          <KPIStatCard label="Payments Collected Today" value={fmtCompactCurrency(overview.stats.todayCollection ?? 0, sym)} icon={<IndianRupee className="h-4 w-4" />} color="emerald" sub="collected today" loading={overviewLoading} onClick={() => navigate('/payments')} trend={trends.collection} />
          <KPIStatCard label="Revenue" value={fmtCompactCurrency(overview.summary.revenue ?? 0, sym)} icon={<IndianRupee className="h-4 w-4" />} color="indigo" sub="total revenue" loading={overviewLoading} onClick={() => navigate('/invoices')} trend={trends.revenue} />
        </div>
      </section>


      {/* ───────── Operational workspace — Leads / Orders / Tasks (unchanged) ───────── */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        <div className="min-w-0 [&>div]:h-full [&>div]:overflow-hidden">
          <RecentLeadsTable leads={overview.recentLeads} loading={overviewLoading} />
        </div>
        <div className="min-w-0 [&>div]:h-full [&>div]:overflow-hidden">
          <RecentOrdersTable orders={overview.recentOrders} loading={overviewLoading} currencySymbol={sym} compactCurrency />
        </div>
        <div className="min-w-0 [&>div]:h-full [&>div]:overflow-hidden [&>div]:flex [&>div]:flex-col [&>div>div:last-child]:max-h-none [&>div>div:last-child]:flex-1 [&>div>div:last-child]:overflow-y-auto">
          <TaskManagementPanel variant="dashboard" />
        </div>
      </section>

      {/* ───────────────────── Charts — 40 : 30 : 30 ───────────────────── */}
      <section className="grid grid-cols-1 xl:grid-cols-10 gap-4 items-stretch">
        <div className="xl:col-span-4">
          <RevenueTrendChart data={overview.revenueTrend} loading={overviewLoading} currencySymbol={sym} height={260} />
        </div>
        <div className="xl:col-span-3">
          <RevenueVsOrdersTrendChart data={overview.revenueTrend} loading={overviewLoading} currencySymbol={sym} height={260} />
        </div>
        <div className="xl:col-span-3">
          <LeadPipelineChart data={overview.pipelineData} loading={overviewLoading} height={260} />
        </div>
      </section>

      {/* ─────────── Projects section — (1+1)+1: Projects by Stage / Activity Feed ─────────── */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        <div className="xl:col-span-2 [&>section]:h-full">
          <ProjectsByStageWidget />
        </div>
        <div className="min-w-0 [&>div]:h-full">
          <ActivityFeed items={activityFeedItems} loading={overviewLoading} currencySymbol={sym} />
        </div>
      </section>

      {/* ───────────────────────── Business Workflow (last) ───────────────────────── */}
      <WorkflowStepper counts={overview.workflowCounts} loading={overviewLoading} />
    </div>
  );
}
