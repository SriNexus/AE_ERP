/**
 * CaseAnalytics — Case Analytics Dashboard
 *
 * Phase 3G — Case Analytics
 * Route: /cases/analytics
 *
 * 7 Analytics Categories:
 *   A. Volume Metrics        — 8 KPI cards
 *   B. Lifecycle Metrics     — 7 lifecycle KPI cards
 *   C. Stage Distribution    — 17-stage funnel chart + distribution table
 *   D. Health Metrics        — 7 health KPI cards
 *   E. Business Metrics      — B2C PM Surya Ghar + B2B Commercial/Industrial
 *   F. Performance Metrics   — Monthly trend, source, employee breakdown
 *   G. Operational Metrics   — Pending operational stage counts
 *
 * READ-ONLY: No Firestore writes.
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAll,
} from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { cn } from '../utils/cn';
import { PageHeader, Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { KPIStatCard } from '../components/dashboard/KPIStatCard';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  AreaChart, Area,
} from 'recharts';
import {
  BarChart3, TrendingUp, Activity, CheckCircle2, AlertTriangle,
  XCircle, Clock, Target, Users, Building2,
  CreditCard, Zap, Gauge, PiggyBank, Handshake, Shield,
  Headphones, Loader2, FolderKanban, Hash,
  Calendar, Ban, Wrench,
} from 'lucide-react';
import {
  getCaseVolumeMetrics,
  getCaseLifecycleMetrics,
  getCaseStageDistribution,
  getCaseHealthMetrics,
  getCaseBusinessMetrics,
  getCasePerformanceMetrics,
  getCaseOperationalMetrics,
} from '../features/cases/utils/caseAnalytics';
import type {
  VolumeMetrics,
  LifecycleMetrics,
  StageDistribution,
  HealthMetrics,
  BusinessMetrics,
  PerformanceMetrics,
  OperationalMetrics,
} from '../features/cases/utils/caseAnalytics';

// ── Chart Tooltip style ──────────────────────────────────

const TOOLTIP_STYLE = {
  borderRadius: '8px',
  border: '1px solid var(--color-border)',
  fontSize: 11,
  background: 'var(--color-surface)',
};

// ── Chart colors ─────────────────────────────────────────

const COLORS_7 = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];
const COLORS_17 = [
  '#6366f1', '#8b5cf6', '#3b82f6', '#0ea5e9', '#06b6d4', '#10b981', '#22c55e',
  '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7',
  '#9333ea', '#14b8a6', '#64748b',
];

// ── Skeleton ─────────────────────────────────────────────

function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" style={{ height }} />
  );
}

// ── Metric stat card for health/business sections ─────────

function MetricStat({ label, value, icon: Icon, color = 'indigo' }: {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  color?: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
    blue: 'text-blue-600 dark:text-blue-400',
    indigo: 'text-indigo-600 dark:text-indigo-400',
    purple: 'text-purple-600 dark:text-purple-400',
    teal: 'text-teal-600 dark:text-teal-400',
    rose: 'text-rose-600 dark:text-rose-400',
  };
  const bgMap: Record<string, string> = {
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20',
    amber: 'bg-amber-50 dark:bg-amber-900/20',
    red: 'bg-red-50 dark:bg-red-900/20',
    blue: 'bg-blue-50 dark:bg-blue-900/20',
    indigo: 'bg-indigo-50 dark:bg-indigo-900/20',
    purple: 'bg-purple-50 dark:bg-purple-900/20',
    teal: 'bg-teal-50 dark:bg-teal-900/20',
    rose: 'bg-rose-50 dark:bg-rose-900/20',
  };

  return (
    <div className={cn('rounded-xl border border-[var(--color-border-subtle)] px-3 py-2.5', bgMap[color] || '')}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className={cn('h-3.5 w-3.5', colorMap[color] || 'text-[var(--color-text-muted)]')} />}
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      </div>
      <p className={cn('mt-0.5 text-lg font-bold', colorMap[color] || 'text-[var(--color-text)]')}>
        {value}
      </p>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────

export default function CaseAnalytics() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ──────────────────────────────────────
  const casesQuery = useQuery({
    queryKey: ['cases', activeCompanyId, 'analytics'],
    queryFn: () => getAll<any>(COLLECTIONS.CASES),
    staleTime: 60_000,
  });

  const leadsQuery = useQuery({
    queryKey: qkeys.leadsAll,
    queryFn: () => getAll<any>(COLLECTIONS.LEADS),
    staleTime: 60_000,
  });

  const customersQuery = useQuery({
    queryKey: qkeys.customersAll,
    queryFn: () => getAll<any>(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  const projectsQuery = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const ordersQuery = useQuery({
    queryKey: qkeys.ordersRoot,
    queryFn: () => getAll<any>(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });

  const installationsQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'analytics-installations'],
    queryFn: () => getAll<any>('installations'),
    staleTime: 60_000,
  });

  const commissioningQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'analytics-commissioning'],
    queryFn: () => getAll<any>(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 60_000,
  });

  const allCases = (casesQuery.data as any[]) || [];
  const allLeads = (leadsQuery.data as any[]) || [];
  const allCustomers = (customersQuery.data as any[]) || [];
  const allProjects = (projectsQuery.data as any[]) || [];
  const allOrders = (ordersQuery.data as any[]) || [];
  const allInstallations = (installationsQuery.data as any[]) || [];
  const allCommissioning = (commissioningQuery.data as any[]) || [];
  const isLoading = casesQuery.isLoading;

  // ── Computed analytics ─────────────────────────────────
  const volume = useMemo(() => {
    try { return getCaseVolumeMetrics(allCases); }
    catch { return null; }
  }, [allCases]);

  const lifecycle = useMemo(() => {
    try {
      return getCaseLifecycleMetrics(allCases, allLeads, allCustomers, allProjects, allInstallations, allCommissioning);
    } catch { return null; }
  }, [allCases, allLeads, allCustomers, allProjects, allInstallations, allCommissioning]);

  const stageDistribution = useMemo(() => {
    try { return getCaseStageDistribution(allCases); }
    catch { return null; }
  }, [allCases]);

  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const result = await getCaseHealthMetrics();
      setHealth(result);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => { loadHealth(); }, [loadHealth]);

  const business = useMemo(() => {
    try { return getCaseBusinessMetrics(allCases, allCustomers, allProjects, allOrders); }
    catch { return null; }
  }, [allCases, allCustomers, allProjects, allOrders]);

  const performance = useMemo(() => {
    try { return getCasePerformanceMetrics(allCases, allLeads); }
    catch { return null; }
  }, [allCases, allLeads]);

  const operational = useMemo(() => {
    try { return getCaseOperationalMetrics(allCases); }
    catch { return null; }
  }, [allCases]);

  // ── Loading state ──────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-5 animate-fadeIn">
        <PageHeader title="Case Analytics" icon={<BarChart3 className="h-5 w-5" />} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-28 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
          ))}
        </div>
        <ChartSkeleton height={300} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-8">
      {/* Page Header */}
      <PageHeader
        title="Case Analytics"
        subtitle="Complete analytics layer for Case Management — READ-ONLY"
        icon={<BarChart3 className="h-5 w-5" />}
      />

      {/* ── A. VOLUME METRICS ───────────────────────────── */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" /> Volume Metrics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <KPIStatCard label="Total Cases" value={volume?.totalCases ?? 0} icon={<FolderKanban className="h-4 w-4" />} color="indigo" compact />
          <KPIStatCard label="Active" value={volume?.activeCases ?? 0} icon={<Activity className="h-4 w-4" />} color="blue" compact />
          <KPIStatCard label="Completed" value={volume?.completedCases ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" compact />
          <KPIStatCard label="Failed" value={volume?.failedCases ?? 0} icon={<XCircle className="h-4 w-4" />} color="rose" compact />
          <KPIStatCard label="Cancelled" value={volume?.cancelledCases ?? 0} icon={<Ban className="h-4 w-4" />} color="rose" compact />
          <KPIStatCard label="Today" value={volume?.createdToday ?? 0} icon={<Calendar className="h-4 w-4" />} color="purple" compact />
          <KPIStatCard label="This Month" value={volume?.createdThisMonth ?? 0} icon={<Calendar className="h-4 w-4" />} color="teal" compact />
          <KPIStatCard label={`Growth ${volume && volume.growthPercent >= 0 ? '↑' : '↓'}`} value={volume ? `${Math.abs(volume.growthPercent)}%` : '0%'} icon={<TrendingUp className="h-4 w-4" />} color={volume && volume.growthPercent >= 0 ? 'emerald' : 'rose'} compact />
        </div>
      </section>

      {/* ── B. LIFECYCLE METRICS ────────────────────────── */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" /> Lifecycle Metrics (avg days)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricStat label="Lead → Customer" value={lifecycle ? `${lifecycle.avgLeadToCustomer}d` : '—'} icon={Users} color="indigo" />
          <MetricStat label="Customer → Project" value={lifecycle ? `${lifecycle.avgCustomerToProject}d` : '—'} icon={Building2} color="blue" />
          <MetricStat label="Project → Installation" value={lifecycle ? `${lifecycle.avgProjectToInstallation}d` : '—'} icon={Wrench} color="teal" />
          <MetricStat label="Install → Commission" value={lifecycle ? `${lifecycle.avgInstallationToCommissioning}d` : '—'} icon={Zap} color="purple" />
          <MetricStat label="End-to-End" value={lifecycle ? `${lifecycle.avgEndToEnd}d` : '—'} icon={Clock} color="emerald" />
          <MetricStat label="Fastest" value={lifecycle && lifecycle.fastestCaseDays > 0 ? `${lifecycle.fastestCaseDays}d` : '—'} icon={TrendingUp} color="emerald" />
          <MetricStat label="Slowest" value={lifecycle && lifecycle.slowestCaseDays > 0 ? `${lifecycle.slowestCaseDays}d` : '—'} icon={AlertTriangle} color="rose" />
        </div>
        {lifecycle?.fastestCaseId && (
          <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
            Fastest: <span className="font-mono">{lifecycle.fastestCaseId}</span>
            {' · '}Slowest: <span className="font-mono">{lifecycle.slowestCaseId}</span>
          </p>
        )}
      </section>

      {/* ── C. STAGE DISTRIBUTION ────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-[var(--color-primary)]" />
              17-Stage EPC Funnel
            </div>
          </CardTitle>
          <span className="text-xs text-[var(--color-text-muted)]">
            Total: <strong className="text-[var(--color-text-secondary)]">{stageDistribution?.total ?? 0}</strong>
          </span>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Funnel bar chart */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-text-muted)] mb-3">Stage Distribution</h4>
              {stageDistribution ? (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart
                    data={stageDistribution.stages}
                    layout="vertical"
                    margin={{ top: 0, right: 20, left: 80, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={90}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(_value: any, _name: any, props: any) => {
                        const pct = props?.payload?.percentage ?? 0;
                        const stage = props?.payload?.stage ?? 'Stage';
                        return [`${_value} (${pct}%)`, stage];
                      }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {stageDistribution.stages.map((entry, i) => (
                        <Cell key={entry.stage} fill={entry.color || COLORS_17[i % COLORS_17.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartSkeleton height={400} />
              )}
            </div>

            {/* Distribution table */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-text-muted)] mb-3">Completion Table</h4>
              <div className="max-h-[400px] overflow-y-auto space-y-1">
                {stageDistribution?.stages.map((item, i) => (
                  <div key={item.stage} className="flex items-center gap-3 text-xs">
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.color || COLORS_17[i % COLORS_17.length] }}
                    />
                    <span className="w-28 font-medium text-[var(--color-text-secondary)] truncate">{item.stage}</span>
                    <div className="flex-1 bg-[var(--color-bg-sunken)] rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(item.percentage, item.count > 0 ? 2 : 0)}%`,
                          backgroundColor: item.color || COLORS_17[i % COLORS_17.length],
                        }}
                      />
                    </div>
                    <span className="w-10 text-right font-bold text-[var(--color-text-secondary)] tabular-nums">{item.count}</span>
                    <span className="w-8 text-right text-[var(--color-text-muted)]">{item.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── D. HEALTH METRICS ────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--color-primary)]" />
              Health Metrics
            </div>
          </CardTitle>
          <button
            type="button"
            onClick={loadHealth}
            disabled={healthLoading}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-subtle)] transition-colors disabled:opacity-50"
          >
            <Loader2 className={cn('h-3 w-3', healthLoading && 'animate-spin')} />
            {healthLoading ? 'Loading...' : 'Refresh'}
          </button>
        </CardHeader>
        <CardBody>
          {health ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <MetricStat label="Healthy" value={health.healthyCases} icon={CheckCircle2} color="emerald" />
              <MetricStat label="Broken" value={health.brokenCases} icon={XCircle} color="red" />
              <MetricStat label="Checked" value={health.totalChecked} icon={Activity} color="blue" />
              <MetricStat label="Validation Fail" value={health.validationFailures} icon={AlertTriangle} color="amber" />
              <MetricStat label="Duplicates" value={health.duplicateCases} icon={Hash} color="rose" />
              <MetricStat label="Orphans" value={health.orphanRecords} icon={Ban} color="purple" />
              <MetricStat label="Broken Chains" value={health.brokenChains} icon={Wrench} color="amber" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <BarChart3 className="h-8 w-8 text-[var(--color-text-disabled)] mb-2" />
              <p className="text-sm text-[var(--color-text-muted)]">Health report not available</p>
              <button
                type="button"
                onClick={loadHealth}
                className="mt-2 text-xs text-[var(--color-primary)] hover:underline"
              >
                Generate report
              </button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── E. BUSINESS METRICS ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* B2C */}
        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-500" />
                B2C — Residential
              </div>
            </CardTitle>
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">PM Surya Ghar</span>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <MetricStat label="Total B2C Cases" value={business?.b2c.totalCases ?? 0} icon={Users} color="teal" />
              <MetricStat label="PM Surya Ghar" value={business?.b2c.pmSuryaGharCases ?? 0} icon={Building2} color="emerald" />
              <MetricStat label="Subsidy Rate" value={business ? `${business.b2c.subsidyCompletionRate}%` : '—'} icon={PiggyBank} color="purple" />
              <MetricStat label="Net Metering Rate" value={business ? `${business.b2c.netMeteringCompletionRate}%` : '—'} icon={Gauge} color="blue" />
            </div>
          </CardBody>
        </Card>

        {/* B2B */}
        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-indigo-500" />
                B2B — Commercial & Industrial
              </div>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <MetricStat label="Commercial Cases" value={business?.b2b.commercialCases ?? 0} icon={Building2} color="indigo" />
              <MetricStat label="Industrial Cases" value={business?.b2b.industrialCases ?? 0} icon={Building2} color="purple" />
              <MetricStat label="Avg Project Size" value={business ? `${business.b2b.avgProjectSizeKw} kW` : '—'} icon={Zap} color="blue" />
              <MetricStat label="Revenue / Case" value={business ? `₹${business.b2b.revenuePerCase.toLocaleString('en-IN')}` : '—'} icon={CreditCard} color="emerald" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── F. PERFORMANCE METRICS ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Cases by Month */}
        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[var(--color-primary)]" />
                Cases by Month
              </div>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {performance?.byMonth && performance.byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={performance.byMonth}>
                  <defs>
                    <linearGradient id="monthGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="count" stroke="#6366f1" fill="url(#monthGrad)" strokeWidth={2} name="Cases" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No monthly data</p>
            )}
          </CardBody>
        </Card>

        {/* Cases by Lead Source */}
        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[var(--color-primary)]" />
                Cases by Lead Source
              </div>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {performance?.byLeadSource && performance.byLeadSource.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={performance.byLeadSource.map(d => ({ name: d.source, value: d.count }))}
                    cx="50%" cy="45%" outerRadius={78} innerRadius={46}
                    dataKey="value" paddingAngle={3} strokeWidth={0}
                  >
                    {performance.byLeadSource.map((_, i) => (
                      <Cell key={i} fill={COLORS_7[i % COLORS_7.length]} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No source data</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* By Employee */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--color-primary)]" />
              Cases by Employee (Top 10)
            </div>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {performance?.byEmployee && performance.byEmployee.length > 0 ? (
            <div className="space-y-1.5">
              {performance.byEmployee.map((emp, i) => {
                const maxCount = performance.byEmployee[0]?.count || 1;
                const pct = Math.round((emp.count / maxCount) * 100);
                return (
                  <div key={emp.employeeId} className="flex items-center gap-3 text-xs">
                    <span className="w-6 text-right text-[var(--color-text-muted)] font-mono">{i + 1}</span>
                    <span className="w-32 truncate font-medium text-[var(--color-text-secondary)]">{emp.name}</span>
                    <div className="flex-1 bg-[var(--color-bg-sunken)] rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-bold text-[var(--color-text-secondary)] tabular-nums">{emp.count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No employee data</p>
          )}
        </CardBody>
      </Card>

      {/* ── G. OPERATIONAL METRICS ───────────────────────── */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5" /> Operational Metrics — Pending Stages
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricStat label="Pending Installation" value={operational?.pendingInstallations ?? 0} icon={Wrench} color="amber" />
          <MetricStat label="Pending QC" value={operational?.pendingQC ?? 0} icon={Activity} color="orange" />
          <MetricStat label="Pending Commissioning" value={operational?.pendingCommissioning ?? 0} icon={Zap} color="blue" />
          <MetricStat label="Pending Subsidy" value={operational?.pendingSubsidy ?? 0} icon={PiggyBank} color="purple" />
          <MetricStat label="Pending Handover" value={operational?.pendingHandover ?? 0} icon={Handshake} color="teal" />
          <MetricStat label="Pending Service" value={operational?.pendingServiceTickets ?? 0} icon={Headphones} color="rose" />
        </div>
      </section>
    </div>
  );
}
