/**
 * CasesWorkspace — Full-page workspace for a single Case record
 *
 * Phase 3D — Cases Workspace
 * Spec: 11 tabs, 30+ overview fields, 8+ Quick Actions
 *
 * Tabs:
 *   Overview (module-specific)
 *   Timeline (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 */

import { useMemo, useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FolderKanban,
  User,
  Building2,
  Calendar,
  Hash,
  ChevronRight,
  DollarSign,
  FileText,
  ShoppingCart,
  CreditCard,
  Truck,
  Wrench,
  ClipboardCheck,
  Zap,
  Gauge,
  PiggyBank,
  Handshake,
  Shield,
  Headphones,
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Clock,
  ArrowLeft,
  Users,
} from 'lucide-react';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { canDo } from '../lib/permissions';
import { cn } from '../utils/cn';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { CASE_TABS, buildCaseQuickActions } from '../features/cases/utils/workspaceConfig';
import { CaseTimelineTab } from '../features/cases/components/CaseTimelineTab';
import {
  validateCaseIntegrity,
  generateCaseHealthReport,
} from '../engines/CaseValidationEngine';

// ── Helpers ────────────────────────────────────────────────

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    return fmtDate(value.toDate());
  }
  if (typeof value === 'object' && value && 'seconds' in value) {
    return fmtDate(new Date(Number((value as { seconds: number }).seconds) * 1000));
  }
  return fmtDate(String(value));
}

function fmtCurrencySafe(value: unknown, symbol = '₹'): string {
  const num = Number(value) || 0;
  return fmtCurrency(num, symbol);
}

function OverviewField({ label, value, icon: Icon, children, highlight }: {
  label: string;
  value?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
  highlight?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div className={cn(
      'min-w-0 rounded-xl border px-4 py-3 transition-colors duration-150',
      highlight === 'success'
        ? 'border-emerald-200 dark:border-emerald-800/30 bg-emerald-50/50 dark:bg-emerald-900/10'
        : highlight === 'warning'
          ? 'border-amber-200 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-900/10'
          : highlight === 'danger'
            ? 'border-red-200 dark:border-red-800/30 bg-red-50/50 dark:bg-red-900/10'
            : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] hover:border-[var(--color-border)]',
    )}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />}
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      </div>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">
        {children ?? value ?? <span className="text-[var(--color-text-disabled)]">—</span>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const colorMap: Record<string, string> = {
    Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    Archived: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
  };
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      colorMap[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    )}>
      {status}
    </span>
  );
}

