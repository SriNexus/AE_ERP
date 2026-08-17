/**
 * DispatchDetail — Full-page workspace for a single Dispatch record
 *
 * Phase 1 — Module #7: Dispatch Workspace
 * Spec: 13 tabs, 24+ overview fields, 7 Quick Actions
 *
 * Named DispatchDetail to avoid conflict with existing DispatchWorkspace.tsx (list page).
 *
 * Tabs:
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 *   Tracking | Vehicle Details | Delivery Proof
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Truck,
  Calendar,
  User,
  Building2,
  Hash,
  ChevronRight,
  Clock,
  ArrowLeft,
  FileText,
  MapPin,
  Package,
  Phone,
  CreditCard,
  Map,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import toast from 'react-hot-toast';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { cn } from '../utils/cn';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { DISPATCH_TABS, buildDispatchQuickActions } from '../features/dispatch/utils/workspaceConfig';

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

function OverviewField({ label, value, icon: Icon, children }: {
  label: string;
  value?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3 transition-colors duration-150 hover:border-[var(--color-border)]">
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
    'Pending Verification': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    Approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    Dispatched: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    'In Transit': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    Delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
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

// ── Tracking Tab Content ───────────────────────────────────

function TrackingTab({ dispatch }: { dispatch?: Record<string, unknown> }) {
  const trackingUpdates = (dispatch as any)?.trackingUpdates as Array<Record<string, unknown>> | undefined;

  if (!trackingUpdates || trackingUpdates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
        <Map className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No tracking updates</p>
        <p className="text-xs mt-1">Tracking updates will appear once the dispatch is in transit.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-bg-sunken)]">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Location</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Remarks</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Updated By</th>
            </tr>
          </thead>
          <tbody>
            {trackingUpdates.map((update, idx) => (
              <tr key={idx} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-sunken)]/50">
                <td className="px-4 py-3">{fmtDateSafe(update.date || update.createdAt)}</td>
                <td className="px-4 py-3">{String(update.location || update.currentLocation || '—')}</td>
                <td className="px-4 py-3">{String(update.status || '—')}</td>
                <td className="px-4 py-3">{String(update.remarks || update.notes || '—')}</td>
                <td className="px-4 py-3">{String(update.updatedBy || '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Vehicle Details Tab Content ────────────────────────────

function VehicleDetailsTab({ dispatch }: { dispatch?: Record<string, unknown> }) {
  const d = dispatch as any;

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <OverviewField label="Vehicle Number" value={d?.vehicleNo || '—'} icon={Truck} />
        <OverviewField label="Driver Name" value={d?.driverName || '—'} icon={User} />
        <OverviewField label="Driver Phone" icon={Phone}>
          {d?.driverPhone ? (
            <a href={`tel:${d.driverPhone}`} className="text-[var(--color-primary)] hover:underline">{d.driverPhone}</a>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Transport Company" value={d?.transporterId || d?.transporter || '—'} icon={Building2} />
        <OverviewField label="LR Number" value={d?.lrNumber || '—'} icon={Hash} />
        <OverviewField label="Delivery OTP" value={d?.deliveryOTP || '—'} icon={ShieldCheck} />
      </div>
    </div>
  );
}

// ── Delivery Proof Tab Content ─────────────────────────────

function DeliveryProofTab({ dispatch }: { dispatch?: Record<string, unknown> }) {
  const d = dispatch as any;
  const deliveryPhotos = d?.deliveryPhotos as string[] | undefined;
  const deliveryConfirmed = d?.deliveryConfirmed;

  if (!deliveryConfirmed && !deliveryPhotos?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
        <ClipboardList className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No delivery proof available</p>
        <p className="text-xs mt-1">Delivery proof and photos will appear after delivery is confirmed.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {deliveryConfirmed && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              Delivery Confirmed
            </p>
          </div>
          {d?.deliveryConfirmedAt && (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              Confirmed on {fmtDateSafe(d.deliveryConfirmedAt)}
            </p>
          )}
        </div>
      )}

      {deliveryPhotos && deliveryPhotos.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-3">Delivery Photos ({deliveryPhotos.length})</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {deliveryPhotos.map((url, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => window.open(url, '_blank')}
                className="aspect-video rounded-xl overflow-hidden border border-[var(--color-border-subtle)] hover:border-[var(--color-primary)] transition-colors"
              >
                <img src={url} alt={`Delivery photo ${idx + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function DispatchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const dispatchQuery = useQuery({
    queryKey: [...qkeys.dispatchRoot, id],
    queryFn: () => getOne(COLLECTIONS.DISPATCH, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const ordersQuery = useQuery({
    queryKey: qkeys.ordersAll,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
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

  const invoicesQuery = useQuery({
    queryKey: qkeys.invoices,
    queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 30_000,
  });

  const dispatch = dispatchQuery.data as any;
  const orders = (ordersQuery.data as any[]) || [];
  const customers = (customersQuery.data as any[]) || [];
  const projects = (projectsQuery.data as any[]) || [];
  const invoices = (invoicesQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('dispatch');
  const canCreate = perms.canCreate('dispatch');
  const canViewPricing = perms.canViewPricing('dispatch');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('dispatch', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const customer = useMemo(() => {
    if (!dispatch) return null;
    return customers.find((c: any) => c.id === dispatch.customerId) || null;
  }, [dispatch, customers]);

  const linkedOrder = useMemo(() => {
    if (!dispatch) return null;
    return orders.find((o: any) => o.id === dispatch.orderId) || null;
  }, [dispatch, orders]);

  const linkedProject = useMemo(() => {
    if (!dispatch) return null;
    return projects.find((p: any) => p.id === dispatch.projectId) || null;
  }, [dispatch, projects]);

  const status = String(dispatch?.status || 'Pending Verification');
  const dispatchId = String(dispatch?.id || '—');
  const customerName = dispatch?.customer ? String(dispatch.customer) : (customer?.name ? String(customer.name) : '—');
  const orderId = dispatch?.orderId ? String(dispatch.orderId) : null;
  const projectId = dispatch?.projectId ? String(dispatch.projectId) : null;
  const warehouseId = dispatch?.warehouseId ? String(dispatch.warehouseId) : null;
  const caseId = dispatch?.caseId ? String(dispatch.caseId) : null;
  const vehicleNo = dispatch?.vehicleNo ? String(dispatch.vehicleNo) : null;
  const driverName = dispatch?.driverName ? String(dispatch.driverName) : null;
  const driverPhone = dispatch?.driverPhone ? String(dispatch.driverPhone) : null;
  const transporter = dispatch?.transporterId || dispatch?.transporter ? String(dispatch.transporterId || dispatch.transporter) : null;
  const lrNumber = dispatch?.lrNumber ? String(dispatch.lrNumber) : null;
  const priority = dispatch?.priority ? String(dispatch.priority) : null;
  const deliveryConfirmed = Boolean(dispatch?.deliveryConfirmed);
  const approvalStatus = dispatch?.approvalStatus ? String(dispatch.approvalStatus) : null;
  const packageCount = dispatch?.items ? (dispatch.items as any[]).length : 0;
  const totalQty = dispatch?.items
    ? (dispatch.items as any[]).reduce((sum: number, item: any) => sum + (Number(item.qty || item.quantity || 0)), 0)
    : 0;
  const materialValue = dispatch?.items
    ? (dispatch.items as any[]).reduce((sum: number, item: any) => sum + (Number(item.total || item.price || 0) * (Number(item.qty || item.quantity || 0))), 0)
    : 0;

  // ── Quick action handlers ────────────────────────────────
  // The Dispatch management popup was retired (Dispatch Workspace Migration) —
  // the Dispatch stage's OPERATIONAL workflow (edit, tracking, verify &
  // execute, delivery OTP, close) now lives inside the Project Workspace
  // (Stage 6 — Dispatch card, stages/ProjectDispatchWorkspace.tsx), so every
  // operational quick action deep-links there when the dispatch is
  // project-linked (falling back to this record page). The challan is a pure
  // document action and prints right here from the full record.
  async function printChallan() {
    const toastId = toast.loading('Generating challan...');
    try {
      const { company } = useAppStore.getState();
      const fullCompany = await getOne(COLLECTIONS.COMPANIES, dispatch?.companyId || company?.id) || company;
      const { DocumentTemplateResolver, triggerPrint } = await import('../templates/documents/resolver');
      const html = DocumentTemplateResolver(fullCompany as any, 'DISPATCH CHALLAN', dispatch);
      triggerPrint(html);
      toast.success('Challan ready', { id: toastId });
    } catch {
      toast.error('Failed to generate challan', { id: toastId });
    }
  }

  const operationalTarget = projectId ? `/projects/${encodeURIComponent(projectId)}` : `/dispatch/${encodeURIComponent(id || '')}`;
  const handlers = useMemo(() => ({
    onEdit: () => navigate(operationalTarget),
    onUpdateTracking: () => navigate(operationalTarget),
    onMarkInTransit: () => navigate(operationalTarget),
    onMarkDelivered: () => navigate(operationalTarget),
    onDownloadChallan: () => void printChallan(),
    onAssignDriver: () => navigate(operationalTarget),
    onCreateTask: () => navigate(`/tasks?create=1&entityType=dispatch&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id, operationalTarget]);

  const quickActions = useMemo(
    () => buildDispatchQuickActions({ canEdit, canCreate }, handlers),
    [canEdit, canCreate, handlers],
  );

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = useMemo(() => ({
    'tracking': <TrackingTab dispatch={dispatch} />,
    'vehicle-details': <VehicleDetailsTab dispatch={dispatch} />,
    'delivery-proof': <DeliveryProofTab dispatch={dispatch} />,
  }), [dispatch]);

  // ── Loading state ────────────────────────────────────────
  if (dispatchQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Dispatch..." icon={<Truck className="h-5 w-5" />} />
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
  if (!dispatch || dispatchQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <Truck className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Dispatch record not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {dispatchQuery.isError ? 'Failed to load dispatch details.' : 'This dispatch record does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/dispatch')}>
          Back to Dispatch
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Dispatch Information */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <OverviewField label="Dispatch Number" value={dispatchId} icon={Hash} />
        <OverviewField label="Status">
          <StatusBadge status={status} />
        </OverviewField>
        <OverviewField label="Approval Status" icon={FileText}>
          {approvalStatus ? <StatusBadge status={approvalStatus} /> : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Case ID" icon={Hash}>
          {caseId ? (
            <button
              type="button"
              onClick={() => navigate(`/cases/${encodeURIComponent(caseId)}`)}
              className="font-mono text-[var(--color-primary)] hover:underline"
            >
              {caseId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
      </div>

      {/* Customer & Order Links */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Customer" icon={User}>
          {customer ? (
            <button
              type="button"
              onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {customerName} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span>{customerName}</span>}
        </OverviewField>
        <OverviewField label="Order" icon={FileText}>
          {orderId ? (
            <button
              type="button"
              onClick={() => navigate(`/orders/${encodeURIComponent(orderId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {orderId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Project" icon={Building2}>
          {projectId ? (
            <button
              type="button"
              onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {projectId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Warehouse" value={warehouseId || '—'} icon={Building2} />
      </div>

      {/* Vehicle & Driver */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Vehicle Number" value={vehicleNo || '—'} icon={Truck} />
        <OverviewField label="Driver Name" value={driverName || '—'} icon={User} />
        <OverviewField label="Driver Contact" icon={Phone}>
          {driverPhone ? (
            <a href={`tel:${driverPhone}`} className="text-[var(--color-primary)] hover:underline">{driverPhone}</a>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Transport Company" value={transporter || '—'} icon={Building2} />
      </div>

      {/* Logistics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Dispatch Date" value={fmtDateSafe(dispatch.date || dispatch.createdAt)} icon={Calendar} />
        <OverviewField label="Expected Delivery" value={fmtDateSafe(dispatch.expectedDelivery || dispatch.deliveryDate)} icon={Calendar} />
        <OverviewField label="Priority" value={priority || 'Normal'} icon={Clock} />
        <OverviewField label="LR Number" value={lrNumber || '—'} icon={Hash} />
      </div>

      {/* Material */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Items Count" value={String(packageCount)} icon={Package} />
        <OverviewField label="Total Quantity" value={String(totalQty)} icon={Package} />
        {/* Phase 9: gated on view_pricing — Warehouse (the role that physically
            verifies/loads a dispatch) must not see its selling price. */}
        {canViewPricing && <OverviewField label="Material Value" value={materialValue > 0 ? fmtCurrencySafe(materialValue) : '—'} icon={CreditCard} />}
        <OverviewField label="Delivery Confirmed" icon={ShieldCheck}>
          {deliveryConfirmed ? (
            <span className="text-emerald-600 font-semibold">Yes</span>
          ) : <span className="text-[var(--color-text-muted)]">No</span>}
        </OverviewField>
      </div>

      {/* Delivery Address */}
      <div className="grid grid-cols-1 gap-3">
        <OverviewField label="Delivery Address" icon={MapPin}>
          {dispatch?.deliveryAddress ? String(dispatch.deliveryAddress) : '—'}
        </OverviewField>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Created By" value={String(dispatch?.createdBy || '—')} icon={User} />
        <OverviewField label="Assigned To" value={String(dispatch?.assignedToName || dispatch?.assignedToId || '—')} icon={User} />
        <OverviewField label="Last Updated" value={fmtDateSafe(dispatch.updatedAt || dispatch.createdAt)} icon={Clock} />
        <OverviewField label="Company" value={String(dispatch?.companyName || dispatch?.company || '—')} icon={Building2} />
      </div>

      {/* Notes */}
      {dispatch?.notes && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Dispatch Notes</p>
          <p className="mt-2 text-sm text-[var(--color-text)]">{String(dispatch.notes)}</p>
        </div>
      )}

      {/* Related Records Links */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Links & References</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {customer && (
            <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}>
              Customer Profile
            </Button>
          )}
          {projectId && (
            <Button variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>
              Project
            </Button>
          )}
          {orderId && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/orders/${encodeURIComponent(orderId)}`)}>
              Order Details
            </Button>
          )}
          {linkedOrder?.sourceQuotationId && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/quotations/${encodeURIComponent(linkedOrder.sourceQuotationId)}`)}>
              Source Quotation
            </Button>
          )}
          {invoices.filter((pi: any) => pi.orderId === orderId).length > 0 && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/invoices?orderId=${encodeURIComponent(orderId || '')}`)}>
              Invoices
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
        title={`Dispatch ${dispatchId}`}
        icon={<Truck className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/dispatch')}>Dispatch</Button>}
      />

      <WorkspaceShell
        header={{
          name: `Dispatch ${dispatchId}`,
          status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: dispatch?.createdAt ? String(dispatch.createdAt) : undefined,
          assignedTo: dispatch?.assignedToName ? { name: String(dispatch.assignedToName) } : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: DISPATCH_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'dispatch',
            companyId: activeCompanyId || '',
            record: dispatch as Record<string, unknown>,
            permissions: { canView: true, canCreate, canEdit, canDelete: false },
            caseId: caseId ?? undefined,
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
