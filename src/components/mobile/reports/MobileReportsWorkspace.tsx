/**
 * MobileReportsWorkspace — Mobile version of the Reports & Analytics page.
 *
 * Reuses ALL existing data fetching (useQuery + getAll + COLLECTIONS),
 * ALL existing calculations (inline useMemo/IIFEs), and recharts from
 * src/pages/Reports.tsx. Zero duplicated business logic.
 *
 * Desktop reports page remains completely untouched.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll, fmtCurrency, fmtDate } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import {
  BarChart3, TrendingUp, Users, Package, CreditCard,
  Handshake, DollarSign, Clock, AlertTriangle, CheckCircle2,
  Target, Award, BarChart as BarChartIcon,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  AreaChart, Area,
} from 'recharts';
import { COMMISSION_STATUS_LABELS, INSTALLATION_STATUS_LABELS } from '../../../features/channel-partner/types/leadIntegration';
import { computePartnerScore, buildPartnerScoreInput, gradePartner, scoreDistribution } from '../../../features/channel-partner/utils/analytics';
import { TIER_LABELS } from '../../../lib/tierRules';
import type { PartnerTier } from '../../../features/channel-partner/types';
import { cn } from '../../../utils/cn';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

/* ── Helpers ──────────────────────────────────────────────────────────── */

