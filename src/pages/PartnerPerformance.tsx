/**
 * PartnerPerformance — Admin Partner Performance Dashboard & Advanced Analytics
 *
 * Phase 8.4 — Analytics only. No modifications to commission engine, settlement logic,
 * wallet processing, or commission rule logic.
 *
 * Reuses: KPIStatCard, FilterBar, Table, Pagination, EmptyState, PageShell, recharts
 * Consumes: ChannelPartner, CommissionRecord, PartnerWalletTransaction, lead data
 * All computations are derived client-side from existing domain data.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  TrendingUp,
  Users,
  DollarSign,
  Clock,
  Target,
  MapPin,
  Award,
  CheckCircle2,
  AlertTriangle,
  Activity,
  RefreshCw,
  Eye,
  Filter,
  X,
  UserCheck,
  Wallet,
  CreditCard,
  Package,
  Layers,
} from 'lucide-react';
import { PageShell } from '../components/shared/PageShell';
import { EmptyState } from '../components/shared/EmptyState';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { FilterBar } from '../components/ui/FilterBar';
import { Pagination } from '../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { KPIStatCard } from '../components/dashboard/KPIStatCard';
import { Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { fmtCurrency, fmtCompactCurrency, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { computePartnerScore, buildPartnerScoreInput, GRADE_STYLES } from '../features/channel-partner/utils/analytics';

import { PartnerPerformanceDetailDrawer } from '../components/partner/PartnerPerformanceDetailDrawer';
import { PartnerComparisonView } from '../components/partner/PartnerComparisonView';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];
const PER_PAGE = 10;
const ALL = 'All';

function ScoreBadge({ score }: { score: string }) {
  return (
    <span className={`inline-flex items-center justify-center w-8 h-6 rounded-md text-xs font-bold ${GRADE_STYLES[score] || 'bg-gray-100 text-gray-600'}`}>
      {score}
    </span>
  );
}

function fmtCompact(n: number): string {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

export default function PartnerPerformance() {
  const { company } = useAppStore();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Data queries ──────────────────────────────────────
  const refetchAll = () => {
    partnersRefetch();
    leadsRefetch();
    commissionRefetch();
    walletRefetch();
  };

  const { data: partners = [], isLoading: pload, refetch: partnersRefetch } = useQuery({
    queryKey: ['channel_partners', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 30000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allLeads = [], isLoading: lload, refetch: leadsRefetch } = useQuery({
    queryKey: ['leads', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allCommissionRecords = [], isLoading: cload, refetch: commissionRefetch } = useQuery({
    queryKey: ['commission_records', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allWalletTxns = [], isLoading: wload, refetch: walletRefetch } = useQuery({
    queryKey: ['partner_wallet_transactions', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.PARTNER_WALLET_TXNS),
    staleTime: 30000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allRules = [] } = useQuery({
    queryKey: ['commission_rules', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RULES),
    staleTime: 60000,
    enabled: Boolean(activeCompanyId),
  });

  const loading = pload || lload || cload || wload;

  const activePartners = useMemo(() => partners.filter((p: any) => p.status === 'active' && !p.isDeleted), [partners]);
  const partnerLeads = useMemo(() => allLeads.filter((l: any) => l.partnerId && !l.isDeleted), [allLeads]);
  const settlements = useMemo(() => allWalletTxns.filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted), [allWalletTxns]);

  // ── Performance data with scores ──────────────────────
  const partnerPerformance = useMemo(() => {
    return (activePartners as any[]).map((p: any) => {
      const leads = partnerLeads.filter((l: any) => l.partnerId === p.id);
      const qualified = leads.filter((l: any) => l.status === 'Qualified').length;
      const won = leads.filter((l: any) => l.status === 'Converted' || l.status === 'Won').length;
      const conversionRate = leads.length > 0 ? Math.round((won / leads.length) * 100) : 0;
      const revenue = leads.reduce((sum: number, l: any) => sum + (Number(l.value) || 0), 0);
      const commission = allCommissionRecords.filter((r: any) => r.partnerId === p.id).reduce((sum: number, r: any) => sum + (r.approvedAmount || r.amount || 0), 0);
      const pendingSettlement = settlements.filter((s: any) => s.partnerId === p.id && s.status === 'pending').reduce((sum: number, s: any) => sum + (s.totalAmount || 0), 0);
      const activeCommissionRules = allRules.filter((r: any) => r.applicableIds?.includes(p.id) && r.isActive).length;
      const score = computePartnerScore(buildPartnerScoreInput(p.id, partnerLeads, settlements, allCommissionRecords));
      const completedInstalls = leads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed').length;
      const installations = leads.filter((l: any) => l.installationStatus && l.installationStatus !== 'pending').length;
      const pendingDocs = leads.filter((l: any) => l.documentationStatus === 'submitted' || l.documentationStatus === 'pending').length;
      const pendingCommissions = allCommissionRecords.filter((r: any) => r.partnerId === p.id && r.status === 'pending').length;

      return {
        ...p,
        leadsCount: leads.length,
        qualified,
        won,
        conversionRate,
        revenue,
        commission,
        commissionEarned: p.totalCommissionEarned || 0,
        walletBalance: p.walletBalance || 0,
        pendingSettlement,
        activeCommissionRules,
        score,
        completedInstalls,
        installations,
        pendingDocs,
        pendingCommissions,
        avgDeal: won > 0 ? Math.round(revenue / won) : 0,
      };
    }).sort((a: any, b: any) => b.score.numeric - a.score.numeric);
  }, [activePartners, partnerLeads, allCommissionRecords, settlements, allRules]);

  // ── KPIs ──────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalRevenue = partnerPerformance.reduce((s: number, p: any) => s + p.revenue, 0);
    const totalCommission = partnerPerformance.reduce((s: number, p: any) => s + p.commissionEarned, 0);
    const totalLeads = partnerPerformance.reduce((s: number, p: any) => s + p.leadsCount, 0);
    const totalWon = partnerPerformance.reduce((s: number, p: any) => s + p.won, 0);
    const avgConv = totalLeads > 0 ? Math.round((totalWon / totalLeads) * 100) : 0;
    const totalInstallations = partnerPerformance.reduce((s: number, p: any) => s + p.installations, 0);
    const avgDealSize = totalWon > 0 ? Math.round(totalRevenue / totalWon) : 0;
    const topPerformer = partnerPerformance[0]?.firmName || '—';
    const totalPendingSettlement = partnerPerformance.reduce((s: number, p: any) => s + p.pendingSettlement, 0);
    const pendingInstallations = partnerPerformance.reduce((s: number, p: any) => s + (p.installations - p.completedInstalls), 0);
    const pendingDocsAll = partnerPerformance.reduce((s: number, p: any) => s + p.pendingDocs, 0);
    const pendingCommissionsAll = partnerPerformance.reduce((s: number, p: any) => s + p.pendingCommissions, 0);

    return {
      totalPartners: activePartners.length,
      activePartners: activePartners.length,
      topPerformer,
      totalRevenue,
      totalCommission,
      avgConversion: avgConv + '%',
      avgDealSize,
      totalInstallations,
      pendingInstallations,
      pendingDocsAll,
      pendingCommissionsAll,
      totalPendingSettlement,
    };
  }, [partnerPerformance, activePartners]);

  // ── Regional analytics ────────────────────────────────
  const regionData = useMemo(() => {
    const byState: Record<string, { partners: number; revenue: number; installations: number; commission: number }> = {};
    const byCity: Record<string, { partners: number; revenue: number }> = {};

    partnerPerformance.forEach((p: any) => {
      const state = p.address?.state || 'Unknown';
      const city = p.address?.city || 'Unknown';

      if (!byState[state]) byState[state] = { partners: 0, revenue: 0, installations: 0, commission: 0 };
      byState[state].partners += 1;
      byState[state].revenue += p.revenue || 0;
      byState[state].installations += p.installations || 0;
      byState[state].commission += p.commissionEarned || 0;

      if (!byCity[city]) byCity[city] = { partners: 0, revenue: 0 };
      byCity[city].partners += 1;
      byCity[city].revenue += p.revenue || 0;
    });

    return {
      byState: Object.entries(byState)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a: any, b: any) => b.revenue - a.revenue),
      byCity: Object.entries(byCity)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a: any, b: any) => b.revenue - a.revenue)
        .slice(0, 10),
    };
  }, [partnerPerformance]);

  // ── Funnel analytics ──────────────────────────────────
  const funnelData = useMemo(() => {
    const total = partnerLeads.length;
    const survey = partnerLeads.filter((l: any) => l.installationStatus === 'survey' || l.installationStatus === 'pending').length;
    const proposal = partnerLeads.filter((l: any) => l.installationStatus === 'proposal' || l.installationStatus === 'design' || l.installationStatus === 'approval').length;
    const installation = partnerLeads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'testing' || l.installationStatus === 'commissioning').length;
    const completed = partnerLeads.filter((l: any) => l.installationStatus === 'closed').length;
    const lost = partnerLeads.filter((l: any) => l.status === 'Lost' || l.status === 'Cancelled').length;

    const stages = [
      { name: 'Lead', value: total, pct: '100%' },
      { name: 'Survey', value: survey, pct: total > 0 ? Math.round((survey / total) * 100) + '%' : '0%' },
      { name: 'Proposal', value: proposal, pct: total > 0 ? Math.round((proposal / total) * 100) + '%' : '0%' },
      { name: 'Installation', value: installation, pct: total > 0 ? Math.round((installation / total) * 100) + '%' : '0%' },
      { name: 'Completed', value: completed, pct: total > 0 ? Math.round((completed / total) * 100) + '%' : '0%' },
      { name: 'Lost', value: lost, pct: total > 0 ? Math.round((lost / total) * 100) + '%' : '0%' },
    ];

    // Compute funnel flow percentages
    const funnelWithDropoff = stages.map((s, i) => {
      if (i === 0) return { ...s, dropoffPct: '—', remainingPct: '100%' };
      const prev = stages[i - 1].value;
      const dropoff = prev > 0 ? Math.round(((prev - s.value) / prev) * 100) : 0;
      const remaining = total > 0 ? Math.round((s.value / total) * 100) : 0;
      return { ...s, dropoffPct: dropoff + '%', remainingPct: remaining + '%' };
    });

    return {
      stages: funnelWithDropoff,
      overallConv: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [partnerLeads]);

  // ── Commission analytics ──────────────────────────────
  const commissionAnalytics = useMemo(() => {
    const byMonth: Record<string, number> = {};
    const byRuleType: Record<string, number> = {};
    const byPartner: Record<string, number> = {};
    let totalPending = 0;
    let totalPaid = 0;

    allCommissionRecords.forEach((r: any) => {
      if (r.isDeleted) return;
      const amount = r.approvedAmount || r.amount || 0;
      if (r.status === 'pending') totalPending += amount;
      if (r.status === 'paid') totalPaid += amount;

      const d = toDateValue(r.generatedDate);
      if (d) {
        const k = d.toLocaleString('default', { month: 'short', year: '2-digit' });
        byMonth[k] = (byMonth[k] || 0) + amount;
      }

      const t = r.ruleType || 'unknown';
      byRuleType[t] = (byRuleType[t] || 0) + amount;

      byPartner[r.partnerId] = (byPartner[r.partnerId] || 0) + amount;
    });

    return {
      byMonth: Object.entries(byMonth).map(([month, amount]) => ({ month, amount })),
      byRuleType: Object.entries(byRuleType).map(([name, value]) => ({ name, value })),
      byPartner: Object.entries(byPartner)
        .map(([partnerId, value]) => {
          const p = activePartners.find((p2: any) => p2.id === partnerId);
          return { partnerId, name: p?.firmName || partnerId, value };
        })
        .sort((a: any, b: any) => b.value - a.value),
      totalPending,
      totalPaid,
      avgPct: allCommissionRecords.length > 0
        ? Math.round(allCommissionRecords.reduce((s: number, r: any) => s + (r.dealValue ? ((r.approvedAmount || r.amount || 0) / r.dealValue) * 100 : 0), 0) / allCommissionRecords.length * 10) / 10
        : 0,
    };
  }, [allCommissionRecords, activePartners]);

  // ── Settlement analytics ──────────────────────────────
  const settlementAnalytics = useMemo(() => {
    const byMonth: Record<string, number> = {};
    const pendingCount = settlements.filter((s: any) => s.status === 'pending').length;
    const completedCount = settlements.filter((s: any) => s.status === 'completed').length;
    const failedCount = settlements.filter((s: any) => s.status === 'failed').length;
    const totalAmount = settlements.reduce((s: number, t: any) => s + (t.totalAmount || 0), 0);
    const completedAmount = settlements.filter((s: any) => s.status === 'completed').reduce((s: number, t: any) => s + (t.totalAmount || 0), 0);

    settlements.filter((s: any) => s.status === 'completed').forEach((s: any) => {
      const d = toDateValue(s.completedAt);
      if (d) {
        const k = d.toLocaleString('default', { month: 'short', year: '2-digit' });
        byMonth[k] = (byMonth[k] || 0) + (s.totalAmount || 0);
      }
    });

    // Average processing time (days) for completed settlements
    const processingTimes: number[] = [];
    settlements.filter((s: any) => s.status === 'completed' && s.createdAt && s.completedAt).forEach((s: any) => {
      const created = toDateValue(s.createdAt);
      const completed = toDateValue(s.completedAt);
      if (created && completed) {
        processingTimes.push(Math.round((completed.getTime() - created.getTime()) / 86400000));
      }
    });
    const avgProcessingDays = processingTimes.length > 0
      ? Math.round(processingTimes.reduce((s: number, t: number) => s + t, 0) / processingTimes.length)
      : 0;

    // Withdrawal trends
    const withdrawals = allWalletTxns.filter((t: any) => t.type === 'withdrawal_request' && !t.isDeleted);
    const totalWithdrawn = withdrawals.filter((t: any) => t.withdrawalStatus === 'paid').reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
    const pendingWithdrawals = withdrawals.filter((t: any) => t.withdrawalStatus === 'pending').reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);

    // Wallet credits/debits
    const totalCredits = allWalletTxns.filter((t: any) => t.type === 'commission_credit' && !t.isDeleted).reduce((s: number, t: any) => s + (t.amount || 0), 0);
    const totalDebits = allWalletTxns.filter((t: any) => (t.type === 'withdrawal_paid' || t.type === 'withdrawal_request') && !t.isDeleted).reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);

    return {
      byMonth: Object.entries(byMonth).map(([month, amount]) => ({ month, amount })),
      pendingCount,
      completedCount,
      failedCount,
      totalAmount,
      completedAmount,
      avgProcessingDays,
      totalWithdrawn,
      pendingWithdrawalsAmount: pendingWithdrawals,
      totalCredits,
      totalDebits,
    };
  }, [settlements, allWalletTxns]);

  // ── View state ────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'overview' | 'leaderboard' | 'regional' | 'funnel' | 'commissions' | 'settlements' | 'comparison'>(
    () => (searchParams.get('tab') as any) || 'overview'
  );
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
      syncParams({ q: searchInput });
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);
  const [stateFilter, setStateFilter] = useState(() => searchParams.get('state') || ALL);
  const [tierFilter, setTierFilter] = useState(() => searchParams.get('tier') || ALL);
  const [sortKey, setSortKey] = useState(() => searchParams.get('sort') || 'commissionEarned');
  const [sortDesc, setSortDesc] = useState(() => searchParams.get('sortDesc') !== 'false');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [selectedPartners, setSelectedPartners] = useState<string[]>([]);
  const [viewPartner, setViewPartner] = useState<any>(null);
  const [showFilters, setShowFilters] = useState(() => searchParams.has('state') || searchParams.has('tier'));
  const lastClosedParamRef = useRef<string | null>(null);

  // ── Filtered leaderboard ──────────────────────────────
  const filtered = useMemo(() => {
    let list = [...partnerPerformance];
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((p: any) =>
      [p.firmName, p.contactPerson, p.email, p.phone, p.address?.city, p.address?.state]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
    if (stateFilter !== ALL) list = list.filter((p: any) => (p.address?.state || '') === stateFilter);
    if (tierFilter !== ALL) list = list.filter((p: any) => {
      const tierLookup: Record<string, string> = { 'bronze': 'Bronze', 'silver': 'Silver', 'gold': 'Gold', 'platinum': 'Platinum' };
      return (p.tier || 'bronze') === tierFilter.toLowerCase();
    });

    list.sort((a: any, b: any) => {
      const av = Number(a[sortKey as keyof typeof a] ?? 0);
      const bv = Number(b[sortKey as keyof typeof b] ?? 0);
      return sortDesc ? bv - av : av - bv;
    });

    return list;
  }, [partnerPerformance, search, stateFilter, tierFilter, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Reset page on filter change
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // ── Helper: unique states for filter ──────────────────
  const uniqueStates = useMemo(() => {
    const s = new Set<string>();
    partners.forEach((p: any) => { if (p.address?.state) s.add(p.address.state); });
    return Array.from(s).sort();
  }, [partners]);

  // ── URL sync ────────────────────────────────────────────
  function syncParams(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    // Preserve tab
    if (activeTab !== 'overview') next.set('tab', activeTab);
    else next.delete('tab');
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== ALL && v !== 'all') next.set(k, v);
      else next.delete(k);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch('');
    setSearchInput('');
    setStateFilter(ALL);
    setTierFilter(ALL);
    setPage(1);
    setSearchParams({}, { replace: true });
  }

  function sort(k: string) {
    if (sortKey === k) setSortDesc(d => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  // ── Tab navigation ────────────────────────────────────
  const TABS = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { id: 'leaderboard', label: 'Leaderboard', icon: <Award className="h-3.5 w-3.5" /> },
    { id: 'regional', label: 'Regional', icon: <MapPin className="h-3.5 w-3.5" /> },
    { id: 'funnel', label: 'Funnel', icon: <Activity className="h-3.5 w-3.5" /> },
    { id: 'commissions', label: 'Commissions', icon: <DollarSign className="h-3.5 w-3.5" /> },
    { id: 'settlements', label: 'Settlements', icon: <CreditCard className="h-3.5 w-3.5" /> },
    { id: 'comparison', label: 'Compare', icon: <Layers className="h-3.5 w-3.5" /> },
  ];

  // ── Score distribution for charts ─────────────────────
  const scoreDistribution = useMemo(() => {
    const dist: Record<string, number> = { 'A+': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0 };
    partnerPerformance.forEach((p: any) => { dist[p.score.score] = (dist[p.score.score] || 0) + 1; });
    return Object.entries(dist).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [partnerPerformance]);

  if (loading && partners.length === 0) {
    return (
      <div className="space-y-5 p-1 animate-pulse">
        <div className="h-8 w-64 skeleton rounded-lg" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-24 skeleton rounded-xl" />)}
        </div>
        <div className="h-72 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <PageShell
        title="Partner Performance"
        subtitle="Advanced analytics and performance monitoring"
        icon={<Activity className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setShowFilters(!showFilters)}>
              Filters
            </Button>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={refetchAll}>
              Refresh
            </Button>
          </div>
        }
      >
        {/* ── Tab Navigation ──────────────────────────────── */}
        <div className="flex flex-wrap gap-1 border-b border-[var(--color-border-subtle)] pb-1 mb-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg transition-all ${
                activeTab === tab.id
                  ? 'text-[var(--color-primary)] bg-[var(--color-primary-light)] border-b-2 border-[var(--color-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-sunken)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ────────────────────────────────────────────────── */}
        {/*  OVERVIEW TAB                                        */}
        {/* ────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KPIStatCard label="Total Partners" value={kpis.totalPartners} icon={<Users className="h-5 w-5" />} color="indigo" loading={loading} compact />
              <KPIStatCard label="Active Partners" value={kpis.activePartners} icon={<UserCheck className="h-5 w-5" />} color="emerald" loading={loading} compact />
              <KPIStatCard label="Top Performer" value={kpis.topPerformer} icon={<Award className="h-5 w-5" />} color="amber" loading={loading} compact />
              <KPIStatCard label="Avg Conversion" value={kpis.avgConversion} icon={<Target className="h-5 w-5" />} color="purple" loading={loading} compact />
              <KPIStatCard label="Avg Deal Size" value={fmtCompactCurrency(kpis.avgDealSize)} icon={<DollarSign className="h-5 w-5" />} color="blue" loading={loading} compact />
              <KPIStatCard label="Total Installations" value={kpis.totalInstallations} icon={<Package className="h-5 w-5" />} color="teal" loading={loading} compact />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KPIStatCard label="Revenue Generated" value={fmtCompactCurrency(kpis.totalRevenue)} icon={<TrendingUp className="h-5 w-5" />} color="indigo" loading={loading} compact />
              <KPIStatCard label="Commission Earned" value={fmtCompactCurrency(kpis.totalCommission)} icon={<Wallet className="h-5 w-5" />} color="emerald" loading={loading} compact />
              <KPIStatCard label="Pending Commission" value={kpis.pendingCommissionsAll} icon={<Clock className="h-5 w-5" />} color="amber" loading={loading} compact />
              <KPIStatCard label="Pending Settlement" value={fmtCompactCurrency(kpis.totalPendingSettlement)} icon={<AlertTriangle className="h-5 w-5" />} color="orange" loading={loading} compact />
              <KPIStatCard label="Pending Installations" value={kpis.pendingInstallations} icon={<Clock className="h-5 w-5" />} color="rose" loading={loading} compact />
              <KPIStatCard label="Pending Docs" value={kpis.pendingDocsAll} icon={<Target className="h-5 w-5" />} color="purple" loading={loading} compact />
            </div>

            {/* Quick summary charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Score Distribution */}
              {scoreDistribution.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Partner Score Distribution</CardTitle></CardHeader>
                  <CardBody className="flex justify-center">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={scoreDistribution} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                          {scoreDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Top 5 Partners by Revenue */}
              {partnerPerformance.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Top Partners by Revenue</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={partnerPerformance.slice(0, 5).map((p: any) => ({ name: p.firmName?.slice(0, 18) || '—', revenue: p.revenue }))} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={110} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Revenue']} />
                        <Bar dataKey="revenue" fill="#6366f1" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/*  LEADERBOARD TAB                                     */}
        {/* ────────────────────────────────────────────────── */}
        {activeTab === 'leaderboard' && (
          <>
            {showFilters && (
              <div className="mb-4 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="block text-[10px] font-semibold text-[var(--color-text-muted)] uppercase mb-1">State</label>
                    <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
                      className="text-sm border border-[var(--color-border)] rounded-lg px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)]">
                      <option value={ALL}>All States</option>
                      {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[var(--color-text-muted)] uppercase mb-1">Tier</label>
                    <select value={tierFilter} onChange={e => setTierFilter(e.target.value)}
                      className="text-sm border border-[var(--color-border)] rounded-lg px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)]">
                      <option value={ALL}>All Tiers</option>
                      <option value="bronze">Bronze</option>
                      <option value="silver">Silver</option>
                      <option value="gold">Gold</option>
                      <option value="platinum">Platinum</option>
                    </select>
                  </div>
                  {(stateFilter !== ALL || tierFilter !== ALL) && (
                    <button onClick={clearAll} className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                      <X className="h-3 w-3" /> Clear filters
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Export button */}
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => {
                  const headers = ['Rank','Partner','Leads','Won','Conv%','Revenue','Commission','Score'];
                  const rows = filtered.map((p: any, i: number) => [i+1, p.firmName||'', p.leadsCount||0, p.won||0, p.conversionRate+'%', p.revenue||0, p.commission||0, p.score?.score||'']);
                  const csv = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = 'partner-performance.csv'; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                Export CSV
              </button>
            </div>

            {/* Leaderboard KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <KPIStatCard label="Partners" value={filtered.length} icon={<Users className="h-5 w-5" />} color="indigo" compact />
              <KPIStatCard label="Top Score" value={filtered[0]?.score?.score || '—'} icon={<Award className="h-5 w-5" />} color="emerald" compact />
              <KPIStatCard label="Avg Conversion" value={filtered.length > 0 ? Math.round(filtered.reduce((s: number, p: any) => s + p.conversionRate, 0) / filtered.length) + '%' : '0%'} icon={<Target className="h-5 w-5" />} color="purple" compact />
              <KPIStatCard label="Total Revenue" value={fmtCompactCurrency(filtered.reduce((s: number, p: any) => s + p.revenue, 0))} icon={<TrendingUp className="h-5 w-5" />} color="teal" compact />
            </div>

            {/* Leaderboard Table */}
            <FilterBar
              search={search}
              onSearch={(v) => { setSearchInput(v); setPage(1); if (!v) setSearch(''); }}
              searchPlaceholder="Search partners by name, contact, location..."
              count={filtered.length}
              total={partnerPerformance.length}
              label="partners"
              onClearAll={clearAll}
            />

            <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] overflow-hidden">
              <div className="min-h-0 overflow-x-auto">
                <Table>
                  <Thead>
                    <Th>RANK</Th>
                    <Th sortable sorted={sortKey === 'firmName'} desc={sortDesc} onSort={() => sort('firmName')}>PARTNER</Th>
                    <Th className="hidden lg:table-cell">COMPANY</Th>
                    <Th sortable sorted={sortKey === 'leadsCount'} desc={sortDesc} onSort={() => sort('leadsCount')}>LEADS</Th>
                    <Th sortable sorted={sortKey === 'won'} desc={sortDesc} onSort={() => sort('won')}>WON</Th>
                    <Th sortable sorted={sortKey === 'conversionRate'} desc={sortDesc} onSort={() => sort('conversionRate')}>CONV%</Th>
                    <Th sortable sorted={sortKey === 'revenue'} desc={sortDesc} onSort={() => sort('revenue')}>REVENUE</Th>
                    <Th sortable sorted={sortKey === 'commission'} desc={sortDesc} onSort={() => sort('commission')}>COMMISSION</Th>
                    <Th className="hidden xl:table-cell">WALLET</Th>
                    <Th className="hidden xl:table-cell">PENDING</Th>
                    <Th className="hidden lg:table-cell">RULES</Th>
                    <Th>SCORE</Th>
                    <Th className="w-16">ACTION</Th>
                  </Thead>
                  <Tbody>
                    {loading ? (
                      <SkeletonRows cols={13} />
                    ) : paginated.length === 0 ? (
                      <tr>
                        <td colSpan={13}>
                          <EmptyState icon={<Users className="h-8 w-8" />} title="No partners found" description="Try adjusting your search or filters." />
                        </td>
                      </tr>
                    ) : (
                      paginated.map((p: any, idx: number) => {
                        const rank = (page - 1) * PER_PAGE + idx + 1;
                        return (
                          <Tr key={p.id} className="group cursor-pointer transition-all hover:bg-[var(--color-surface-hover)]"
                            onClick={() => setViewPartner(p)}
                          >
                            <Td>
                              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                                rank === 1 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                                rank === 2 ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' :
                                rank === 3 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
                                'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]'
                              }`}>
                                {rank}
                              </span>
                            </Td>
                            <Td>
                              <div className="flex items-center gap-2">
                                <div className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                                  {(p.firmName || '?')[0]}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-[var(--color-text)] text-sm leading-tight truncate max-w-[130px]">{p.firmName || '—'}</p>
                                  <p className="text-[10px] text-[var(--color-text-muted)] truncate">{p.contactPerson || ''}</p>
                                </div>
                              </div>
                            </Td>
                            <Td className="hidden lg:table-cell text-xs text-[var(--color-text-muted)]">{p.firmName || '—'}</Td>
                            <Td className="text-xs tabular-nums text-[var(--color-text)]">{p.leadsCount}</Td>
                            <Td className="text-xs tabular-nums text-[var(--color-text)]">{p.won}</Td>
                            <Td className="text-xs tabular-nums">{p.conversionRate}%</Td>
                            <Td className="text-xs font-semibold tabular-nums text-[var(--color-text)]">{fmtCompactCurrency(p.revenue)}</Td>
                            <Td className="text-xs font-semibold tabular-nums text-[var(--color-text)]">{fmtCompactCurrency(p.commission)}</Td>
                            <Td className="hidden xl:table-cell text-xs tabular-nums">{fmtCompactCurrency(p.walletBalance)}</Td>
                            <Td className="hidden xl:table-cell text-xs tabular-nums">{fmtCompactCurrency(p.pendingSettlement)}</Td>
                            <Td className="hidden lg:table-cell text-xs text-center">{p.activeCommissionRules}</Td>
                            <Td><ScoreBadge score={p.score.score} /></Td>
                            <Td>
                              <button type="button" onClick={(e) => { e.stopPropagation(); setViewPartner(p); }}
                                className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-sm transition-all hover:-translate-y-0.5 hover:opacity-90">
                                <Eye className="h-3 w-3" /> View
                              </button>
                            </Td>
                          </Tr>
                        );
                      })
                    )}
                  </Tbody>
                </Table>
              </div>
              {filtered.length > PER_PAGE && (
                <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
              )}
            </div>
          </>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/*  REGIONAL TAB                                        */}
        {/* ────────────────────────────────────────────────── */}
        {activeTab === 'regional' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Revenue by State */}
              {regionData.byState.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Revenue by State</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={regionData.byState} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Revenue']} />
                        <Bar dataKey="revenue" fill="#6366f1" radius={[0, 4, 4, 0]} name="Revenue" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Partners by State */}
              {regionData.byState.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Partners by State</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={regionData.byState} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                        <Bar dataKey="partners" fill="#10b981" radius={[0, 4, 4, 0]} name="Partners" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Commission Distribution by Region */}
              {regionData.byState.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Commission Distribution by Region</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={regionData.byState.filter((s: any) => s.commission > 0).map((s: any) => ({ name: s.name, value: s.commission }))}
                          cx="50%" cy="45%" outerRadius={80} innerRadius={40} dataKey="value" paddingAngle={2}>
                          {regionData.byState.filter((s: any) => s.commission > 0).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Commission']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Top Cities */}
              {regionData.byCity.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Top Performing Cities</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={regionData.byCity} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                        <Bar dataKey="revenue" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Revenue" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/*  FUNNEL TAB                                          */}
        {/* ────────────────────────────────────────────────── */}
        {activeTab === 'funnel' && (
          <div className="space-y-5">
            {/* Overall conversion rate */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPIStatCard label="Total Partner Leads" value={funnelData.stages[0].value} icon={<Target className="h-5 w-5" />} color="indigo" loading={loading} compact />
              <KPIStatCard label="Overall Conversion" value={funnelData.overallConv + '%'} icon={<TrendingUp className="h-5 w-5" />} color="emerald" loading={loading} compact />
              <KPIStatCard label="Installations" value={funnelData.stages[3].value} icon={<Package className="h-5 w-5" />} color="amber" loading={loading} compact />
              <KPIStatCard label="Lost Deals" value={funnelData.stages[5].value} icon={<AlertTriangle className="h-5 w-5" />} color="rose" loading={loading} compact />
            </div>

            {/* Funnel Stages */}
            <Card>
              <CardHeader><CardTitle>Partner Lead Funnel</CardTitle></CardHeader>
              <CardBody>
                <div className="space-y-3">
                  {funnelData.stages.map((stage, i) => (
                    <div key={stage.name} className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-[var(--color-text-muted)] w-20 shrink-0">{stage.name}</span>
                      <div className="flex-1 bg-[var(--color-bg-sunken)] rounded-full h-7 overflow-hidden">
                        <div className={`h-full rounded-full flex items-center px-3 transition-all duration-500 ${
                          stage.name === 'Lost' ? 'bg-red-100 text-red-700' :
                          stage.name === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-indigo-100 text-indigo-700'
                        }`} style={{ width: funnelData.stages[0].value > 0 ? `${Math.max(3, (stage.value / funnelData.stages[0].value) * 100)}%` : '3%' }}>
                          <span className="text-xs font-bold">{stage.value}</span>
                        </div>
                      </div>
                      <span className="text-xs text-[var(--color-text-muted)] w-12 text-right">{stage.remainingPct}</span>
                      {i > 0 && (
                        <span className="text-[10px] text-rose-500 w-12 text-right">{stage.dropoffPct}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-4 mt-2 text-[10px] text-[var(--color-text-muted)]">
                  <span>← Drop-off %</span>
                </div>
              </CardBody>
            </Card>
          </div>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/*  COMMISSIONS TAB                                     */}
        {/* ────────────────────────────────────────────────── */}
        {activeTab === 'commissions' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPIStatCard label="Pending Commissions" value={fmtCompactCurrency(commissionAnalytics.totalPending)} icon={<Clock className="h-5 w-5" />} color="amber" loading={loading} compact />
              <KPIStatCard label="Paid Commissions" value={fmtCompactCurrency(commissionAnalytics.totalPaid)} icon={<CheckCircle2 className="h-5 w-5" />} color="emerald" loading={loading} compact />
              <KPIStatCard label="Avg Commission %" value={commissionAnalytics.avgPct + '%'} icon={<Target className="h-5 w-5" />} color="purple" loading={loading} compact />
              <KPIStatCard label="Total Records" value={allCommissionRecords.filter((r: any) => !r.isDeleted).length} icon={<DollarSign className="h-5 w-5" />} color="indigo" loading={loading} compact />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Commission by Month */}
              {commissionAnalytics.byMonth.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Commission by Month</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={commissionAnalytics.byMonth}>
                        <defs>
                          <linearGradient id="commGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Commission']} />
                        <Area type="monotone" dataKey="amount" stroke="#6366f1" fill="url(#commGrad)" strokeWidth={2} name="Commission" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Commission by Rule Type */}
              {commissionAnalytics.byRuleType.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Commission by Rule Type</CardTitle></CardHeader>
                  <CardBody className="flex justify-center">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={commissionAnalytics.byRuleType} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                          {commissionAnalytics.byRuleType.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Amount']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Commission by Partner (Top 8) */}
              {commissionAnalytics.byPartner.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Commission by Partner (Top 8)</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={commissionAnalytics.byPartner.slice(0, 8)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={110} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Commission']} />
                        <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} name="Commission" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Pending vs Paid */}
              <Card>
                <CardHeader><CardTitle>Pending vs Paid Commission</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={[
                        { name: 'Pending', value: commissionAnalytics.totalPending },
                        { name: 'Paid', value: commissionAnalytics.totalPaid },
                      ]} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                        <Cell fill="#f59e0b" />
                        <Cell fill="#10b981" />
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Amount']} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/*  SETTLEMENTS TAB                                      */}
        {/* ────────────────────────────────────────────────── */}
        {activeTab === 'settlements' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KPIStatCard label="Total Settlement Amt" value={fmtCompactCurrency(settlementAnalytics.totalAmount)} icon={<CreditCard className="h-5 w-5" />} color="indigo" loading={loading} compact />
              <KPIStatCard label="Completed" value={fmtCompactCurrency(settlementAnalytics.completedAmount)} icon={<CheckCircle2 className="h-5 w-5" />} color="emerald" loading={loading} compact />
              <KPIStatCard label="Pending" value={settlementAnalytics.pendingCount} icon={<Clock className="h-5 w-5" />} color="amber" loading={loading} compact />
              <KPIStatCard label="Failed" value={settlementAnalytics.failedCount} icon={<AlertTriangle className="h-5 w-5" />} color="rose" loading={loading} compact />
              <KPIStatCard label="Avg Processing" value={settlementAnalytics.avgProcessingDays + ' days'} icon={<Target className="h-5 w-5" />} color="purple" loading={loading} compact />
              <KPIStatCard label="Withdrawn" value={fmtCompactCurrency(settlementAnalytics.totalWithdrawn)} icon={<DollarSign className="h-5 w-5" />} color="teal" loading={loading} compact />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Settlement Trend */}
              {settlementAnalytics.byMonth.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Settlement Trend (Monthly)</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={settlementAnalytics.byMonth}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Amount']} />
                        <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} name="Settled Amount" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Wallet Activity */}
              <Card>
                <CardHeader><CardTitle>Wallet Activity</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={[
                        { name: 'Credits (Commission)', value: settlementAnalytics.totalCredits },
                        { name: 'Debits (Withdrawals)', value: settlementAnalytics.totalDebits },
                      ]} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                        <Cell fill="#10b981" />
                        <Cell fill="#ef4444" />
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Amount']} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/*  COMPARISON TAB                                       */}
        {/* ────────────────────────────────────────────────── */}
        {activeTab === 'comparison' && (
          <PartnerComparisonView
            partners={partnerPerformance}
            onSelect={(ids) => setSelectedPartners(ids)}
            selectedIds={selectedPartners}
          />
        )}
      </PageShell>

      {/* ── Partner Detail Drawer ──────────────────────────── */}
      <PartnerPerformanceDetailDrawer
        partner={viewPartner}
        open={!!viewPartner && lastClosedParamRef.current !== viewPartner?.id}
        onClose={() => { lastClosedParamRef.current = viewPartner?.id || null; setViewPartner(null); }}
        allLeads={partnerLeads}
        allCommissionRecords={allCommissionRecords}
        allWalletTxns={allWalletTxns}
        allSettlements={settlements}
      />
    </ErrorBoundary>
  );
}
