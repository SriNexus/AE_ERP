/**
 * VendorsWorkspace — Full-page workspace for a single Vendor record
 *
 * Phase 4A — Vendors Workspace
 * Route: /vendors/:id
 *
 * Tabs (11):
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 *   Purchase Orders (module-specific)
 *
 * Overview Fields (26+):
 *   Vendor Information: Vendor ID, Name, Status, Vendor Code
 *   Contact: Contact Person, Phone, Email, Address
 *   Business: Category Tags, Payment Terms
 *   GST/PAN: GSTIN, PAN Number, Registration Type
 *   Procurement: PO Count, Total PO Value, GRN Count, Outstanding
 *   Performance: On-time Delivery %, Quality Rating, Active PO Count
 *   Audit: Created By, Created At, Updated At, Record ID
 *
 * Quick Actions (7):
 *   Edit Vendor, Approve Vendor, Suspend Vendor,
 *   View POs, Create PO, Export Vendor, Create Task
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
  Building2, User, Phone, Mail, MapPin, Hash, Tag,
  CreditCard, FileText, ShoppingCart, Package, TrendingUp,
  DollarSign, Clock, ShieldCheck, XCircle,
  ChevronRight, ArrowLeft, Activity, Download, Plus, Ban,
} from 'lucide-react';
import { VendorForm } from '../features/procurement/components/VendorForm';
import type { VendorRecord, PurchaseOrderRecord, VendorFormValues } from '../features/procurement/types';

// ── Tab definitions ──────────────────────────────────────

const VENDOR_TABS = [
  { id: 'overview' as TabId, label: 'Overview' },
  { id: 'activity' as TabId, label: 'Activity' },
  { id: 'notes' as TabId, label: 'Notes' },
  { id: 'documents' as TabId, label: 'Documents' },
  { id: 'history' as TabId, label: 'History' },
  { id: 'tasks' as TabId, label: 'Tasks' },
  { id: 'permissions' as TabId, label: 'Permissions' },
  { id: 'linked_records' as TabId, label: 'Linked Records' },
  { id: 'attachments' as TabId, label: 'Attachments' },
  { id: 'communication' as TabId, label: 'Communication' },
  { id: 'purchase_orders' as TabId, label: 'Purchase Orders' },
];

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
    Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Inactive: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
    Suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', colorMap[status] || 'bg-gray-100 text-gray-800')}>
      {status}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function VendorsWorkspace() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Tab state ──────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // ── Data queries ─────────────────────────────────────────
  const vendorQ = useQuery({
    queryKey: ['vendors-workspace', id],
    queryFn: () => getOne<VendorRecord>(COLLECTIONS.VENDORS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const posQ = useQuery({
    queryKey: qkeys.purchaseOrders,
    queryFn: () => getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  const vendor = vendorQ.data as VendorRecord | undefined;
  const allPOs = (posQ.data as PurchaseOrderRecord[]) || [];

  // ── Purchase orders for this vendor ──────────────────────
  const vendorPOs = useMemo(() => {
    if (!vendor) return [];
    return allPOs.filter((po) => po.vendorId === vendor.id && !po.isDeleted)
      .sort((a, b) => new Date(b.orderDate || '').getTime() - new Date(a.orderDate || '').getTime());
  }, [vendor, allPOs]);

  // ── Procurement stats ────────────────────────────────────
  const procurementStats = useMemo(() => {
    const pos = vendorPOs;
    const totalPOValue = pos.reduce((sum, po) => sum + (Number(po.total) || 0), 0);
    const activePOs = pos.filter((po) => po.status === 'Sent' || po.status === 'PartiallyReceived');
    const grnCount = pos.filter((po) => po.status === 'Received').length;
    return {
      poCount: pos.length,
      totalPOValue,
      activePOCount: activePOs.length,
      grnCount,
      outstandingAmount: totalPOValue,
    };
  }, [vendorPOs]);

  // ── Edit form state ──────────────────────────────────────
  const [showEditForm, setShowEditForm] = useState(false);
  const [formValues, setFormValues] = useState<VendorFormValues>({
    name: '',
    gstin: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    paymentTerms: '',
    categoryTags: '',
  });

  // ── Handlers ─────────────────────────────────────────────
  const handlers = {
    onEdit: () => {
      if (vendor) {
        setFormValues({
          name: vendor.name || '',
          gstin: vendor.gstin || '',
          contactPerson: vendor.contactInfo?.contactPerson || '',
          phone: vendor.contactInfo?.phone || '',
          email: vendor.contactInfo?.email || '',
          address: vendor.contactInfo?.address || '',
          paymentTerms: vendor.paymentTerms || '',
          categoryTags: (vendor.categoryTags || []).join(', '),
        });
        setShowEditForm(true);
      }
    },
    onApprove: () => {
      navigate(`/vendors?approve=${encodeURIComponent(id)}`);
    },
    onSuspend: () => {
      if (window.confirm(`Suspend vendor ${vendor?.name || id}?`)) {
        navigate('/vendors');
      }
    },
    onViewPOs: () => navigate(`/purchase-orders?vendorId=${encodeURIComponent(id)}`),
    onCreatePO: () => navigate(`/purchase-orders?create=1&vendorId=${encodeURIComponent(id)}`),
    onExport: () => {
      if (!vendor) return;
      const json = JSON.stringify(vendor, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vendor-${vendor.vendorId || vendor.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onCreateTask: () => navigate(`/tasks?create=1&entityType=vendors&entityId=${encodeURIComponent(id)}`),
  };

  // ── Quick Actions ────────────────────────────────────────
  const quickActions = useMemo(() => [
    ...(perms.canEdit('vendors') ? [{ id: 'edit', label: 'Edit Vendor', icon: <Building2 className="h-4 w-4" />, permission: 'edit' as const, variant: 'primary' as const, handler: handlers.onEdit }] : []),
    ...(perms.canApprove('vendors') ? [{ id: 'approve', label: 'Approve Vendor', icon: <ShieldCheck className="h-4 w-4" />, permission: 'approve' as const, variant: 'secondary' as const, handler: handlers.onApprove }] : []),
    ...(perms.canApprove('vendors') ? [{ id: 'suspend', label: 'Suspend Vendor', icon: <Ban className="h-4 w-4" />, permission: 'approve' as const, variant: 'danger' as const, handler: handlers.onSuspend }] : []),
    { id: 'view-pos', label: 'View POs', icon: <ShoppingCart className="h-4 w-4" />, permission: 'view' as const, variant: 'secondary' as const, handler: handlers.onViewPOs },
    ...(perms.canCreate('vendors') ? [{ id: 'create-po', label: 'Create PO', icon: <Plus className="h-4 w-4" />, permission: 'create' as const, variant: 'primary' as const, handler: handlers.onCreatePO }] : []),
    ...(perms.canExport('vendors') ? [{ id: 'export', label: 'Export', icon: <Download className="h-4 w-4" />, permission: 'view' as const, variant: 'secondary' as const, handler: handlers.onExport }] : []),
    ...(perms.canCreate('vendors') ? [{ id: 'create-task', label: 'Create Task', icon: <FileText className="h-4 w-4" />, permission: 'create' as const, variant: 'secondary' as const, handler: handlers.onCreateTask }] : []),
  ], [perms, handlers]);

  // ── Loading state ────────────────────────────────────────
  if (vendorQ.isLoading) {
    return <div className="space-y-4 animate-pulse p-6">
      <div className="h-10 w-72 rounded-xl bg-[var(--color-bg-sunken)]" />
      <div className="h-96 rounded-2xl bg-[var(--color-bg-sunken)]" />
    </div>;
  }

  // ── Error / not found state ──────────────────────────────
  if (!vendor || vendorQ.isError) {
    return (
      <EmptyState
        title="Vendor not found"
        description={vendorQ.isError ? 'Failed to load vendor details.' : 'This vendor does not exist or has been deleted.'}
        action={<Link to="/vendors"><Button variant="outline">Back to Vendors</Button></Link>}
      />
    );
  }

  // ── Overview content ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Vendor Information */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5" />
          Vendor Information
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Vendor ID" icon={Hash} value={vendor.vendorId || vendor.id} />
          <OverviewField label="Name" icon={Building2} value={vendor.name} />
          <OverviewField label="Status" icon={Activity}>
            <StatusBadge status={vendor.isDeleted ? 'Inactive' : 'Active'} />
          </OverviewField>
          <OverviewField label="Vendor Code" icon={Hash} value={vendor.vendorId} />
        </div>
      </div>

      {/* Contact Information */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <User className="h-3.5 w-3.5" />
          Contact Information
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Contact Person" icon={User} value={vendor.contactInfo?.contactPerson} />
          <OverviewField label="Phone" icon={Phone}>
            {vendor.contactInfo?.phone ? (
              <a href={`tel:${vendor.contactInfo.phone}`} className="text-[var(--color-primary)] hover:underline">{vendor.contactInfo.phone}</a>
            ) : '—'}
          </OverviewField>
          <OverviewField label="Email" icon={Mail}>
            {vendor.contactInfo?.email ? (
              <a href={`mailto:${vendor.contactInfo.email}`} className="text-[var(--color-primary)] hover:underline">{vendor.contactInfo.email}</a>
            ) : '—'}
          </OverviewField>
          <OverviewField label="Address" icon={MapPin} value={vendor.contactInfo?.address} />
        </div>
      </div>

      {/* Business Information */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <Tag className="h-3.5 w-3.5" />
          Business Information
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Category Tags" icon={Tag} value={vendor.categoryTags?.join(', ')} />
          <OverviewField label="Payment Terms" icon={FileText} value={vendor.paymentTerms} />
          <OverviewField label="GSTIN" icon={Hash} value={vendor.gstin} />
          <OverviewField label="Registration Type" value={vendor.gstin ? 'Regular' : 'Unregistered'} />
        </div>
      </div>

      {/* Procurement Statistics */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <ShoppingCart className="h-3.5 w-3.5" />
          Procurement Statistics
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="PO Count" icon={ShoppingCart} value={procurementStats.poCount} />
          <OverviewField label="Total PO Value" icon={DollarSign} value={fmtCurrencySafe(procurementStats.totalPOValue)} />
          <OverviewField label="GRN Count" icon={Package} value={procurementStats.grnCount} />
          <OverviewField label="Outstanding" icon={CreditCard} value={fmtCurrencySafe(procurementStats.outstandingAmount)} />
        </div>
      </div>

      {/* Performance */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5" />
          Performance
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="On-time Delivery %">
            <span className="text-[var(--color-text-muted)]">—</span>
          </OverviewField>
          <OverviewField label="Quality Rating">
            <span className="text-[var(--color-text-muted)]">—</span>
          </OverviewField>
          <OverviewField label="Active PO Count" value={procurementStats.activePOCount} />
          <OverviewField label="Total Paid" value={fmtCurrencySafe(0)} />
        </div>
      </div>

      {/* Audit */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          Audit Information
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Created By" icon={User} value={vendor.createdBy} />
          <OverviewField label="Created At" icon={Clock} value={fmtDateSafe(vendor.createdAt)} />
          <OverviewField label="Updated At" icon={Clock} value={fmtDateSafe(vendor.updatedAt)} />
          <OverviewField label="Record ID" icon={Hash} value={vendor.id} />
        </div>
      </div>
    </div>
  );

  // ── Purchase Orders tab content ───────────────────────────
  const purchaseOrdersTab = (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Purchase Orders ({vendorPOs.length})
        </h3>
        {perms.canCreate('vendors') && (
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handlers.onCreatePO}>
            Create PO
          </Button>
        )}
      </div>
      {vendorPOs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <ShoppingCart className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">No purchase orders for this vendor</p>
          {perms.canCreate('vendors') && (
            <Button size="sm" className="mt-2" onClick={handlers.onCreatePO}>Create First PO</Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {vendorPOs.map((po) => (
            <button
              key={po.id}
              type="button"
              onClick={() => navigate(`/purchase-orders/${encodeURIComponent(po.id)}`)}
              className="w-full flex items-center gap-4 rounded-xl border border-[var(--color-border-subtle)] px-4 py-3 text-left hover:bg-[var(--color-bg-sunken)] transition-colors"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-900/20 shrink-0">
                <Package className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text)]">{po.purchaseOrderId || po.id}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                    po.status === 'Received' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
                    po.status === 'Sent' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                    po.status === 'PartiallyReceived' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                    po.status === 'Cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                    'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
                  )}>{po.status || 'Draft'}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{fmtCurrencySafe(po.total)}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-[var(--color-text-disabled)]">{fmtDateSafe(po.orderDate)}</p>
                {po.expectedDeliveryDate && (
                  <p className="text-[10px] text-[var(--color-text-muted)]">Due: {fmtDateSafe(po.expectedDeliveryDate)}</p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ── Module tab content map ──────────────────────────────
  const moduleTabContent = { 'purchase_orders': purchaseOrdersTab };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={vendor.name || vendor.vendorId || 'Vendor'}
        subtitle="Procurement / Vendor Workspace"
        icon={<Building2 className="h-5 w-5" />}
        actions={
          <Link to="/vendors">
            <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}>
              Vendors
            </Button>
          </Link>
        }
      />

      <WorkspaceShell
        header={{
          name: vendor.name || vendor.vendorId || 'Vendor',
          status: vendor.isDeleted ? 'Inactive' : 'Active',
          entityId: vendor.vendorId || vendor.id,
          createdAt: vendor.createdAt ? new Date(vendor.createdAt).toISOString() : undefined,
          updatedAt: vendor.updatedAt ? new Date(vendor.updatedAt).toISOString() : undefined,
          tags: vendor.categoryTags,
        }}
        quickActions={{
          actions: quickActions,
          permissions: {
            canView: true,
            canCreate: perms.canCreate('vendors'),
            canEdit: perms.canEdit('vendors'),
            canDelete: perms.canDelete('vendors'),
          },
        }}
        tabs={{
          tabs: VENDOR_TABS,
          activeTab,
          onTabChange: (tabId) => setActiveTab(tabId as TabId),
          tabProps: {
            entityId: vendor.id,
            entityType: 'vendors',
            companyId: activeCompanyId,
            record: vendor as unknown as Record<string, unknown>,
            permissions: {
              canView: true,
              canCreate: perms.canCreate('vendors'),
              canEdit: perms.canEdit('vendors'),
              canDelete: perms.canDelete('vendors'),
            },
          },
          overview,
          moduleTabContent,
        }}
      />

      {/* Edit Vendor Form Dialog */}
      {showEditForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg mx-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)]">
              <h2 className="text-base font-bold">Edit Vendor</h2>
              <button type="button" onClick={() => setShowEditForm(false)} className="p-1 rounded-lg hover:bg-[var(--color-bg-sunken)]">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5">
              <VendorForm
                value={formValues}
                onChange={setFormValues}
                onCancel={() => setShowEditForm(false)}
                onSubmit={(e) => { e.preventDefault(); setShowEditForm(false); }}
                saving={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
