/**
 * CaseSearch — Universal Case Search page
 *
 * Phase 3H — Case Search
 * Route: /cases/search
 *
 * Features:
 * - Search bar with free-text across all case-related entities
 * - Advanced filter panel (9+ filters)
 * - Search results table with linked entity navigation
 * - KPI cards (Total Results, Healthy, Warning, Critical, Completed)
 * - Quick actions (Open Case/Lead/Customer/Project, Export)
 * - Works across all 17 EPC stages
 * - READ-ONLY, no Firestore writes
 */

import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getAll,
} from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { PROJECT_STAGE_ORDER } from '../lib/projectLifecycle';
import { projectStageLabel } from '../features/projects/utils/projectDisplay';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { cn } from '../utils/cn';
import { PageHeader, Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { KPIStatCard } from '../components/dashboard/KPIStatCard';
import { Button } from '../components/ui/Button';
import { DataTable } from '../components/shared/DataTable';
import type { TableColumn } from '../components/shared/DataTable';
import {
  searchCases,
} from '../features/cases/utils/caseSearch';
import type { CaseSearchResult, CaseSearchSummary } from '../features/cases/utils/caseSearch';
import {
  Search, Filter, X, Download, ArrowUpRight, Target,
  Users, Building2, FileText, ShoppingCart, CreditCard,
  FolderKanban, CheckCircle2, AlertTriangle,
  XCircle, Loader2, SlidersHorizontal,
  Truck, Wrench, ClipboardCheck, Zap,
  Gauge, PiggyBank, Handshake, Shield, Headphones,
  Activity,
} from 'lucide-react';

// ── Stage options for filter dropdown ────────────────────
// Phase 16: this previously hand-typed a 9th independent copy of the stage
// list (the exact anti-pattern Phase 5 consolidated into projectLifecycle.ts)
// and got it wrong in the process — a phantom 'Closure' value that is not a
// real ProjectStage (so filtering by it could never match anything) and a
// missing 'Archived' (a real terminal stage, so a project genuinely archived
// could never be filtered for by stage). Now derives from the single
// canonical source instead of drifting independently.

// Phase 0 (Channel Partner): labels map through projectStageLabel() so the
// internal `SchemeRegistration` value never leaks to the UI — it displays as
// "Registration" (naming contract) while the option value stays the raw
// canonical stage value used by the filter query below.
const STAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'All Stages', label: 'All Stages' },
  ...PROJECT_STAGE_ORDER.map((stage) => ({ value: stage, label: projectStageLabel(stage) })),
];

const STATUS_OPTIONS = ['All Statuses', 'Active', 'Completed', 'Failed', 'Warning', 'Cancelled', 'Archived'];
const HEALTH_OPTIONS = ['All Health', 'healthy', 'warning', 'critical'];
const CUSTOMER_TYPE_OPTIONS = ['All Types', 'B2C', 'B2B', 'Commercial', 'Industrial', 'Residential'];
const LEAD_SOURCE_OPTIONS = ['All Sources', 'Walk-in', 'Reference', 'Website', 'Partner', 'Phone', 'Social Media', 'Other'];

// ── Quick action icons per entity type ───────────────────

const ENTITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  leads: Target,
  customers: Users,
  projects: Building2,
  quotations: FileText,
  orders: ShoppingCart,
  invoices: FileText,
  payments: CreditCard,
  dispatch: Truck,
  installations: Wrench,
  qc_checks: ClipboardCheck,
  commissioning_records: Zap,
  net_metering_applications: Gauge,
  subsidy_applications: PiggyBank,
  project_handovers: Handshake,
  amc_contracts: Shield,
  service_tickets: Headphones,
  generation_readings: Activity,
};

// ── Main Component ───────────────────────────────────────

