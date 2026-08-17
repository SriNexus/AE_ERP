/**
 * CaseReports — Case Reports page
 *
 * Phase 3I — Case Reports
 * Route: /cases/reports
 *
 * 7 Report Categories:
 *   1. Executive     — Volume KPIs + health summary
 *   2. Operational   — Pending operational stages
 *   3. Financial     — Revenue, business metrics
 *   4. Lifecycle     — Transition duration averages
 *   5. Stage         — 17-stage distribution
 *   6. Health        — Validation metrics
 *   7. Business      — B2B + B2C breakdown
 *
 * Features:
 *   - Report selector (tabs)
 *   - Date range picker + Company/Branch filter
 *   - Export (CSV + PDF/Print)
 *   - Charts using recharts
 *   - Report preview table
 *   - READ-ONLY
 */

import { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { cn } from '../utils/cn';
import { PageHeader, Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { KPIStatCard } from '../components/dashboard/KPIStatCard';
import { Button } from '../components/ui/Button';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  AreaChart, Area,
} from 'recharts';
import {
  BarChart3, TrendingUp, Activity, CheckCircle2,
  XCircle, Clock, Users, Building2,
  CreditCard, Download, Printer, FileText,
  FolderKanban, Zap, PiggyBank, Handshake,
  Headphones, Wrench,
} from 'lucide-react';
import {
  generateCaseReportData,
  exportCaseReportToCsv,
  exportCaseReportToPdf,
} from '../features/cases/utils/caseReports';
import type { CaseReportData, ReportSection } from '../features/cases/utils/caseReports';

// ── Constants ────────────────────────────────────────────

const REPORT_SECTIONS: Array<{ id: ReportSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'executive', label: 'Executive', icon: BarChart3 },
  { id: 'operational', label: 'Operational', icon: Wrench },
  { id: 'financial', label: 'Financial', icon: CreditCard },
  { id: 'lifecycle', label: 'Lifecycle', icon: Clock },
  { id: 'stage', label: 'Stage', icon: FolderKanban },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'business', label: 'Business', icon: Building2 },
];

const TOOLTIP_STYLE = {
  borderRadius: '8px', border: '1px solid var(--color-border)',
  fontSize: 11, background: 'var(--color-surface)',
};

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

// ── Component ────────────────────────────────────────────