function HealthBadge({ health }: { health: 'healthy' | 'warning' | 'broken' | null }) {
  if (!health) return null;
  const config = {
    healthy: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', label: 'Healthy' },
    warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Warning' },
    broken: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Broken' },
  };
  const cfg = config[health];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold', cfg.color, cfg.bg)}>
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function CasesWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Health state ─────────────────────────────────────────
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'warning' | 'broken' | null>(null);
  const [validationResult, setValidationResult] = useState<string | null>(null);
  const [healthReportResult, setHealthReportResult] = useState<string | null>(null);

  // ── Data queries ─────────────────────────────────────────
  const caseQuery = useQuery({
    queryKey: ['cases', id],
    queryFn: () => getOne(COLLECTIONS.CASES, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const leadsQuery = useQuery({
    queryKey: qkeys.leadsRoot,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 60_000,
  });

  const customersQuery = useQuery({
    queryKey: qkeys.customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  const projectsQuery = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const quotationsQuery = useQuery({
    queryKey: qkeys.quotationsRoot,
    queryFn: () => getAll(COLLECTIONS.QUOTATIONS),
    staleTime: 60_000,
  });

  const ordersQuery = useQuery({
    queryKey: qkeys.ordersRoot,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });

  const invoicesQuery = useQuery({
    queryKey: qkeys.invoices,
    queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 60_000,
  });

  const paymentsQuery = useQuery({
    queryKey: qkeys.payments,
    queryFn: () => getAll(COLLECTIONS.PAYMENTS),
    staleTime: 60_000,
  });

  const dispatchQuery = useQuery({
    queryKey: qkeys.dispatchRoot,
    queryFn: () => getAll(COLLECTIONS.DISPATCH),
    staleTime: 60_000,
  });

  const caseRecord = caseQuery.data as any;
  const allLeads = (leadsQuery.data as any[]) || [];
  const allCustomers = (customersQuery.data as any[]) || [];
  const allProjects = (projectsQuery.data as any[]) || [];
  const allQuotations = (quotationsQuery.data as any[]) || [];
  const allOrders = (ordersQuery.data as any[]) || [];
  const allInvoices = (invoicesQuery.data as any[]) || [];
  const allPayments = (paymentsQuery.data as any[]) || [];
  const allDispatches = (dispatchQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const user = useAppStore(s => s.user);
  const canEdit = canDo('edit', 'dashboard');
  const canCreate = canDo('create', 'dashboard');
  const isAdmin = String((user as any)?.role || '').toLowerCase() === 'admin';

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('cases', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const caseId = caseRecord?.caseId || id || '';
  const status = String(caseRecord?.status || 'Active');
  const currentStage = String(caseRecord?.currentStage || 'New');
  const leadId = caseRecord?.leadId || null;
  const customerId = caseRecord?.customerId || null;

  // Resolve linked entities
  const lead = useMemo(() => {
    if (!leadId) return null;
    return allLeads.find((l: any) => l.id === leadId) || null;
  }, [leadId, allLeads]);

  const customer = useMemo(() => {
    // check caseRecord.customerId first, then fall back to lead's converted customer
    if (customerId) return allCustomers.find((c: any) => c.id === customerId) || null;
    if (lead?.sourceLeadId) {
      return allCustomers.find((c: any) => c.sourceLeadId === leadId) || null;
    }
    return null;
  }, [customerId, lead, leadId, allCustomers]);

  const project = useMemo(() => {
    if (!customer) return null;
    return allProjects.find((p: any) => p.customerId === customer.id) || null;
  }, [customer, allProjects]);

  const caseQuotations = useMemo(() => {
    return allQuotations.filter((q: any) => String(q.caseId || '') === caseId && !q.isDeleted);
  }, [allQuotations, caseId]);

  const caseOrders = useMemo(() => {
    return allOrders.filter((o: any) => String(o.caseId || '') === caseId && !o.isDeleted);
  }, [allOrders, caseId]);

  const caseInvoices = useMemo(() => {
    return allInvoices.filter((pi: any) => String(pi.caseId || '') === caseId && !pi.isDeleted);
  }, [allInvoices, caseId]);

  const casePayments = useMemo(() => {
    return allPayments.filter((p: any) => String(p.caseId || '') === caseId && !p.isDeleted);
  }, [allPayments, caseId]);

  const caseDispatches = useMemo(() => {
    return allDispatches.filter((d: any) => String(d.caseId || '') === caseId && !d.isDeleted);
  }, [allDispatches, caseId]);

  // Financial summary
  const totalRevenue = useMemo(() => {
    const orderTotal = caseOrders.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);
    const paymentTotal = casePayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
    return Math.max(orderTotal, paymentTotal);
  }, [caseOrders, casePayments]);

  // ── Health check handler ─────────────────────────────────
  const handleValidate = useCallback(async () => {
    if (!caseId) return;
    try {
      const result = await validateCaseIntegrity(caseId);
      const errorCount = result.totalErrors;
      if (errorCount === 0) {
        setHealthStatus('healthy');
        setValidationResult(`✅ Case is healthy — ${result.entityValidations.length} entities validated, 0 errors.`);
      } else if (errorCount <= 3) {
        setHealthStatus('warning');
        setValidationResult(`⚠️ Case has ${errorCount} issue(s). Run Health Report for details.`);
      } else {
        setHealthStatus('broken');
        setValidationResult(`❌ Case has ${errorCount} issues requiring attention.`);
      }
    } catch {
      setHealthStatus('broken');
      setValidationResult('Validation failed — could not check case integrity.');
    }
  }, [caseId]);

  const handleHealthReport = useCallback(async () => {
    if (!caseId) return;
    try {
      const report = await generateCaseHealthReport();
      setHealthReportResult(
        `Cases: ${report.totalCases} | Healthy: ${report.healthyCases} | Broken: ${report.brokenCases} | ` +
        `Orphans: ${report.orphanEntities} | Duplicates: ${report.duplicateCases} | ` +
        `Missing caseIds: ${report.missingCaseIds}`
      );
    } catch {
      setHealthReportResult('Failed to generate health report.');
    }
  }, [caseId]);

  // ── Quick action handlers ────────────────────────────────
  const handlers = useMemo(() => ({
    onValidate: handleValidate,
    onViewLead: () => leadId ? navigate(`/leads/workspace/${encodeURIComponent(leadId)}`) : undefined,
    onViewCustomer: () => {
      const cid = customer?.id || customerId;
      if (cid) navigate(`/customers/${encodeURIComponent(cid)}`);
    },
    onViewProject: () => project ? navigate(`/projects/${encodeURIComponent(project.id)}`) : undefined,
    onViewTimeline: () => workspace.setActiveTab('timeline' as any),
    onExportCase: () => {
      const json = JSON.stringify(caseRecord, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `case-${caseId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onCreateTask: () => navigate(`/tasks?create=1&entityType=cases&entityId=${encodeURIComponent(id || '')}`),
    onGenerateHealthReport: handleHealthReport,
    onRunRepair: () => {
      if (window.confirm(`Run repair on Case ${caseId}? This will fix missing/wrong caseIds. (Dry-run by default)`)) {
        import('../engines/CaseValidationEngine').then(({ repairCaseChain }) => {
          repairCaseChain(caseId || '', { dryRun: true }).then((summary) => {
            const msg = summary.repairsApplied.length === 0
              ? 'No repairs needed — chain is intact.'
              : `Dry-run: ${summary.repairsApplied.length} repairs would be applied. Run with dryRun:false to execute.`;
            setValidationResult(msg);
          });
        });
      }
    },
  }), [handleValidate, handleHealthReport, leadId, customerId, customer, project, caseRecord, caseId, navigate, id, workspace]);

  const quickActions = useMemo(
    () => buildCaseQuickActions(
      { canEdit, canCreate, canApprove: isAdmin },
      handlers,
    ),
    [canEdit, canCreate, isAdmin, handlers],
  );

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = useMemo(() => ({
    'timeline': <CaseTimelineTab caseId={caseId} />,
  }), [caseId]);

  // ── Loading state ────────────────────────────────────────
  if (caseQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Case..." icon={<FolderKanban className="h-5 w-5" />} />
        <div className="flex-1 p-6 space-y-4">
          <div className="h-8 w-64 bg-[var(--color-bg-sunken)] rounded-md animate-pulse" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-20 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────
  if (!caseRecord || caseQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <FolderKanban className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Case not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {caseQuery.isError ? 'Failed to load case details.' : 'This case does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  // ── Overview section (30+ fields) ─────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Health status banner */}
      {validationResult && (
        <div className={cn(
          'rounded-xl border p-4 text-sm',
          healthStatus === 'healthy' ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-800 dark:text-emerald-200' :
          healthStatus === 'warning' ? 'border-amber-200 bg-amber-50 dark:bg-amber-900/10 text-amber-800 dark:text-amber-200' :
          'border-red-200 bg-red-50 dark:bg-red-900/10 text-red-800 dark:text-red-200',
        )}>
          <div className="flex items-start gap-2">
            {healthStatus === 'healthy' ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> :
             healthStatus === 'warning' ? <AlertTriangle className="h-4 w-4 mt-0.5" /> :
             <AlertTriangle className="h-4 w-4 mt-0.5" />}
            <div>
              <p className="font-semibold">{validationResult}</p>
              {healthReportResult && <p className="mt-1 text-xs opacity-80">{healthReportResult}</p>}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1 — Case Information */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Case Information</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Case ID" value={caseId} icon={Hash} />
          <OverviewField label="Status">
            <StatusBadge status={status} />
          </OverviewField>
          <OverviewField label="Current Stage" icon={Activity}>
            <span className="font-semibold text-[var(--color-primary)]">{currentStage}</span>
          </OverviewField>
          <OverviewField label="Health">
            <HealthBadge health={healthStatus} />
          </OverviewField>
          <OverviewField label="Created At" value={fmtDateSafe(caseRecord.createdAt)} icon={Calendar} />
          <OverviewField label="Updated At" value={fmtDateSafe(caseRecord.updatedAt)} icon={Clock} />
        </div>
      </div>

      {/* SECTION 2 — Lead Information */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Lead Information</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Lead ID" icon={User}>
            {leadId ? (
              <button type="button" onClick={() => navigate(`/leads/workspace/${encodeURIComponent(leadId)}`)}
                className="text-[var(--color-primary)] hover:underline font-mono">
                {leadId} <ChevronRight className="inline h-3 w-3" />
              </button>
            ) : <span className="text-[var(--color-text-disabled)]">—</span>}
          </OverviewField>
          <OverviewField label="Lead Name" value={lead?.name ? String(lead.name) : '—'} icon={User} />
          <OverviewField label="Lead Source" icon={Hash}>
            {lead?.source ? String(lead.source) : (lead?.leadSource ? String(lead.leadSource) : '—')}
          </OverviewField>
          <OverviewField label="Lead Status" value={lead?.status ? String(lead.status) : '—'} icon={Hash} />
        </div>
      </div>

      {/* SECTION 3 — Customer Information */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Customer Information</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Customer ID" icon={Users}>
            {customer ? (
              <button type="button" onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}
                className="text-[var(--color-primary)] hover:underline font-mono">
                {customer.id} <ChevronRight className="inline h-3 w-3" />
              </button>
            ) : <span className="text-[var(--color-text-disabled)]">—</span>}
          </OverviewField>
          <OverviewField label="Customer Name" value={customer?.name ? String(customer.name) : '—'} icon={Users} />
          <OverviewField label="Customer Type" icon={Building2}>
            {customer?.type ? String(customer.type) : (customer?.customerType ? String(customer.customerType) : '—')}
          </OverviewField>
          <OverviewField label="Contact Number" icon={Hash}>
            {customer?.phone ? String(customer.phone) : (customer?.mobile ? String(customer.mobile) : '—')}
          </OverviewField>
        </div>
      </div>

      {/* SECTION 4 — Project Information */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Project Information</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Project ID" icon={Building2}>
            {project ? (
              <button type="button" onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
                className="text-[var(--color-primary)] hover:underline font-mono">
                {project.id} <ChevronRight className="inline h-3 w-3" />
              </button>
            ) : <span className="text-[var(--color-text-disabled)]">—</span>}
          </OverviewField>
          <OverviewField label="Project Name" value={project?.projectName ? String(project.projectName) : '—'} icon={Building2} />
          <OverviewField label="System Size" icon={Zap}>
            {project?.systemCapacityKw ? `${Number(project.systemCapacityKw)} kW` : '—'}
          </OverviewField>
          <OverviewField label="Installation Status" icon={Wrench}>
            {project?.currentStage ? String(project.currentStage) : '—'}
          </OverviewField>
        </div>
      </div>

      {/* SECTION 5 — Financial */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Financial Summary</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Quotation Count" icon={FileText}>
            <span className="font-semibold">{caseQuotations.length}</span>
          </OverviewField>
          <OverviewField label="Order Count" icon={ShoppingCart}>
            <span className="font-semibold">{caseOrders.length}</span>
          </OverviewField>
          <OverviewField label="Payment Count" icon={CreditCard}>
            <span className="font-semibold">{casePayments.length}</span>
          </OverviewField>
          <OverviewField label="Total Revenue" icon={DollarSign}>
            <span className="font-bold text-[var(--color-primary)]">{fmtCurrencySafe(totalRevenue)}</span>
          </OverviewField>
        </div>
      </div>

      {/* SECTION 6 — EPC Progress */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">EPC Progress</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Dispatch Status" icon={Truck}>
            {caseDispatches.length > 0 ? String(caseDispatches[0]?.status || 'In Progress') : 'Not Started'}
          </OverviewField>
          <OverviewField label="QC Status" icon={ClipboardCheck}>
            {caseRecord?.currentStage === 'QC' || caseRecord?.currentStage === 'Commissioning' ? 'Pending' :
             caseRecord?.currentStage === 'Installation' ? 'Not Required' : '—'}
          </OverviewField>
          <OverviewField label="Commissioning Status" icon={Zap}>
            {caseRecord?.currentStage === 'Commissioning' || ['NetMetering','Subsidy','Handover','AMC','Service','Monitoring','Closure'].includes(caseRecord?.currentStage) ? 'Completed' :
             caseRecord?.currentStage === 'QC' ? 'Pending' : 'Not Started'}
          </OverviewField>
          <OverviewField label="Net Metering Status" icon={Gauge}>
            {['Subsidy','Handover','AMC','Service','Monitoring','Closure'].includes(caseRecord?.currentStage) ? 'Completed' :
             caseRecord?.currentStage === 'NetMetering' ? 'In Progress' : 'Not Started'}
          </OverviewField>
          <OverviewField label="Subsidy Status" icon={PiggyBank}>
            {['Handover','AMC','Service','Monitoring','Closure'].includes(caseRecord?.currentStage) ? 'Completed' :
             caseRecord?.currentStage === 'Subsidy' ? 'In Progress' : 'Not Started'}
          </OverviewField>
          <OverviewField label="Handover Status" icon={Handshake}>
            {['AMC','Service','Monitoring','Closure'].includes(caseRecord?.currentStage) ? 'Completed' :
             caseRecord?.currentStage === 'Handover' ? 'In Progress' : 'Not Started'}
          </OverviewField>
          <OverviewField label="AMC Status" icon={Shield}>
            {['Service','Monitoring','Closure'].includes(caseRecord?.currentStage) ? 'Active' :
             caseRecord?.currentStage === 'AMC' ? 'Pending' : 'Not Started'}
          </OverviewField>
          <OverviewField label="Service Ticket Count" icon={Headphones}>
            <span className="font-semibold">—</span>
          </OverviewField>
          <OverviewField label="Monitoring Status" icon={Activity}>
            {caseRecord?.currentStage === 'Closure' || caseRecord?.currentStage === 'Monitoring' ? 'Active' : 'Not Started'}
          </OverviewField>
        </div>
      </div>

      {/* SECTION 7 — Audit */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Audit</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Company ID" value={caseRecord.companyId || '—'} icon={Building2} />
          <OverviewField label="Created By" icon={User}>
            {caseRecord.createdBy ? String(caseRecord.createdBy) : '—'}
          </OverviewField>
          <OverviewField label="Last Validated" icon={Clock}>
            {validationResult ? 'Via manual validation' : 'Not yet validated'}
          </OverviewField>
          <OverviewField label="Validation Result" icon={Hash}>
            {healthStatus ? <HealthBadge health={healthStatus} /> : <span className="text-[var(--color-text-disabled)]">—</span>}
          </OverviewField>
        </div>
      </div>

      {/* Links & References */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Links & References</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {lead && (
            <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/leads/workspace/${encodeURIComponent(lead.id)}`)}>
              Lead
            </Button>
          )}
          {customer && (
            <Button variant="outline" size="sm" icon={<Users className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}>
              Customer
            </Button>
          )}
          {project && (
            <Button variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}>
              Project
            </Button>
          )}
          {caseQuotations.length > 0 && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/quotations?caseId=${encodeURIComponent(caseId)}`)}>
              Quotations ({caseQuotations.length})
            </Button>
          )}
          {caseOrders.length > 0 && (
            <Button variant="outline" size="sm" icon={<ShoppingCart className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/orders?caseId=${encodeURIComponent(caseId)}`)}>
              Orders ({caseOrders.length})
            </Button>
          )}
          {caseInvoices.length > 0 && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/invoices?caseId=${encodeURIComponent(caseId)}`)}>
              Invoices ({caseInvoices.length})
            </Button>
          )}
          {casePayments.length > 0 && (
            <Button variant="outline" size="sm" icon={<CreditCard className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/payments?caseId=${encodeURIComponent(caseId)}`)}>
              Payments ({casePayments.length})
            </Button>
          )}
          {caseDispatches.length > 0 && (
            <Button variant="outline" size="sm" icon={<Truck className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/dispatch?caseId=${encodeURIComponent(caseId)}`)}>
              Dispatches ({caseDispatches.length})
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={`Case ${caseId}`}
        icon={<FolderKanban className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/')}>
            Dashboard
          </Button>
        }
      />

      <WorkspaceShell
        header={{
          name: `Case ${caseId}`,
          status,
          entityId: id || '',
          createdAt: caseRecord?.createdAt ? String(caseRecord.createdAt) : undefined,
          updatedAt: caseRecord?.updatedAt ? String(caseRecord.updatedAt) : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false, canApprove: isAdmin },
        }}
        tabs={{
          tabs: CASE_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'cases',
            companyId: activeCompanyId || '',
            record: caseRecord as Record<string, unknown>,
            permissions: { canView: true, canCreate, canEdit, canDelete: false },
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