export default function CaseSearch() {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Search state ──────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [stageFilter, setStageFilter] = useState('All Stages');
  const [healthFilter, setHealthFilter] = useState('All Health');
  const [customerTypeFilter, setCustomerTypeFilter] = useState('All Types');
  const [leadSourceFilter, setLeadSourceFilter] = useState('All Sources');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [results, setResults] = useState<CaseSearchResult[]>([]);
  const [summary, setSummary] = useState<CaseSearchSummary | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // ── Data queries ──────────────────────────────────────
  const casesQuery = useQuery({
    queryKey: ['cases', activeCompanyId, 'search'],
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

  const quotationsQuery = useQuery({
    queryKey: qkeys.quotationsAll,
    queryFn: () => getAll<any>(COLLECTIONS.QUOTATIONS),
    staleTime: 60_000,
  });

  const ordersQuery = useQuery({
    queryKey: qkeys.ordersAll,
    queryFn: () => getAll<any>(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });

  const invoicesQuery = useQuery({
    queryKey: qkeys.invoices,
    queryFn: () => getAll<any>(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 60_000,
  });

  const paymentsQuery = useQuery({
    queryKey: qkeys.payments,
    queryFn: () => getAll<any>(COLLECTIONS.PAYMENTS),
    staleTime: 60_000,
  });

  const dispatchQuery = useQuery({
    queryKey: qkeys.dispatchAll,
    queryFn: () => getAll<any>(COLLECTIONS.DISPATCH),
    staleTime: 60_000,
  });

  const installationsQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-installations'],
    queryFn: () => getAll<any>('installations'),
    staleTime: 60_000,
  });

  const qcQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-qc'],
    queryFn: () => getAll<any>(COLLECTIONS.QC_CHECKS),
    staleTime: 60_000,
  });

  const commissioningQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-commissioning'],
    queryFn: () => getAll<any>(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 60_000,
  });

  const netMeteringQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-netmetering'],
    queryFn: () => getAll<any>(COLLECTIONS.NET_METERING_APPLICATIONS),
    staleTime: 60_000,
  });

  const subsidyQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-subsidy'],
    queryFn: () => getAll<any>(COLLECTIONS.SUBSIDY_APPLICATIONS),
    staleTime: 60_000,
  });

  const handoversQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-handovers'],
    queryFn: () => getAll<any>(COLLECTIONS.PROJECT_HANDOVERS),
    staleTime: 60_000,
  });

  const amcQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-amc'],
    queryFn: () => getAll<any>(COLLECTIONS.AMC_CONTRACTS),
    staleTime: 60_000,
  });

  const ticketsQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-tickets'],
    queryFn: () => getAll<any>(COLLECTIONS.SERVICE_TICKETS),
    staleTime: 60_000,
  });

  const monitoringQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, 'search-readings'],
    queryFn: () => getAll<any>(COLLECTIONS.GENERATION_READINGS),
    staleTime: 60_000,
  });

  const allCases = (casesQuery.data as any[]) || [];
  const allLeads = (leadsQuery.data as any[]) || [];
  const allCustomers = (customersQuery.data as any[]) || [];
  const allProjects = (projectsQuery.data as any[]) || [];
  const allQuotations = (quotationsQuery.data as any[]) || [];
  const allOrders = (ordersQuery.data as any[]) || [];
  const allInvoices = (invoicesQuery.data as any[]) || [];
  const allPayments = (paymentsQuery.data as any[]) || [];
  const allDispatches = (dispatchQuery.data as any[]) || [];
  const allInstallations = (installationsQuery.data as any[]) || [];
  const allQcChecks = (qcQuery.data as any[]) || [];
  const allCommissioning = (commissioningQuery.data as any[]) || [];
  const allNetMetering = (netMeteringQuery.data as any[]) || [];
  const allSubsidy = (subsidyQuery.data as any[]) || [];
  const allHandovers = (handoversQuery.data as any[]) || [];
  const allAmc = (amcQuery.data as any[]) || [];
  const allServiceTickets = (ticketsQuery.data as any[]) || [];
  const allReadings = (monitoringQuery.data as any[]) || [];
  const isLoading = casesQuery.isLoading;

  // ── Search handler ────────────────────────────────────
  const handleSearch = useCallback(async () => {
    setSearching(true);
    setSearched(true);
    try {
      const opts: any = {};

      if (searchQuery.trim()) opts.query = searchQuery;
      if (statusFilter !== 'All Statuses') opts.status = statusFilter;
      if (stageFilter !== 'All Stages') opts.currentStage = stageFilter;
      if (healthFilter !== 'All Health') opts.health = healthFilter;
      if (customerTypeFilter !== 'All Types') opts.customerType = customerTypeFilter;
      if (leadSourceFilter !== 'All Sources') opts.leadSource = leadSourceFilter;
      if (dateFrom) opts.dateFrom = dateFrom;
      if (dateTo) opts.dateTo = dateTo;
      if (employeeFilter.trim()) opts.assignedEmployee = employeeFilter;
      if (companyFilter.trim()) opts.company = companyFilter;

      const { results: searchResults, summary: searchSummary } = await searchCases(
        allCases, allLeads, allCustomers, allProjects,
        allQuotations, allOrders, allInvoices, allPayments,
        allDispatches, allInstallations, allQcChecks,
        allCommissioning, allNetMetering, allSubsidy,
        allHandovers, allAmc, allServiceTickets, allReadings,
        opts,
      );

      setResults(searchResults);
      setSummary(searchSummary);
    } catch {
      setResults([]);
      setSummary(null);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, statusFilter, stageFilter, healthFilter, customerTypeFilter,
      leadSourceFilter, dateFrom, dateTo, employeeFilter,
      allCases, allLeads, allCustomers, allProjects,
      allQuotations, allOrders, allInvoices, allPayments,
      allDispatches, allInstallations, allQcChecks,
      allCommissioning, allNetMetering, allSubsidy,
      allHandovers, allAmc, allServiceTickets, allReadings]);

  // ── Export handler ────────────────────────────────────
  const handleExport = useCallback(() => {
    const exportData = results.map((r) => ({
      caseId: r.case.caseId || r.case.id,
      status: r.case.status,
      currentStage: r.case.currentStage,
      health: r.health,
      lead: r.lead?.name || '',
      customer: r.customer?.name || '',
      project: r.project?.projectName || '',
      createdBy: r.case.createdBy,
      createdAt: r.case.createdAt,
      updatedAt: r.case.updatedAt,
    }));
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `case-search-results-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  // ── Clear filters ─────────────────────────────────────
  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('All Statuses');
    setStageFilter('All Stages');
    setHealthFilter('All Health');
    setCustomerTypeFilter('All Types');
    setLeadSourceFilter('All Sources');
    setDateFrom('');
    setDateTo('');
    setEmployeeFilter('');
    setCompanyFilter('');
    setResults([]);
    setSummary(null);
    setSearched(false);
  }, []);

  // ── Table columns ─────────────────────────────────────
  const columns: TableColumn[] = useMemo(() => [
    {
      key: 'caseId',
      label: 'Case ID',
      render: (row: CaseSearchResult) => (
        <button
          type="button"
          onClick={() => navigate(`/cases/${encodeURIComponent(row.case.id)}`)}
          className="text-[var(--color-primary)] hover:underline font-mono text-xs font-semibold"
        >
          {row.case.caseId || row.case.id}
        </button>
      ),
    },
    {
      key: 'lead',
      label: 'Lead',
      render: (row: CaseSearchResult) => (
        <div className="flex items-center gap-1.5">
          {row.lead ? (
            <button
              type="button"
              onClick={() => navigate(`/leads/workspace/${encodeURIComponent(row.lead.id)}`)}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:underline truncate max-w-[120px] block"
            >
              {row.lead.name || row.lead.id}
            </button>
          ) : (
            <span className="text-xs text-[var(--color-text-disabled)]">—</span>
          )}
          {row.case.leadId && !row.lead && (
            <span className="text-[9px] text-[var(--color-text-disabled)] font-mono">orphan</span>
          )}
        </div>
      ),
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (row: CaseSearchResult) => (
        <div className="flex items-center gap-1.5">
          {row.customer ? (
            <button
              type="button"
              onClick={() => navigate(`/customers/${encodeURIComponent(row.customer.id)}`)}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:underline truncate max-w-[120px] block"
            >
              {row.customer.name || row.customer.id}
            </button>
          ) : (
            <span className="text-xs text-[var(--color-text-disabled)]">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'stage',
      label: 'Stage',
      render: (row: CaseSearchResult) => (
        <span className="inline-flex items-center rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
          {row.case.currentStage || 'New'}
        </span>
      ),
    },
    {
      key: 'health',
      label: 'Health',
      render: (row: CaseSearchResult) => {
        const colors: Record<string, string> = {
          healthy: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
          warning: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
          critical: 'text-red-600 bg-red-50 dark:bg-red-900/20',
          unknown: 'text-gray-500 bg-gray-50 dark:bg-gray-900/20',
        };
        return (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'inline-block h-2 w-2 rounded-full',
              row.health === 'healthy' ? 'bg-emerald-500' :
              row.health === 'warning' ? 'bg-amber-500' :
              row.health === 'critical' ? 'bg-red-500' : 'bg-gray-400',
            )} />
            <span className={cn('text-[10px] font-semibold rounded-full px-1.5 py-0.5', colors[row.health] || '')}>
              {row.health.charAt(0).toUpperCase() + row.health.slice(1)}
            </span>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (row: CaseSearchResult) => (
        <span className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
          row.case.status === 'Active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' :
          row.case.status === 'Completed' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' :
          row.case.status === 'Failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
          'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
        )}>
          {row.case.status || '—'}
        </span>
      ),
    },
    {
      key: 'matches',
      label: 'Matches',
      render: (row: CaseSearchResult) => (
        <div className="flex flex-wrap gap-0.5 max-w-[140px]">
          {row.matchFields.slice(0, 3).map((f) => (
            <span key={f} className="inline-flex items-center rounded-full bg-[var(--color-bg-sunken)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)]">
              {f}
            </span>
          ))}
          {row.matchFields.length > 3 && (
            <span className="text-[9px] text-[var(--color-text-muted)]">+{row.matchFields.length - 3}</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row: CaseSearchResult) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(`/cases/${encodeURIComponent(row.case.id)}`)}
            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-bg-sunken)] transition-colors"
            title="Open Case"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ], [navigate]);

  // ── Active filter count ───────────────────────────────
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'All Statuses') count++;
    if (stageFilter !== 'All Stages') count++;
    if (healthFilter !== 'All Health') count++;
    if (customerTypeFilter !== 'All Types') count++;
    if (leadSourceFilter !== 'All Sources') count++;
    if (dateFrom || dateTo) count++;
    if (employeeFilter.trim()) count++;
    if (companyFilter.trim()) count++;
    return count;
  }, [statusFilter, stageFilter, healthFilter, customerTypeFilter, leadSourceFilter, dateFrom, dateTo, employeeFilter]);

  return (
    <div className="space-y-5 animate-fadeIn pb-8">
      {/* Page Header */}
      <PageHeader
        title="Case Search"
        subtitle="Universal search across all Cases and linked entities"
        icon={<Search className="h-5 w-5" />}
        actions={
          results.length > 0 && (
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>
              Export Results
            </Button>
          )
        }
      />

      {/* ── Search Bar ───────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="Search by Case ID, lead name, customer name, project, stage, status..."
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-12 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            variant="primary"
            size="md"
            icon={searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            onClick={handleSearch}
            disabled={searching}
          >
            {searching ? 'Searching...' : 'Search'}
          </Button>
          <Button
            variant="outline"
            size="md"
            icon={<SlidersHorizontal className="h-4 w-4" />}
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={cn(activeFilterCount > 0 && 'ring-2 ring-[var(--color-primary)]/30')}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-[var(--color-primary)] text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {/* ── Advanced Filter Panel ───────────────────────── */}
        {showAdvanced && (
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 animate-fadeIn">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" /> Advanced Filters
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] font-semibold text-[var(--color-primary)] hover:underline"
              >
                Clear all
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Status */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                >
                  {STATUS_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              {/* Stage */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Current Stage</label>
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                >
                  {STAGE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              {/* Health */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Health</label>
                <select
                  value={healthFilter}
                  onChange={(e) => setHealthFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                >
                  {HEALTH_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              {/* Customer Type */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Customer Type</label>
                <select
                  value={customerTypeFilter}
                  onChange={(e) => setCustomerTypeFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                >
                  {CUSTOMER_TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              {/* Lead Source */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Lead Source</label>
                <select
                  value={leadSourceFilter}
                  onChange={(e) => setLeadSourceFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                >
                  {LEAD_SOURCE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              {/* Employee */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Employee</label>
                <input
                  type="text"
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  placeholder="Employee ID or name"
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                />
              </div>
              {/* Date From */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">From Date</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                />
              </div>
              {/* Date To */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">To Date</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                />
              </div>
              {/* Company */}
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Company</label>
                <input
                  type="text"
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                  placeholder="Company ID or name"
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── KPI Cards ────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <KPIStatCard label="Total Results" value={summary.totalResults} icon={<FolderKanban className="h-4 w-4" />} color="indigo" compact />
          <KPIStatCard label="Healthy" value={summary.healthyCount} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" compact />
          <KPIStatCard label="Warning" value={summary.warningCount} icon={<AlertTriangle className="h-4 w-4" />} color="amber" compact />
          <KPIStatCard label="Critical" value={summary.criticalCount} icon={<XCircle className="h-4 w-4" />} color="rose" compact />
          <KPIStatCard label="Completed" value={summary.completedCount} icon={<CheckCircle2 className="h-4 w-4" />} color="blue" compact />
        </div>
      )}

      {/* ── Quick Actions (when results exist) ───────────── */}
      {results.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Quick Actions:</span>
          <Button variant="outline" size="sm" icon={<FolderKanban className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/cases/${encodeURIComponent(results[0].case.id)}`)}>
            Open Case
          </Button>
          {results[0].lead && (
            <Button variant="outline" size="sm" icon={<Target className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/leads/workspace/${encodeURIComponent(results[0].lead.id)}`)}>
              Open Lead
            </Button>
          )}
          {results[0].customer && (
            <Button variant="outline" size="sm" icon={<Users className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/customers/${encodeURIComponent(results[0].customer.id)}`)}>
              Open Customer
            </Button>
          )}
          {results[0].project && (
            <Button variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/projects/${encodeURIComponent(results[0].project.id)}`)}>
              Open Project
            </Button>
          )}
        </div>
      )}

      {/* ── Results Table ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-[var(--color-primary)]" />
              Search Results
            </div>
          </CardTitle>
          {searched && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {results.length} case{results.length !== 1 ? 's' : ''} found
              {activeFilterCount > 0 && ` (${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''} active)`}
            </span>
          )}
        </CardHeader>
        <CardBody>
          {!searched ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
              <p className="text-sm text-[var(--color-text-muted)] font-medium">Search across all cases</p>
              <p className="text-xs text-[var(--color-text-disabled)] mt-1 max-w-md">
                Use the search bar above to find cases by Case ID, lead name, customer name,
                project name, stage, status, or any linked entity.
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <XCircle className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
              <p className="text-sm text-[var(--color-text-muted)] font-medium">No results found</p>
              <p className="text-xs text-[var(--color-text-disabled)] mt-1">Try a different search term or adjust your filters</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-3 text-xs text-[var(--color-primary)] hover:underline font-semibold"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={results}
              perPage={20}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
