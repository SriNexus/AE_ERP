/**
 * PurchaseOrdersWorkspace — Full-page workspace for a single Purchase Order
 *
 * Phase 4B — Purchase Orders Workspace
 * Route: /purchase-orders/:id
 *
 * Tabs (11):
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 *   Goods Receipts (module-specific)
 *
 * Overview Fields (30+):
 *   PO Info: PO Number, Status, PO Date, Expected Delivery, Approval Status
 *   Vendor: Vendor ID, Vendor Name, Contact Person, GSTIN
 *   Financial: Total, Tax, Discount, Grand Total, Payment Terms
 *   Procurement: Item Count, Qty Ordered, Qty Received, Remaining, Delivery Status
 *   Project: Linked Project, Project ID, Requirement Source
 *   GRN Stats: Total GRNs, Last GRN Date, Pending GRNs
 *   Audit: Created By, Approved By, Created At, Updated At
 *
 * Quick Actions (7): status-aware
 *   Edit PO (Draft), Approve PO (Draft), Cancel PO (Draft/Sent),
 *   Create GR (Sent/Partial), View Vendor, Export PO, Create Task
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { usePermissions } from '../lib/permissions';
import { cn } from '../utils/cn';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState, WorkspaceShell } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import {
  ShoppingCart, Package, Building2, User, Hash, Tag,
  DollarSign, Clock, FileText,
  ChevronRight, ArrowLeft, Activity, Download, Plus,
  TrendingUp, ClipboardCheck, Truck, Warehouse,
} from 'lucide-react';
import { PURCHASE_ORDER_TABS, buildPurchaseOrderQuickActions } from '../features/procurement/utils/purchaseOrderWorkspaceConfig';
import { usePurchaseOrderActions } from '../features/procurement/hooks/usePurchaseOrders';
import type { PurchaseOrderRecord, GoodsReceiptRecord } from '../features/procurement/types';

// ── Helpers ──────────────────────────────────────────────

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  try {
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? '—' : fmtDate(d);
  } catch { return '—'; }
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
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />}
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      </div>
      <div className="text-sm font-medium text-[var(--color-text)] break-words">
        {children ?? value ?? <span className="text-[var(--color-text-disabled)]">—</span>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const colorMap: Record<string, string> = {
    Draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
    Sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    PartiallyReceived: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    Received: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', colorMap[status] || 'bg-gray-100 text-gray-800')}>
      {status}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function PurchaseOrdersWorkspace() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const { transition: transitionPo } = usePurchaseOrderActions();

  // ── Tab state ──────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // ── Data queries ─────────────────────────────────────────
  const poQ = useQuery({
    queryKey: ['po-workspace', id],
    queryFn: () => getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const grsQ = useQuery({
    queryKey: qkeys.goodsReceipts,
    queryFn: () => getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  const po = poQ.data as PurchaseOrderRecord | undefined;
  const allGRs = (grsQ.data as GoodsReceiptRecord[]) || [];

  // ── Goods Receipts for this PO ───────────────────────────
  const linkedGRs = useMemo(() => {
    if (!po) return [];
    return allGRs.filter((gr) => gr.purchaseOrderId === po.id && !gr.isDeleted)
      .sort((a, b) => new Date(b.receivedDate || '').getTime() - new Date(a.receivedDate || '').getTime());
  }, [po, allGRs]);

  // ── Derived stats ─────────────────────────────────────────
  const stats = useMemo(() => {
    if (!po) return null;
    const totalQty = po.items.reduce((s, i) => s + (i.qty || 0), 0);
    const receivedQty = po.items.reduce((s, i) => s + (i.receivedQty || 0), 0);
    const remainingQty = totalQty - receivedQty;
    const lastGR = linkedGRs.length > 0 ? linkedGRs[0].receivedDate : null;
    const pendingGRs = po.status === 'Sent' || po.status === 'PartiallyReceived' ? 1 : 0;

    return {
      itemCount: po.items.length,
      totalQty,
      receivedQty,
      remainingQty,
      deliveryStatus: remainingQty <= 0 ? 'Complete' : receivedQty > 0 ? 'Partial' : 'Pending',
      totalGRNs: linkedGRs.length,
      lastGRDate: lastGR,
      pendingGRNs: pendingGRs,
    };
  }, [po, linkedGRs]);

  // ── Handlers ─────────────────────────────────────────────
  // The old Purchase Order view popup was retired — these quick actions now
  // use the REAL procurement services (transitionPurchaseOrder) instead of
  // deep-linking into the popup. Edit opens the list page's edit form modal
  // (?edit=); Approve (Draft → Sent) and Cancel use the exact transition
  // mutation the Purchase Orders module already exposes, which enforces the
  // transitions map, permission (approve) and statusHistory on every change.
  const refreshPo = () => qc.invalidateQueries({ queryKey: ['po-workspace', id] });
  const handlers = {
    onEdit: () => navigate(`/purchase-orders?edit=${encodeURIComponent(id || '')}`),
    onApprove: () => {
      if (po?.status === 'Draft') transitionPo.mutate({ id: po.id, status: 'Sent' }, { onSuccess: refreshPo });
    },
    onCancel: () => {
      if (po && window.confirm(`Cancel purchase order ${po.purchaseOrderId || id}?`)) {
        transitionPo.mutate({ id: po.id, status: 'Cancelled' }, { onSuccess: refreshPo });
      }
    },
    onCreateGR: () => navigate(`/goods-receipts?create=1&purchaseOrderId=${encodeURIComponent(id)}`),
    onViewVendor: () => {
      if (po?.vendorId) navigate(`/vendors/${encodeURIComponent(po.vendorId)}`);
    },
    onExport: () => {
      if (!po) return;
      const json = JSON.stringify(po, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `po-${po.purchaseOrderId || po.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onCreateTask: () => navigate(`/tasks?create=1&entityType=purchase_orders&entityId=${encodeURIComponent(id)}`),
  };

  // ── Quick Actions ────────────────────────────────────────
  const quickActions = useMemo(() => buildPurchaseOrderQuickActions(
    po || null,
    {
      canEdit: perms.canEdit('purchase_orders'),
      canApprove: perms.canApprove('purchase_orders'),
      canCreate: perms.canCreate('purchase_orders'),
      canExport: perms.canExport('purchase_orders'),
    },
    handlers,
  ), [po, perms, handlers]);

  // ── Loading state ────────────────────────────────────────
  if (poQ.isLoading) {
    return <div className="space-y-4 animate-pulse p-6">
      <div className="h-10 w-72 rounded-xl bg-[var(--color-bg-sunken)]" />
      <div className="h-96 rounded-2xl bg-[var(--color-bg-sunken)]" />
    </div>;
  }

  // ── Error / not found state ──────────────────────────────
  if (!po || poQ.isError) {
    return (
      <EmptyState
        title="Purchase Order not found"
        description={poQ.isError ? 'Failed to load PO details.' : 'This purchase order does not exist or has been deleted.'}
        action={<Link to="/purchase-orders"><Button variant="outline">Back to Purchase Orders</Button></Link>}
      />
    );
  }

  // ── Overview content ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* PO Information */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <ShoppingCart className="h-3.5 w-3.5" />
          Purchase Order Information
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="PO Number" icon={Hash} value={po.purchaseOrderId} />
          <OverviewField label="Status" icon={Activity}>
            <StatusBadge status={po.status} />
          </OverviewField>
          <OverviewField label="PO Date" icon={Clock} value={fmtDateSafe(po.orderDate)} />
          <OverviewField label="Expected Delivery" icon={Clock} value={fmtDateSafe(po.expectedDeliveryDate)} />
        </div>
      </div>

      {/* Vendor Information */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5" />
          Vendor Information
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Vendor ID" icon={Hash} value={po.vendorId} />
          <OverviewField label="Vendor Name" icon={Building2}>
            {po.vendorId ? (
              <button type="button" onClick={handlers.onViewVendor} className="text-[var(--color-primary)] hover:underline">
                {po.vendorName}
              </button>
            ) : po.vendorName}
          </OverviewField>
          <OverviewField label="Contact Person" icon={User} value={po.vendorName} />
          <OverviewField label="Vendor GSTIN" icon={Tag} value={po.vendorGstin} />
        </div>
      </div>

      {/* Financial Summary */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <DollarSign className="h-3.5 w-3.5" />
          Financial Summary
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Subtotal" icon={DollarSign} value={fmtCurrencySafe(po.subtotal)} />
          <OverviewField label="Tax Amount" icon={DollarSign} value={fmtCurrencySafe(po.taxTotal)} />
          <OverviewField label="Discount" icon={DollarSign} value={fmtCurrencySafe(po.discountTotal)} />
          <OverviewField label="Grand Total" icon={DollarSign} value={fmtCurrencySafe(po.total)} />
        </div>
      </div>

      {/* Procurement Details */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <ClipboardCheck className="h-3.5 w-3.5" />
          Procurement Details
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Item Count" icon={Package} value={stats?.itemCount || 0} />
          <OverviewField label="Qty Ordered" icon={Package} value={stats?.totalQty || 0} />
          <OverviewField label="Qty Received" icon={Truck} value={stats?.receivedQty || 0} />
          <OverviewField label="Remaining Qty" icon={ClipboardCheck} value={stats?.remainingQty || 0} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 mt-3">
          <OverviewField label="Delivery Status" icon={TrendingUp} value={stats?.deliveryStatus || 'Pending'} />
          {po.projectId && (
            <OverviewField label="Linked Project" icon={Package}>
              <button type="button" onClick={() => navigate(`/projects/${encodeURIComponent(po.projectId || '')}`)}
                className="text-[var(--color-primary)] hover:underline">
                {po.projectName || po.projectId}
              </button>
            </OverviewField>
          )}
          <OverviewField label="Req. Source" icon={FileText}>
            <span className="text-[var(--color-text-muted)]">Purchase Order</span>
          </OverviewField>
        </div>
      </div>

      {/* GRN Statistics */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <Warehouse className="h-3.5 w-3.5" />
          GRN Statistics
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Total GRNs" icon={Package} value={stats?.totalGRNs || 0} />
          <OverviewField label="Last GRN Date" icon={Clock} value={stats?.lastGRDate ? fmtDateSafe(stats.lastGRDate) : '—'} />
          <OverviewField label="Pending GRNs" icon={Clock} value={stats?.pendingGRNs || 0} />
          <OverviewField label="Payment Terms" icon={DollarSign}>
            <span className="text-[var(--color-text-muted)]">—</span>
          </OverviewField>
        </div>
      </div>

      {/* Audit */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          Audit Information
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Created By" icon={User} value={po.createdBy} />
          <OverviewField label="Created At" icon={Clock} value={fmtDateSafe(po.createdAt)} />
          <OverviewField label="Updated At" icon={Clock} value={fmtDateSafe(po.updatedAt)} />
          <OverviewField label="Company ID" icon={Hash} value={po.companyId} />
        </div>
      </div>
    </div>
  );

  // ── Goods Receipts tab content ────────────────────────────
  const goodsReceiptsTab = (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Goods Receipts ({linkedGRs.length})
        </h3>
        {(po.status === 'Sent' || po.status === 'PartiallyReceived') && perms.canCreate('purchase_orders') && (
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handlers.onCreateGR}>
            Create GR
          </Button>
        )}
      </div>
      {linkedGRs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Package className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">No goods receipts for this PO</p>
          {(po.status === 'Sent' || po.status === 'PartiallyReceived') && perms.canCreate('purchase_orders') && (
            <Button size="sm" className="mt-2" onClick={handlers.onCreateGR}>Create First GR</Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {linkedGRs.map((gr) => (
            <button
              key={gr.id}
              type="button"
              onClick={() => navigate(`/goods-receipts/${encodeURIComponent(gr.id)}`)}
              className="w-full flex items-center gap-4 rounded-xl border border-[var(--color-border-subtle)] px-4 py-3 text-left hover:bg-[var(--color-bg-sunken)] transition-colors"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/20 shrink-0">
                <Package className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text)]">{gr.goodsReceiptId || gr.id}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {gr.receivedItems?.length || 0} items
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {gr.warehouseName || '—'}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-[var(--color-text-disabled)]">{fmtDateSafe(gr.receivedDate)}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">{gr.receivedBy || '—'}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ── Module tab content map ──────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = {
    goods_receipts: goodsReceiptsTab,
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={po.purchaseOrderId || 'Purchase Order'}
        subtitle={`Procurement / PO · ${po.vendorName || ''}${po.total ? ` · ${fmtCurrencySafe(po.total)}` : ''}`}
        icon={<ShoppingCart className="h-5 w-5" />}
        actions={
          <Link to="/purchase-orders">
            <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}>
              Purchase Orders
            </Button>
          </Link>
        }
      />

      <WorkspaceShell
        header={{
          name: po.purchaseOrderId || 'Purchase Order',
          status: po.status,
          entityId: po.purchaseOrderId || po.id,
          createdAt: po.createdAt ? new Date(po.createdAt).toISOString() : undefined,
          updatedAt: po.updatedAt ? new Date(po.updatedAt).toISOString() : undefined,
          tags: [po.vendorName].filter(Boolean),
        }}
        quickActions={{
          actions: quickActions,
          permissions: {
            canView: true,
            canCreate: perms.canCreate('purchase_orders'),
            canEdit: perms.canEdit('purchase_orders'),
            canDelete: perms.canDelete('purchase_orders'),
          },
        }}
        tabs={{
          tabs: PURCHASE_ORDER_TABS,
          activeTab,
          onTabChange: (tabId) => setActiveTab(tabId as TabId),
          tabProps: {
            entityId: po.id,
            entityType: 'purchase_orders',
            companyId: activeCompanyId,
            record: po as unknown as Record<string, unknown>,
            permissions: {
              canView: true,
              canCreate: perms.canCreate('purchase_orders'),
              canEdit: perms.canEdit('purchase_orders'),
              canDelete: perms.canDelete('purchase_orders'),
            },
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
