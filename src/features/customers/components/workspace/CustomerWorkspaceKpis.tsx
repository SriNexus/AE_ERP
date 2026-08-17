/**
 * CustomerWorkspaceKpis — customer-type-aware KPI bar for the Customer
 * Workspace (Phase 1). Visual pattern matches LeadWorkspace.tsx's own KPI bar
 * exactly (same card treatment, same non-clickable informational design —
 * Lead's KPI bar has no click/filter behavior either, so this introduces no
 * fake navigation to the future Center Panel, per the Phase 1 architecture).
 *
 * B2B and B2C intentionally show a different KPI set — see the Customer
 * Workspace Master Plan §8.2. The Outstanding/Receivable KPI is deliberately
 * NOT included: Phase 0's verification confirmed it isn't a safe simple
 * calculation (two parallel invoice systems, refund-as-negative-payment
 * handling needed) and remains a held/deferred design item.
 *
 * Data: sourced from `useCustomerBillingContext` (extracted in Phase 2 so the
 * Center Panel shares the exact same customer-scoped, company-scoped queries
 * rather than duplicating them — React Query dedups by identical query key).
 *
 * KPI selection/calculation is a pure function (`buildCustomerKpiValues`),
 * deliberately separated from the query/render layer below it, so the
 * calculation logic (date sorting, active-order exclusion, empty states) is
 * unit-testable without rendering — see __tests__/customerWorkspaceKpis.test.ts.
 */
import {
  ShoppingCart, Calendar, IndianRupee, Activity, FileText, Clock,
  Zap, Building2, ListChecks,
} from 'lucide-react';
import { fmtCurrency, fmtDate } from '../../../../lib/firestore';
import { useCustomerBillingContext } from '../../hooks/useCustomerBillingContext';

export const ACTIVE_ORDER_STATUSES_EXCLUDED = new Set(['Delivered', 'Cancelled']);

export function sumField(rows: any[], field: string): number {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

export function mostRecentByDate(rows: any[], field: string): any | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => new Date(b[field] || 0).getTime() - new Date(a[field] || 0).getTime())[0];
}

export interface CustomerKpiInputs {
  isB2B: boolean;
  orders: any[]; ordersLoading: boolean;
  quotations: any[]; quotationsLoading: boolean;
  registrations: any[]; registrationsLoading: boolean;
  projects: any[]; projectsLoading: boolean;
  relationshipAgeDays: number | null;
}

export interface CustomerKpiValue { key: string; label: string; value: string }

/** Pure KPI selection + calculation — no React, no Firestore. */
export function buildCustomerKpiValues(input: CustomerKpiInputs): CustomerKpiValue[] {
  const {
    isB2B, orders, ordersLoading, quotations, quotationsLoading,
    registrations, registrationsLoading, projects, projectsLoading, relationshipAgeDays,
  } = input;

  const relationshipAge: CustomerKpiValue = {
    key: 'relationship-age', label: 'Relationship Age',
    value: relationshipAgeDays !== null ? `${relationshipAgeDays}d` : '—',
  };

  if (isB2B) {
    const lastOrder = mostRecentByDate(orders, 'date');
    const lastQuotation = mostRecentByDate(quotations, 'date');
    return [
      { key: 'order-count', label: 'Order Count', value: ordersLoading ? '…' : String(orders.length) },
      { key: 'active-orders', label: 'Active Orders', value: ordersLoading ? '…' : String(orders.filter((o) => !ACTIVE_ORDER_STATUSES_EXCLUDED.has(o.status)).length) },
      { key: 'order-value', label: 'Total Order Value', value: ordersLoading ? '…' : fmtCurrency(sumField(orders, 'total')) },
      { key: 'last-order', label: 'Last Order', value: ordersLoading ? '…' : (lastOrder ? fmtDate(lastOrder.date) : '—') },
      { key: 'last-quotation', label: 'Last Quotation', value: quotationsLoading ? '…' : (lastQuotation ? fmtDate(lastQuotation.date) : '—') },
      relationshipAge,
    ];
  }

  const latestProject = mostRecentByDate(projects, 'updatedAt');
  const latestRegistration = mostRecentByDate(registrations, 'updatedAt');
  return [
    { key: 'current-stage', label: 'Current Stage', value: projectsLoading ? '…' : (latestProject?.currentStage || 'No Project Yet') },
    { key: 'loan-application-status', label: 'Loan Application Status', value: registrationsLoading ? '…' : (latestRegistration?.status || 'Not Started') },
    { key: 'project-size', label: 'Project Size', value: projectsLoading ? '…' : (latestProject?.capacityKw ? `${latestProject.capacityKw} kW` : '—') },
    { key: 'project-count', label: 'Project Count', value: projectsLoading ? '…' : String(projects.length) },
    { key: 'loan-application-count', label: 'Loan Application Count', value: registrationsLoading ? '…' : String(registrations.length) },
    relationshipAge,
  ];
}

const KPI_ICONS: Record<string, React.ReactNode> = {
  'order-count': <ShoppingCart className="h-4 w-4" />,
  'active-orders': <ListChecks className="h-4 w-4" />,
  'order-value': <IndianRupee className="h-4 w-4" />,
  'last-order': <Calendar className="h-4 w-4" />,
  'last-quotation': <FileText className="h-4 w-4" />,
  'relationship-age': <Clock className="h-4 w-4" />,
  'current-stage': <Activity className="h-4 w-4" />,
  'loan-application-status': <FileText className="h-4 w-4" />,
  'project-size': <Zap className="h-4 w-4" />,
  'project-count': <Building2 className="h-4 w-4" />,
  'loan-application-count': <ListChecks className="h-4 w-4" />,
};

function KpiCard({ kpi }: { kpi: CustomerKpiValue }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-4 py-2.5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
        {KPI_ICONS[kpi.key]}
      </div>
      <div className="min-w-0">
        <span className="block text-base font-bold text-[var(--color-text)] leading-none truncate">{kpi.value}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{kpi.label}</span>
      </div>
    </div>
  );
}

export default function CustomerWorkspaceKpis({ customer }: { customer: any }) {
  const {
    isB2B, orders, ordersLoading, quotations, quotationsLoading,
    registrations, registrationsLoading, projects, projectsLoading,
  } = useCustomerBillingContext(customer);

  const relationshipAgeDays = customer.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(customer.createdAt).getTime()) / 86400000))
    : null;

  const kpis = buildCustomerKpiValues({
    isB2B, orders, ordersLoading, quotations, quotationsLoading,
    registrations, registrationsLoading, projects, projectsLoading, relationshipAgeDays,
  });

  return (
    <div className="grid shrink-0 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3">
      {kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
    </div>
  );
}