function KpiCard({ label, value, icon, colorClass, compact }: {
  label: string; value: string | number; icon: React.ReactNode;
  colorClass: string; compact?: boolean;
}) {
  return (
    <div className={cn(
      'bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]',
      compact ? 'p-2.5' : 'p-3',
    )}>
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg shrink-0 ${colorClass}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide truncate">
            {label}
          </p>
          <p className="text-sm font-bold text-[var(--color-text)] tabular-nums truncate">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, defaultOpen }: {
  title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen !== false);
  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <div>
          <h3 className="text-xs font-bold text-[var(--color-text)]">{title}</h3>
          {subtitle && <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-[var(--color-text-muted)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function FullPageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="h-7 w-7 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────── */

export default function MobileReportsWorkspace() {
  const { company } = useAppStore();

  // ── All data queries (same as desktop Reports.tsx) ────────────────────
  const { data: leads = [], isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ['leads'], queryFn: () => getAll(COLLECTIONS.LEADS), staleTime: 60000,
  });
  const { data: orders = [], isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ['orders'], queryFn: () => getAll(COLLECTIONS.ORDERS), staleTime: 60000,
  });
  const { data: customers = [], isLoading: customersLoading, isError: customersError } = useQuery({
    queryKey: ['customers'], queryFn: () => getAll(COLLECTIONS.CUSTOMERS), staleTime: 60000,
  });
  const { data: payments = [], isLoading: paymentsLoading, isError: paymentsError } = useQuery({
    queryKey: ['payments'], queryFn: () => getAll(COLLECTIONS.PAYMENTS), staleTime: 60000,
  });
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'], queryFn: () => getAll(COLLECTIONS.EMPLOYEES), staleTime: 60000,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ['channel_partners'], queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS), staleTime: 60000,
  });
  const { data: commissionRecords = [] } = useQuery({
    queryKey: ['commission_records'], queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS), staleTime: 60000,
  });
  const { data: walletTxns = [] } = useQuery({
    queryKey: ['partner_wallet_transactions'], queryFn: () => getAll(COLLECTIONS.PARTNER_WALLET_TXNS), staleTime: 60000,
  });
  const { data: commissionRules = [] } = useQuery({
    queryKey: ['commission_rules'], queryFn: () => getAll(COLLECTIONS.COMMISSION_RULES), staleTime: 60000,
  });

  const isLoading = leadsLoading || ordersLoading || customersLoading || paymentsLoading;
  const hasError = leadsError || ordersError || customersError || paymentsError;

  if (isLoading) return <FullPageLoader />;
  if (hasError) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
        <div className="sticky top-0 z-10 bg-[var(--color-bg-canvas)] px-3 pt-3 pb-2 border-b border-[var(--color-border-subtle)]">
          <h1 className="text-sm font-bold text-[var(--color-text)]">Reports & Analytics</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <AlertTriangle className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load reports</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[280px]">
            Could not load report data. Check your connection and permissions, then try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-[var(--color-primary-text)] rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  /* ── Computed values (same patterns as desktop Reports.tsx) ──────────── */

  const totalRevenue = useMemo(() =>
    orders.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0),
    [orders]);

  const totalPayments = useMemo(() =>
    payments.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0),
    [payments]);

  // 12-month revenue
  const monthly12 = useMemo(() => {
    const m: Record<string, { revenue: number; orders: number }> = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      m[k] = { revenue: 0, orders: 0 };
    }
    orders.forEach((o: any) => {
      if (!o.createdAt) return;
      const k = new Date(o.createdAt).toLocaleString('default', { month: 'short', year: '2-digit' });
      if (m[k]) { m[k].orders++; m[k].revenue += Number(o.total) || 0; }
    });
    return Object.entries(m).map(([month, v]) => ({ month, ...v }));
  }, [orders]);

  // Lead sources
  const sourceData = useMemo(() =>
    Object.entries(leads.reduce((a: Record<string, number>, l: any) => {
      const s = l.source || 'Other';
      a[s] = (a[s] || 0) + 1;
      return a;
    }, {})).map(([name, value]) => ({ name, value })),
    [leads]);

  // Customer types
  const custType = useMemo(() => [
    { name: 'B2B', value: customers.filter((c: any) => c.type === 'B2B').length },
    { name: 'B2C', value: customers.filter((c: any) => c.type === 'B2C' || !c.type).length },
  ], [customers]);

  // Payment modes
  const paymentModes = useMemo(() =>
    Object.entries(payments.reduce((a: Record<string, number>, p: any) => {
      const m = p.mode || 'Other';
      a[m] = (a[m] || 0) + (Number(p.amount) || 0);
      return a;
    }, {})).map(([name, value]) => ({ name, value })),
    [payments]);

  // Top products
  const topProducts = useMemo(() => {
    const productOrders: Record<string, number> = {};
    orders.forEach((o: any) => (o.items || []).forEach((it: any) => {
      if (it.product) productOrders[it.product] = (productOrders[it.product] || 0) + (Number(it.qty) || 0);
    }));
    return Object.entries(productOrders).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 8).map(([name, qty]) => ({ name, qty }));
  }, [orders]);

  // Commission rules stats
  const activeRules = commissionRules.filter((r: any) => r.isActive && !r.isArchived).length;
  const rulesByType = useMemo(() =>
    Object.entries(commissionRules.reduce((a: Record<string, number>, r: any) => {
      const t = r.type || 'unknown';
      a[t] = (a[t] || 0) + 1;
      return a;
    }, {})).map(([name, value]) => ({ name, value })),
    [commissionRules]);
  const avgCommissionPct = useMemo(() => {
    const pctRules = commissionRules.filter((r: any) => r.type === 'percentage' && r.defaultValue > 0);
    if (!pctRules.length) return 0;
    return pctRules.reduce((s: number, r: any) => s + (r.defaultValue || 0), 0) / pctRules.length;
  }, [commissionRules]);

  // Partner performance
  const partnerPerformance = useMemo(() => {
    const active = partners.filter((p: any) => p.status === 'active' && !p.isDeleted);
    const pLeads = leads.filter((l: any) => l.partnerId && !l.isDeleted);
    const settlements = walletTxns.filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted);
    return active.map((p: any) => {
      const pleads = pLeads.filter((l: any) => l.partnerId === p.id);
      const won = pleads.filter((l: any) => l.status === 'Converted' || l.status === 'Won').length;
      const convRate = pleads.length > 0 ? won / pleads.length : 0;
      const revenue = pleads.reduce((sum: number, l: any) => sum + (Number(l.value) || 0), 0);
      const score = computePartnerScore(buildPartnerScoreInput(p.id, pLeads, settlements, commissionRecords));
      return { ...p, leads: pleads.length, won, convRate: Math.round(convRate * 100), revenue, score: Math.round(score.numeric) };
    }).sort((a: any, b: any) => b.score - a.score);
  }, [partners, leads, walletTxns, commissionRecords]);

  // Partner lead & commission KPIs
  const partnerLeads = leads.filter((l: any) => l.partnerId && !l.isDeleted);
  const partnerLeadByStatus = useMemo(() =>
    Object.entries(partnerLeads.reduce((a: Record<string, number>, l: any) => {
      const s = l.commissionStatus || 'pending';
      a[s] = (a[s] || 0) + 1;
      return a;
    }, {})).map(([name, value]) => ({ name: COMMISSION_STATUS_LABELS[name as keyof typeof COMMISSION_STATUS_LABELS] || name, value })),
    [partnerLeads]);
  const installByStatus = useMemo(() =>
    Object.entries(partnerLeads.reduce((a: Record<string, number>, l: any) => {
      const s = l.installationStatus || 'pending';
      a[s] = (a[s] || 0) + 1;
      return a;
    }, {})).map(([name, value]) => ({ name: INSTALLATION_STATUS_LABELS[name as keyof typeof INSTALLATION_STATUS_LABELS] || name, value })),
    [partnerLeads]);
  const commissionValue = commissionRecords.reduce((s: number, r: any) => s + (r.approvedAmount || r.amount || 0), 0);
  const pendingCommissions = commissionRecords.filter((r: any) => r.status === 'pending').length;
  const totalPartnerLeads = partnerLeads.length;
  const completedInstallations = partnerLeads.filter((l: any) =>
    l.installationStatus === 'installation_complete' || l.installationStatus === 'closed'
  ).length;

  // Settlement stats
  const settlements = walletTxns.filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted);
  const totalSettled = settlements.reduce((s: number, t: any) => t.status === 'completed' ? s + (t.totalAmount || 0) : s, 0);
  const pendingSettlementAmount = settlements.reduce((s: number, t: any) => t.status === 'pending' ? s + (t.totalAmount || 0) : s, 0);
  const allWithdrawals = walletTxns.filter((t: any) => t.type === 'withdrawal_request' && !t.isDeleted);
  const totalWithdrawn = allWithdrawals.reduce((s: number, t: any) => t.withdrawalStatus === 'paid' ? s + Math.abs(t.amount || 0) : s, 0);
  const pendingWithdrawalAmount = allWithdrawals.reduce((s: number, t: any) => t.withdrawalStatus === 'pending' ? s + Math.abs(t.amount || 0) : s, 0);

  // Tier distribution
  const tierDistribution = useMemo(() =>
    (['bronze', 'silver', 'gold', 'platinum'] as PartnerTier[]).map((tier) => ({
      name: TIER_LABELS[tier],
      value: partners.filter((p: any) => (p.tier || 'bronze') === tier).length,
    })),
    [partners]);

  // Score distribution
  const partnerScoreDist = useMemo(() => {
    const scores = partnerPerformance.map((p: any) => ({ grade: gradePartner(p.score) }));
    const dist = scoreDistribution(scores.map(s => ({ numeric: 0, score: s.grade })));
    return dist.map(d => ({ name: d.grade, value: d.count }));
  }, [partnerPerformance]);

  const hasCommissionData = commissionRules.length > 0;
  const hasPartnerData = partnerPerformance.length > 0;
  const hasSettlementData = settlements.length > 0;
  const hasPieData = sourceData.length > 0 || custType.some(c => c.value > 0) || paymentModes.length > 0;
  const showPartnerLeadData = partnerLeads.length > 0 || commissionRecords.length > 0;

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg-canvas)] px-3 pt-3 pb-2 border-b border-[var(--color-border-subtle)]">
        <h1 className="text-sm font-bold text-[var(--color-text)]">Reports & Analytics</h1>
        <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Key business metrics at a glance</p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6 space-y-3 pt-3">
        {/* ── Summary KPIs ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2" data-tour="reports-kpi">
          <KpiCard label="Total Revenue" value={fmtCurrency(totalRevenue, company.currencySymbol)}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            colorClass="text-purple-600 bg-purple-50 dark:bg-purple-950/40" />
          <KpiCard label="Payments Rcvd" value={fmtCurrency(totalPayments, company.currencySymbol)}
            icon={<CreditCard className="h-3.5 w-3.5" />}
            colorClass="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
          <KpiCard label="Total Leads" value={leads.length}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            colorClass="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" />
          <KpiCard label="Customers" value={customers.length}
            icon={<Users className="h-3.5 w-3.5" />}
            colorClass="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
          <KpiCard label="Orders" value={orders.length}
            icon={<Package className="h-3.5 w-3.5" />}
            colorClass="text-amber-600 bg-amber-50 dark:bg-amber-950/40" />
          <KpiCard label="Employees" value={employees.length}
            icon={<Users className="h-3.5 w-3.5" />}
            colorClass="text-teal-600 bg-teal-50 dark:bg-teal-950/40" />
        </div>

        {/* ── Revenue Trend ────────────────────────────────────────────── */}
        <div data-tour="reports-revenue">
          <ChartCard title="12-Month Revenue Trend" subtitle="Monthly revenue from orders">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={monthly12}>
              <defs>
                <linearGradient id="mobRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={{ fontSize: 10, borderRadius: '8px', border: '1px solid #e5e7eb' }} />
              <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="url(#mobRev)" strokeWidth={2} name="Revenue" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        </div>

        {/* ── Pie Charts Grid (Lead Sources, Customer Types, Payment Modes) ─ */}
        {hasPieData && (
          <div className="grid grid-cols-1 gap-3">
            {sourceData.length > 0 && (
              <ChartCard title="Lead Sources">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={sourceData} cx="50%" cy="45%" outerRadius={60} innerRadius={30} dataKey="value" paddingAngle={3}>
                      {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 9 }} />
                    <Tooltip contentStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            <div className="grid grid-cols-2 gap-3">
              {custType.some(c => c.value > 0) && (
                <ChartCard title="Customer Types">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={custType} cx="50%" cy="45%" outerRadius={50} innerRadius={25} dataKey="value" paddingAngle={3}>
                        {custType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 9 }} />
                      <Tooltip contentStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
              {paymentModes.length > 0 && (
                <ChartCard title="Payment Modes">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={paymentModes} cx="50%" cy="45%" outerRadius={50} innerRadius={25} dataKey="value" paddingAngle={3}>
                        {paymentModes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 9 }} />
                      <Tooltip contentStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
            </div>
          </div>
        )}

        {/* ── Top Products ─────────────────────────────────────────────── */}
        {topProducts.length > 0 && (
          <ChartCard title="Top Products by Units Sold">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={100} />
                <Tooltip contentStyle={{ fontSize: 10 }} />
                <Bar dataKey="qty" fill="#6366f1" radius={[0, 3, 3, 0]} name="Units Sold" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* ── Commission Rules Section ─────────────────────────────────── */}
        {hasCommissionData && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <KpiCard label="Total Rules" value={commissionRules.length}
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                colorClass="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" compact />
              <KpiCard label="Active Rules" value={activeRules}
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                colorClass="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" compact />
              <KpiCard label="Avg Commission" value={`${avgCommissionPct.toFixed(1)}%`}
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                colorClass="text-purple-600 bg-purple-50 dark:bg-purple-950/40" compact />
              <KpiCard label="Types Used" value={rulesByType.length}
                icon={<BarChartIcon className="h-3.5 w-3.5" />}
                colorClass="text-teal-600 bg-teal-50 dark:bg-teal-950/40" compact />
            </div>
            {rulesByType.length > 0 && (
              <ChartCard title="Rules by Type">
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie data={rulesByType} cx="50%" cy="45%" outerRadius={55} innerRadius={28} dataKey="value" paddingAngle={3}>
                      {rulesByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 9 }} />
                    <Tooltip contentStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </>
        )}

        {/* ── Partner Performance Leaderboard ──────────────────────────── */}
        {hasPartnerData && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <KpiCard label="Active Partners" value={partnerPerformance.length}
                icon={<Users className="h-3.5 w-3.5" />}
                colorClass="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" compact />
              <KpiCard label="Top Score" value={`${partnerPerformance[0]?.score || 0} pts`}
                icon={<Award className="h-3.5 w-3.5" />}
                colorClass="text-amber-600 bg-amber-50 dark:bg-amber-950/40" compact />
              <KpiCard label="Avg Revenue" value={fmtCurrency(
                partnerPerformance.reduce((s: number, p: any) => s + p.revenue, 0) / Math.max(partnerPerformance.length, 1),
                company.currencySymbol,
              )}
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                colorClass="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" compact />
              <KpiCard label="Avg Conv" value={`${Math.round(
                partnerPerformance.reduce((s: number, p: any) => s + p.convRate, 0) / Math.max(partnerPerformance.length, 1),
              )}%`}
                icon={<Target className="h-3.5 w-3.5" />}
                colorClass="text-purple-600 bg-purple-50 dark:bg-purple-950/40" compact />
            </div>

            {/* Leaderboard (Top 5) */}
            <ChartCard title="Partner Leaderboard" subtitle="Top 5 by performance score" defaultOpen={false}>
              <div className="space-y-1">
                {partnerPerformance.slice(0, 5).map((p: any, i: number) => (
                  <div key={p.id} className="flex items-center gap-2.5 py-2 border-b border-[var(--color-border-subtle)] last:border-0">
                    <span className={cn(
                      'inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold shrink-0',
                      i === 0 ? 'bg-yellow-100 text-yellow-700' :
                      i === 1 ? 'bg-gray-100 text-gray-600' :
                      i === 2 ? 'bg-orange-100 text-orange-700' :
                      'bg-indigo-100 text-indigo-700',
                    )}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--color-text)] truncate">
                        {p.firmName || '—'}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        {p.leads} leads · {p.convRate}% conv
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-[var(--color-text)]">{p.score}</p>
                      <p className="text-[9px] text-[var(--color-text-muted)]">pts</p>
                    </div>
                  </div>
                ))}
              </div>
            </ChartCard>

            {/* Score Distribution */}
            {partnerScoreDist.length > 0 && (
              <ChartCard title="Partner Score Distribution">
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie data={partnerScoreDist} cx="50%" cy="45%" outerRadius={55} innerRadius={28} dataKey="value" paddingAngle={3}>
                      {partnerScoreDist.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 9 }} />
                    <Tooltip contentStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {/* Tier Distribution */}
            {tierDistribution.some(t => t.value > 0) && (
              <ChartCard title="Partner Tier Distribution">
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {(['bronze', 'silver', 'gold', 'platinum'] as PartnerTier[]).map((tier) => {
                    const count = partners.filter((p: any) => (p.tier || 'bronze') === tier).length;
                    const colorMap: Record<string, string> = {
                      bronze: 'text-amber-600', silver: 'text-gray-600', gold: 'text-yellow-600', platinum: 'text-indigo-600',
                    };
                    return (
                      <div key={tier} className="text-center p-2 bg-[var(--color-bg-sunken)] rounded-lg">
                        <p className={`text-[10px] font-semibold ${colorMap[tier] || 'text-gray-600'}`}>{TIER_LABELS[tier]}</p>
                        <p className="text-base font-bold mt-0.5">{count}</p>
                      </div>
                    );
                  })}
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={
                    (['bronze', 'silver', 'gold', 'platinum'] as PartnerTier[]).map((tier) => ({
                      name: TIER_LABELS[tier],
                      count: partners.filter((p: any) => (p.tier || 'bronze') === tier).length,
                    }))
                  }>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 10 }} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {(['bronze', 'silver', 'gold', 'platinum'] as PartnerTier[]).map((tier, i) => {
                        const barColors: Record<string, string> = { bronze: '#d97706', silver: '#6b7280', gold: '#eab308', platinum: '#6366f1' };
                        return <Cell key={i} fill={barColors[tier] || '#6366f1'} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </>
        )}

        {/* ── Settlement & Wallet Section ──────────────────────────────── */}
        {hasSettlementData && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <KpiCard label="Total Settled" value={fmtCurrency(totalSettled, '₹')}
                icon={<CreditCard className="h-3.5 w-3.5" />}
                colorClass="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" compact />
              <KpiCard label="Pending Settlement" value={fmtCurrency(pendingSettlementAmount, '₹')}
                icon={<Clock className="h-3.5 w-3.5" />}
                colorClass="text-amber-600 bg-amber-50 dark:bg-amber-950/40" compact />
              <KpiCard label="Total Withdrawn" value={fmtCurrency(totalWithdrawn, '₹')}
                icon={<DollarSign className="h-3.5 w-3.5" />}
                colorClass="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" compact />
              <KpiCard label="Pending Withdrawals" value={fmtCurrency(pendingWithdrawalAmount, '₹')}
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                colorClass="text-rose-600 bg-rose-50 dark:bg-rose-950/40" compact />
            </div>

            {/* Settlement Monthly Trend */}
            <ChartCard title="Settlement Trend (Monthly)" defaultOpen={false}>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={
                  Object.entries(settlements.filter((t: any) => t.status === 'completed').reduce((m: Record<string, number>, t: any) => {
                    if (!t.completedAt) return m;
                    const k = new Date(t.completedAt).toLocaleString('default', { month: 'short', year: '2-digit' });
                    m[k] = (m[k] || 0) + (t.totalAmount || 0);
                    return m;
                  }, {})).map(([month, amount]) => ({ month, amount }))
                }>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={{ fontSize: 10, borderRadius: '8px' }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Amount']} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[3, 3, 0, 0]} name="Settled Amount" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Export Actions (same as desktop Reports.tsx) */}
            <ChartCard title="Export Reports" defaultOpen={false}>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    import('../../../lib/settlementExport').then(m => {
                      m.downloadCsv(m.exportSettlementsToCsv(settlements, {}), 'settlements-export.csv');
                    });
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-left transition-colors"
                >
                  <BarChart3 className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                  <span>Export Settlements as CSV</span>
                </button>
                <button
                  onClick={() => {
                    import('../../../lib/settlementExport').then(m => {
                      const withdrawals = (walletTxns as any[]).filter((t: any) => t.type === 'withdrawal_request' && !t.isDeleted);
                      m.downloadCsv(m.exportWithdrawalsToCsv(withdrawals, {}), 'withdrawals-export.csv');
                    });
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-left transition-colors"
                >
                  <DollarSign className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  <span>Export Withdrawals as CSV</span>
                </button>
                <button
                  onClick={() => {
                    import('../../../lib/settlementExport').then(m => {
                      m.printReport('Settlement Report', m.generatePartnerStatementHtml({ firmName: 'All Partners' }, settlements, commissionRecords, walletTxns));
                    });
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-left transition-colors"
                >
                  <BarChart3 className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                  <span>Generate Printable Report</span>
                </button>
              </div>
            </ChartCard>
          </>
        )}

        {/* ── Partner Lead & Commission KPIs ───────────────────────────── */}
        {showPartnerLeadData && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <KpiCard label="Partner Leads" value={totalPartnerLeads}
                icon={<Handshake className="h-3.5 w-3.5" />}
                colorClass="text-amber-600 bg-amber-50 dark:bg-amber-950/40" compact />
              <KpiCard label="Completed Installs" value={completedInstallations}
                icon={<Package className="h-3.5 w-3.5" />}
                colorClass="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" compact />
              <KpiCard label="Pending Comms." value={pendingCommissions}
                icon={<CreditCard className="h-3.5 w-3.5" />}
                colorClass="text-amber-600 bg-amber-50 dark:bg-amber-950/40" compact />
              <KpiCard label="Commission Value" value={fmtCurrency(commissionValue, '₹')}
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                colorClass="text-purple-600 bg-purple-50 dark:bg-purple-950/40" compact />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {partnerLeadByStatus.length > 0 && (
                <ChartCard title="Commission Status">
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={partnerLeadByStatus} cx="50%" cy="45%" outerRadius={45} innerRadius={22} dataKey="value" paddingAngle={3}>
                        {partnerLeadByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
              {installByStatus.length > 0 && (
                <ChartCard title="Installation Status">
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={installByStatus} cx="50%" cy="45%" outerRadius={45} innerRadius={22} dataKey="value" paddingAngle={3}>
                        {installByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
            </div>

            {/* Withdrawal Processing Time */}
            {allWithdrawals.length > 0 && (
              <ChartCard title="Withdrawal Processing Time" defaultOpen={false}>
                {(() => {
                  const paid = allWithdrawals.filter((w: any) => w.withdrawalStatus === 'paid' && w.withdrawalPaidAt && w.createdAt);
                  const times = paid.map((w: any) => Math.round(
                    (new Date(w.withdrawalPaidAt).getTime() - new Date(w.createdAt).getTime()) / 86400000,
                  ));
                  const avg = times.length > 0 ? Math.round(times.reduce((s: number, t: number) => s + t, 0) / times.length) : 0;
                  const min = times.length > 0 ? Math.min(...times) : 0;
                  const max = times.length > 0 ? Math.max(...times) : 0;
                  return (
                    <>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-center p-2 bg-[var(--color-bg-sunken)] rounded-lg">
                          <p className="text-sm font-bold text-indigo-600">{avg}d</p>
                          <p className="text-[9px] text-[var(--color-text-muted)]">Avg</p>
                        </div>
                        <div className="text-center p-2 bg-[var(--color-bg-sunken)] rounded-lg">
                          <p className="text-sm font-bold text-emerald-600">{min}d</p>
                          <p className="text-[9px] text-[var(--color-text-muted)]">Min</p>
                        </div>
                        <div className="text-center p-2 bg-[var(--color-bg-sunken)] rounded-lg">
                          <p className="text-sm font-bold text-amber-600">{max}d</p>
                          <p className="text-[9px] text-[var(--color-text-muted)]">Max</p>
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={paid.slice(-6).map((w: any) => ({
                          date: fmtDate(w.createdAt),
                          days: Math.round((new Date(w.withdrawalPaidAt).getTime() - new Date(w.createdAt).getTime()) / 86400000),
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 8 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} unit="d" width={20} />
                          <Tooltip contentStyle={{ fontSize: 10, borderRadius: '8px' }} />
                          <Bar dataKey="days" fill="#6366f1" radius={[3, 3, 0, 0]} name="Days" />
                        </BarChart>
                      </ResponsiveContainer>
                    </>
                  );
                })()}
              </ChartCard>
            )}
          </>
        )}

        {/* ── Empty State ──────────────────────────────────────────────── */}
        {!hasPieData && !hasCommissionData && !hasPartnerData && !hasSettlementData && !showPartnerLeadData && (
          <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-6">
            <BarChart3 className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
            <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">No report data yet</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Reports will populate as you add leads, orders, customers, and partners.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
