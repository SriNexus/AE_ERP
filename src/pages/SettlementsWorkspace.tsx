/**
 * SettlementsWorkspace — Full-page workspace for a single Settlement record
 *
 * Phase 2E.4 — Settlements Workspace
 * Spec: 10 tabs (Overview + 9 universal), 25+ overview fields, 7 status-aware quick actions
 *
 * Settlement is a FINANCE entity. No Case Engine. No module-specific tabs.
 *
 * Tabs:
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 */

import { useMemo, useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign,
  Hash,
  User,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  PlayCircle,
  Ban,
  RefreshCw,
  FileText,
  Activity,
} from 'lucide-react';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { cn } from '../utils/cn';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { SETTLEMENT_TABS, buildSettlementQuickActions } from '../features/settlements/utils/workspaceConfig';
import { processSettlementBatch, cancelSettlement, retrySettlement } from '../lib/channelPartnerSettlement';
import type { SettlementRecord } from '../features/channel-partner/types';
import toast from 'react-hot-toast';

// ── Helpers ────────────────────────────────────────────────

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return fmtDate((value as any).toDate());
  }
  if (typeof value === 'object' && value && 'seconds' in (value as any)) {
    return fmtDate(new Date(Number((value as any).seconds) * 1000));
  }
  return fmtDate(String(value));
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

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const label = STATUS_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      STATUS_STYLES[s] || 'bg-gray-100 text-gray-600',
    )}>
      {label}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function SettlementsWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const settlementQuery = useQuery({
    queryKey: ['settlements', activeCompanyId, id],
    queryFn: () => getOne(COLLECTIONS.SETTLEMENTS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const partnersQuery = useQuery({
    queryKey: ['channel_partners', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
  });

  const commissionsQuery = useQuery({
    queryKey: ['commission_records', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 60_000,
  });

  const settlement = settlementQuery.data as SettlementRecord | undefined;
  const allPartners = (partnersQuery.data as any[]) || [];
  const allCommissions = (commissionsQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('partners');
  const canCreate = perms.canCreate('partners');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('settlements', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const partner = useMemo(() => {
    if (!settlement) return null;
    return allPartners.find((p: any) => p.id === settlement.partnerId) || null;
  }, [settlement, allPartners]);

  const linkedCommissions = useMemo(() => {
    if (!settlement) return [];
    return allCommissions.filter((c: any) =>
      settlement.commissionIds?.includes(c.id) && !c.isDeleted
    );
  }, [settlement, allCommissions]);

  const partnerName = partner?.firmName || partner?.contactPerson || String(settlement?.partnerName || settlement?.partnerId || '—');
  const status = String(settlement?.status || 'pending').toLowerCase();
  const totalAmount = Number(settlement?.totalAmount || 0);
  const commissionCount = Number(settlement?.commissionCount || settlement?.commissionIds?.length || 0);
  const successCount = Number(settlement?.successCount || 0);
  const skippedCount = Number(settlement?.skippedCount || 0);
  const failedCount = Number(settlement?.failedCount || 0);
  const hasResult = successCount > 0 || skippedCount > 0 || failedCount > 0;

  // ── Quick action handlers ────────────────────────────────
  const [processing, setProcessing] = useState(false);

  const handleProcess = useCallback(async () => {
    if (!id) return;
    setProcessing(true);
    try {
      const result = await processSettlementBatch(id);
      qc.invalidateQueries({ queryKey: ['settlements'] });
      qc.invalidateQueries({ queryKey: ['commission_records'] });
      qc.invalidateQueries({ queryKey: ['channel_partners'] });
      toast.success(`Settlement processed: ${result.success} success, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to process settlement');
    } finally {
      setProcessing(false);
    }
  }, [id, qc]);

  const handleRetry = useCallback(async () => {
    if (!id) return;
    setProcessing(true);
    try {
      await retrySettlement(id);
      qc.invalidateQueries({ queryKey: ['settlements'] });
      qc.invalidateQueries({ queryKey: ['commission_records'] });
      toast.success('Settlement retry initiated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to retry settlement');
    } finally {
      setProcessing(false);
    }
  }, [id, qc]);

  const handleCancel = useCallback(async () => {
    if (!id) return;
    try {
      await cancelSettlement(id, 'Cancelled from workspace');
      qc.invalidateQueries({ queryKey: ['settlements'] });
      toast.success('Settlement cancelled');
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel settlement');
    }
  }, [id, qc]);

  const handlers = useMemo(() => ({
    onProcess: handleProcess,
    onRetry: handleRetry,
    onCancel: handleCancel,
    onViewPartner: () => {
      if (settlement?.partnerId) navigate(`/partners/${encodeURIComponent(settlement.partnerId)}`);
    },
    onViewCommissionRecords: () => {
      if (id) navigate(`/partners/commission-approvals?settlementId=${encodeURIComponent(id)}`);
    },
    onExportSettlement: () => {
      if (!settlement) return;
      const headers = ['ID', 'Partner', 'Amount', 'Status', 'Commissions', 'Success', 'Skipped', 'Failed', 'Created'];
      const row = [settlement.id, partnerName, totalAmount, status, commissionCount, successCount, skippedCount, failedCount, fmtDateSafe(settlement.createdAt)];
      const csv = [headers.join(','), row.map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(',')].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
      a.download = `settlement-${(settlement.id || 'unknown').slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    onCreateTask: () => navigate(`/tasks?create=1&entityType=settlements&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id, settlement, partnerName, totalAmount, status, commissionCount, successCount, skippedCount, failedCount, handleProcess, handleRetry, handleCancel]);

  const quickActions = useMemo(
    () => buildSettlementQuickActions({ canEdit, canCreate }, status, handlers),
    [canEdit, canCreate, status, handlers],
  );

  // ── Loading state ────────────────────────────────────────
  if (settlementQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Settlement..." icon={<DollarSign className="h-5 w-5" />} />
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
  if (!settlement || settlementQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <DollarSign className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Settlement not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {settlementQuery.isError ? 'Failed to load settlement details.' : 'This record does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/partners/settlements')}>
          Back to Settlements
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Section 1 — Settlement Information */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Settlement ID" value={id || '—'} icon={Hash} />
        <OverviewField label="Status">
          <StatusBadge status={status} />
        </OverviewField>
        <OverviewField label="Created At" value={fmtDateSafe(settlement?.createdAt)} icon={Calendar} />
        <OverviewField label="Updated At" value={fmtDateSafe(settlement?.updatedAt || settlement?.createdAt)} icon={Clock} />
      </div>

      {/* Section 2 — Partner Information */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Partner Information</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Partner ID" value={String(settlement?.partnerId || '—')} icon={Hash} />
          <OverviewField label="Partner Name" icon={User}>
            <button
              type="button"
              onClick={() => settlement?.partnerId && navigate(`/partners/${encodeURIComponent(settlement.partnerId)}`)}
              className="text-sm font-medium text-[var(--color-primary)] hover:underline"
            >
              {partnerName}
            </button>
          </OverviewField>
          <OverviewField label="Partner Type" icon={Building2}>
            {partner?.tier ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 capitalize">
                {String(partner.tier)}
              </span>
            ) : '—'}
          </OverviewField>
          <OverviewField label="Wallet Balance" icon={DollarSign}>
            {partner?.walletBalance !== undefined ? fmtCurrency(Number(partner.walletBalance)) : '—'}
          </OverviewField>
        </div>
      </div>

      {/* Section 3 — Financial Summary */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Financial Summary</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Total Amount" icon={DollarSign}>
            <span className="font-bold text-lg text-[var(--color-primary)]">{fmtCurrency(totalAmount)}</span>
          </OverviewField>
          <OverviewField label="Commission Count" value={String(commissionCount)} icon={Hash} />
          <OverviewField label="Success Count" icon={CheckCircle2}>
            {hasResult ? (
              <span className="font-semibold text-emerald-600">{successCount}</span>
            ) : <span className="text-[var(--color-text-disabled)]">—</span>}
          </OverviewField>
          <OverviewField label="Failed Count" icon={XCircle}>
            {hasResult ? (
              <span className={`font-semibold ${failedCount > 0 ? 'text-red-600' : 'text-[var(--color-text-disabled)]'}`}>{failedCount}</span>
            ) : <span className="text-[var(--color-text-disabled)]">—</span>}
          </OverviewField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-3">
          <OverviewField label="Skipped Count" icon={AlertTriangle}>
            {hasResult ? String(skippedCount) : '—'}
          </OverviewField>
          <OverviewField label="Processing Result" icon={Activity}>
            {hasResult ? (
              <span className={`text-xs font-semibold ${failedCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {failedCount > 0 ? `${successCount}/${commissionCount} completed` : 'All completed'}
              </span>
            ) : <span className="text-[var(--color-text-disabled)]">Not processed</span>}
          </OverviewField>
        </div>
      </div>

      {/* Section 4 — Processing Information */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Processing Information</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Processed By" value={String(settlement?.processedBy || '—')} icon={User} />
          <OverviewField label="Processed At" value={settlement?.processedAt ? fmtDateSafe(settlement.processedAt) : '—'} icon={Calendar} />
          <OverviewField label="Completed At" value={settlement?.completedAt ? fmtDateSafe(settlement.completedAt) : '—'} icon={Calendar} />
          <OverviewField label="Failed At" value={settlement?.failedAt ? fmtDateSafe(settlement.failedAt) : '—'} icon={Calendar} />
        </div>
      </div>

      {/* Section 5 — Failure / Cancellation Information */}
      {(settlement?.failureReason || settlement?.cancellationReason) && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
            {status === 'failed' ? 'Failure Information' : status === 'cancelled' ? 'Cancellation Information' : 'Notes'}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {settlement?.failureReason && (
              <OverviewField label="Failure Reason" icon={AlertTriangle}>
                <span className="text-red-600">{String(settlement.failureReason)}</span>
              </OverviewField>
            )}
            {settlement?.cancellationReason && (
              <OverviewField label="Cancellation Reason" value={String(settlement.cancellationReason)} icon={Ban} />
            )}
            {settlement?.cancelledBy && (
              <OverviewField label="Cancelled By" value={String(settlement.cancelledBy)} icon={User} />
            )}
            {settlement?.cancelledAt && (
              <OverviewField label="Cancelled At" value={fmtDateSafe(settlement.cancelledAt)} icon={Calendar} />
            )}
          </div>
        </div>
      )}

      {/* Section 6 — Audit Information */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Audit Information</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Created By" value={String(settlement?.createdBy || '—')} icon={User} />
          <OverviewField label="Company" icon={Building2}>
            {settlement?.companyId ? String(settlement.companyId) : '—'}
          </OverviewField>
          <OverviewField label="Is Deleted" icon={AlertTriangle}>
            {settlement?.isDeleted ? 'Yes' : 'No'}
          </OverviewField>
          <OverviewField label="Last Updated" value={fmtDateSafe(settlement?.updatedAt || settlement?.createdAt)} icon={Clock} />
        </div>
      </div>

      {/* Section 7 — Migration Information */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Migration Information</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Wallet Transaction ID" icon={Hash}>
            {settlement?.walletTransactionId ? (
              <span className="font-mono text-xs text-[var(--color-primary)]">
                {String(settlement.walletTransactionId).slice(0, 14)}...
              </span>
            ) : '—'}
          </OverviewField>
          <OverviewField label="Legacy Source Available" icon={FileText}>
            <span className="text-xs">partner_wallet_transactions</span>
          </OverviewField>
        </div>
      </div>

      {/* Section 8 — Links & References */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Links & References</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {settlement?.partnerId && (
            <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/partners/${encodeURIComponent(settlement.partnerId || '')}`)}>
              View Partner
            </Button>
          )}
          <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/partners/commission-approvals?settlementId=${encodeURIComponent(id || '')}`)}>
            Commission Records ({linkedCommissions.length})
          </Button>
          {processing && (
            <span className="inline-flex items-center gap-1 text-xs text-blue-600">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Processing...
            </span>
          )}
        </div>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={`Settlement ${(id || '').slice(0, 10)}...`}
        icon={<DollarSign className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/partners/settlements')}>Settlements</Button>}
      />

      <WorkspaceShell
        header={{
          name: `Settlement ${partnerName}`,
          status: (STATUS_LABELS[status] || status).charAt(0).toUpperCase() + (STATUS_LABELS[status] || status).slice(1),
          entityId: id || '',
          createdAt: settlement?.createdAt ? String(settlement.createdAt) : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: SETTLEMENT_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'settlements',
            companyId: activeCompanyId || '',
            record: settlement as unknown as Record<string, unknown>,
            permissions: { canView: true, canCreate, canEdit, canDelete: false },
          },
          overview,
        }}
      />
    </div>
  );
}