export default function CaseReports() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  const [activeSection, setActiveSection] = useState<ReportSection>('executive');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');

  // ── Data queries ──────────────────────────────────────
  const casesQ = useQuery({ queryKey: ['cases', activeCompanyId, 'reports'], queryFn: () => getAll<any>(COLLECTIONS.CASES), staleTime: 60_000 });
  const leadsQ = useQuery({ queryKey: qkeys.leadsAll, queryFn: () => getAll<any>(COLLECTIONS.LEADS), staleTime: 60_000 });
  const customersQ = useQuery({ queryKey: qkeys.customersAll, queryFn: () => getAll<any>(COLLECTIONS.CUSTOMERS), staleTime: 60_000 });
  const projectsQ = useQuery({ queryKey: qkeys.projectsRoot, queryFn: () => getAll<any>(COLLECTIONS.PROJECTS), staleTime: 60_000 });
  const ordersQ = useQuery({ queryKey: qkeys.ordersAll, queryFn: () => getAll<any>(COLLECTIONS.ORDERS), staleTime: 60_000 });
  const installationsQ = useQuery({ queryKey: ['installations', activeCompanyId, 'reports'], queryFn: () => getAll<any>('installations'), staleTime: 60_000 });
  const commissioningQ = useQuery({ queryKey: ['commissioning', activeCompanyId, 'reports'], queryFn: () => getAll<any>(COLLECTIONS.COMMISSIONING_RECORDS), staleTime: 60_000 });

  const allCases = (casesQ.data as any[]) || [];
  const allLeads = (leadsQ.data as any[]) || [];
  const allCustomers = (customersQ.data as any[]) || [];
  const allProjects = (projectsQ.data as any[]) || [];
  const allOrders = (ordersQ.data as any[]) || [];
  const allInstallations = (installationsQ.data as any[]) || [];
  const allCommissioning = (commissioningQ.data as any[]) || [];
  const loading = casesQ.isLoading;

  // ── Generate report data ──────────────────────────────
  const [data, setData] = useState<CaseReportData | null>(null);
  const [generating, setGenerating] = useState(false);

  const generateReport = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await generateCaseReportData(
        allCases, allLeads, allCustomers, allProjects, allOrders,
        allInstallations, allCommissioning,
        { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, company: companyFilter || undefined },
      );
      setData(result);
    } catch {
      setData(null);
    } finally {
      setGenerating(false);
    }
  }, [allCases, allLeads, allCustomers, allProjects, allOrders, allInstallations, allCommissioning, dateFrom, dateTo, companyFilter]);

  // Auto-generate once when all data has loaded
  useEffect(() => { if (!loading && allCases.length > 0 && !data && !generating) generateReport(); }, [loading, allCases.length]);

  // ── Export handlers ───────────────────────────────────
  const handleCsvExport = useCallback(() => {
    if (!data) return;
    const date = new Date().toISOString().split('T')[0];
    exportCaseReportToCsv(activeSection, data, `case-report-${activeSection}-${date}.csv`);
  }, [data, activeSection]);

  const handlePdfExport = useCallback(() => {
    if (!data) return;
    exportCaseReportToPdf(activeSection, data);
  }, [data, activeSection]);

  // ── Loading ───────────────────────────────────────────
  if (loading || generating) {
    return (
      <div className="space-y-5 animate-fadeIn">
        <PageHeader title="Case Reports" icon={<FileText className="h-5 w-5" />} />
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-[var(--color-bg-sunken)] p-1">
          {REPORT_SECTIONS.map((s) => (
            <div key={s.id} className="h-8 w-24 bg-[var(--color-bg)] rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn pb-8">
      <PageHeader
        title="Case Reports"
        subtitle="Generate and export case reports across 7 categories"
        icon={<FileText className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleCsvExport} disabled={!data}>
              CSV
            </Button>
            <Button variant="outline" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={handlePdfExport} disabled={!data}>
              PDF / Print
            </Button>
            <Button variant="primary" size="sm" icon={<BarChart3 className="h-3.5 w-3.5" />} onClick={generateReport} disabled={generating}>
              {generating ? 'Gen...' : 'Generate'}
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40" />
          <span className="text-xs text-[var(--color-text-muted)]">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40" />
        </div>
        <input type="text" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}
          placeholder="Company ID" className="px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] w-32 focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40" />
        {data && <span className="text-xs text-[var(--color-text-muted)]">Generated: {new Date(data.generatedAt).toLocaleTimeString()}</span>}
      </div>

      {/* Report tabs */}
      <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[var(--color-bg-sunken)] p-1 [scrollbar-width:none]">
        {REPORT_SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={cn(
                'shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-all',
                activeSection === s.id
                  ? 'bg-[var(--color-surface)] text-[var(--color-primary-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
              )}>
              <Icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Report content */}
      {!data ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">Click Generate to build the report</p>
        </div>
      ) : activeSection === 'executive' ? <ExecutiveReport data={data} /> :
        activeSection === 'operational' ? <OperationalReport data={data} /> :
        activeSection === 'financial' ? <FinancialReport data={data} /> :
        activeSection === 'lifecycle' ? <LifecycleReport data={data} /> :
        activeSection === 'stage' ? <StageReport data={data} /> :
        activeSection === 'health' ? <HealthReportView data={data} /> :
        <BusinessReport data={data} />}
    </div>
  );
}

// ── Calendar icon helper ─────────────────────────────────

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// ── Section report components ────────────────────────────

function ExecutiveReport({ data }: { data: CaseReportData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        <KPIStatCard label="Total Cases" value={data.volume.totalCases} icon={<FolderKanban className="h-4 w-4" />} color="indigo" compact />
        <KPIStatCard label="Active" value={data.volume.activeCases} icon={<Activity className="h-4 w-4" />} color="blue" compact />
        <KPIStatCard label="Completed" value={data.volume.completedCases} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" compact />
        <KPIStatCard label="Failed" value={data.volume.failedCases} icon={<XCircle className="h-4 w-4" />} color="rose" compact />
        <KPIStatCard label="Growth" value={`${data.volume.growthPercent}%`} icon={<TrendingUp className="h-4 w-4" />} color={data.volume.growthPercent >= 0 ? 'emerald' : 'rose'} compact />
        <KPIStatCard label="Avg Lifecycle" value={`${data.lifecycle.avgEndToEnd}d`} icon={<Clock className="h-4 w-4" />} color="purple" compact />
        <KPIStatCard label="Healthy" value={data.health.healthyCases} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" compact />
      </div>

      <Card>
        <CardHeader><CardTitle>Health Summary</CardTitle></CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <MetricCard label="Healthy" value={data.health.healthyCases} color="emerald" />
            <MetricCard label="Broken" value={data.health.brokenCases} color="red" />
            <MetricCard label="Orphans" value={data.health.orphanRecords} color="rose" />
            <MetricCard label="Duplicates" value={data.health.duplicateCases} color="amber" />
            <MetricCard label="Broken Chains" value={data.health.brokenChains} color="purple" />
            <MetricCard label="Checked" value={data.health.totalChecked} color="blue" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Monthly Trend</CardTitle></CardHeader>
        <CardBody>
          {data.performance.byMonth.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.performance.byMonth}>
                <defs><linearGradient id="execGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="count" stroke="#6366f1" fill="url(#execGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No trend data</p>}
        </CardBody>
      </Card>
    </div>
  );
}

function OperationalReport({ data }: { data: CaseReportData }) {
  const items = [
    { label: 'Pending Installation', value: data.operational.pendingInstallations, icon: Wrench, color: 'amber' },
    { label: 'Pending QC', value: data.operational.pendingQC, icon: Activity, color: 'orange' },
    { label: 'Pending Commissioning', value: data.operational.pendingCommissioning, icon: Zap, color: 'blue' },
    { label: 'Pending Subsidy', value: data.operational.pendingSubsidy, icon: PiggyBank, color: 'purple' },
    { label: 'Pending Handover', value: data.operational.pendingHandover, icon: Handshake, color: 'teal' },
    { label: 'Pending Service', value: data.operational.pendingServiceTickets, icon: Headphones, color: 'rose' },
  ];

  return (
    <Card>
      <CardHeader><CardTitle>Pending Operational Stages</CardTitle></CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {items.map((item) => (
            <MetricCard key={item.label} label={item.label} value={item.value} color={item.color as any} />
          ))}
        </div>
        {data.performance.byEmployee.length > 0 && (
          <>
            <h3 className="text-xs font-bold text-[var(--color-text-muted)] uppercase mt-6 mb-3">Top Employees</h3>
            <div className="space-y-1.5">
              {data.performance.byEmployee.slice(0, 5).map((emp, i) => {
                const maxC = data.performance.byEmployee[0]?.count || 1;
                return (
                  <div key={emp.employeeId} className="flex items-center gap-3 text-xs">
                    <span className="w-4 text-right text-[var(--color-text-muted)]">{i + 1}</span>
                    <span className="w-24 truncate text-[var(--color-text-secondary)]">{emp.name}</span>
                    <div className="flex-1 bg-[var(--color-bg-sunken)] rounded-full h-4 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${Math.max((emp.count / maxC) * 100, 2)}%` }} />
                    </div>
                    <span className="w-6 text-right font-bold tabular-nums text-[var(--color-text-secondary)]">{emp.count}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function FinancialReport({ data }: { data: CaseReportData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="B2B Revenue/Case" value={`₹${data.business.b2b.revenuePerCase}`} color="emerald" />
        <MetricCard label="Avg System Size" value={`${data.business.b2b.avgProjectSizeKw} kW`} color="blue" />
        <MetricCard label="Subsidy Rate" value={`${data.business.b2c.subsidyCompletionRate}%`} color="purple" />
        <MetricCard label="Net Metering Rate" value={`${data.business.b2c.netMeteringCompletionRate}%`} color="teal" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader><CardTitle>Cases by Month</CardTitle></CardHeader>
          <CardBody>
            {data.performance.byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.performance.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No data</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cases by Lead Source</CardTitle></CardHeader>
          <CardBody>
            {data.performance.byLeadSource.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data.performance.byLeadSource.map(d => ({ name: d.source, value: d.count }))} cx="50%" cy="45%" outerRadius={70} innerRadius={40} dataKey="value" paddingAngle={3} strokeWidth={0}>
                    {data.performance.byLeadSource.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No data</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function LifecycleReport({ data }: { data: CaseReportData }) {
  const items = [
    { label: 'Lead → Customer', value: data.lifecycle.avgLeadToCustomer },
    { label: 'Customer → Project', value: data.lifecycle.avgCustomerToProject },
    { label: 'Project → Installation', value: data.lifecycle.avgProjectToInstallation },
    { label: 'Install → Commissioning', value: data.lifecycle.avgInstallationToCommissioning },
  ];

  const chartData = items.map((item) => ({ name: item.label, days: item.value }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {items.map((item) => (
          <MetricCard key={item.label} label={item.label} value={`${item.value}d`} color="indigo" />
        ))}
        <MetricCard label="Avg End-to-End" value={`${data.lifecycle.avgEndToEnd}d`} color="purple" />
        <MetricCard label="Fastest Case" value={`${data.lifecycle.fastestCaseDays}d`} color="emerald" />
      </div>

      <Card>
        <CardHeader><CardTitle>Lifecycle Durations (Days)</CardTitle></CardHeader>
        <CardBody>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 100, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="days" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No lifecycle data</p>}
        </CardBody>
      </Card>
    </div>
  );
}

function StageReport({ data }: { data: CaseReportData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>17-Stage EPC Distribution</CardTitle>
        <span className="text-xs text-[var(--color-text-muted)]">{data.stageDistribution.total} cases</span>
      </CardHeader>
      <CardBody>
        {data.stageDistribution.stages.length > 0 ? (
          <div className="space-y-1">
            {data.stageDistribution.stages.map((s, i) => (
              <div key={s.stage} className="flex items-center gap-3 text-xs">
                <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color || COLORS[i % COLORS.length] }} />
                <span className="w-28 font-medium text-[var(--color-text-secondary)] truncate">{s.stage}</span>
                <div className="flex-1 bg-[var(--color-bg-sunken)] rounded-full h-5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(s.percentage, s.count > 0 ? 2 : 0)}%`, backgroundColor: s.color || COLORS[i % COLORS.length] }} />
                </div>
                <span className="w-8 text-right font-bold tabular-nums text-[var(--color-text-secondary)]">{s.count}</span>
                <span className="w-8 text-right text-[var(--color-text-muted)]">{s.percentage}%</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No stage data</p>}
      </CardBody>
    </Card>
  );
}

function HealthReportView({ data }: { data: CaseReportData }) {
  return (
    <Card>
      <CardHeader><CardTitle>Case Health Metrics</CardTitle></CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricCard label="Healthy" value={data.health.healthyCases} color="emerald" />
          <MetricCard label="Broken" value={data.health.brokenCases} color="red" />
          <MetricCard label="Checked" value={data.health.totalChecked} color="blue" />
          <MetricCard label="Validations Failed" value={data.health.validationFailures} color="amber" />
          <MetricCard label="Duplicates" value={data.health.duplicateCases} color="rose" />
          <MetricCard label="Orphans" value={data.health.orphanRecords} color="purple" />
          <MetricCard label="Broken Chains" value={data.health.brokenChains} color="amber" />
        </div>
      </CardBody>
    </Card>
  );
}

function BusinessReport({ data }: { data: CaseReportData }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-500" /> B2C — Residential
            </div>
          </CardTitle>
          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">PM Surya Ghar</span>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Total Cases" value={data.business.b2c.totalCases} color="teal" />
            <MetricCard label="Subsidy Rate" value={`${data.business.b2c.subsidyCompletionRate}%`} color="purple" />
            <MetricCard label="Net Metering" value={`${data.business.b2c.netMeteringCompletionRate}%`} color="blue" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-indigo-500" /> B2B — Commercial & Industrial
            </div>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Commercial" value={data.business.b2b.commercialCases} color="indigo" />
            <MetricCard label="Industrial" value={data.business.b2b.industrialCases} color="purple" />
            <MetricCard label="Avg System Size" value={`${data.business.b2b.avgProjectSizeKw} kW`} color="blue" />
            <MetricCard label="Revenue/Case" value={`₹${data.business.b2b.revenuePerCase}`} color="emerald" />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ── MetricCard helper ────────────────────────────────────

function MetricCard({ label, value, color = 'indigo' }: { label: string; value: string | number; color?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
    blue: 'text-blue-600 dark:text-blue-400',
    indigo: 'text-indigo-600 dark:text-indigo-400',
    purple: 'text-purple-600 dark:text-purple-400',
    teal: 'text-teal-600 dark:text-teal-400',
    rose: 'text-rose-600 dark:text-rose-400',
    orange: 'text-orange-600 dark:text-orange-400',
  };
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold', colorMap[color] || 'text-[var(--color-text)]')}>{value}</p>
    </div>
  );
}
