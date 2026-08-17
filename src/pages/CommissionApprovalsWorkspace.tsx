/**
 * CommissionApprovalsWorkspace — Full-page workspace for a single Commission Record (Approval)
 *
 * Phase 2D — Commission Approvals Workspace
 * Spec: 10 tabs (Overview + 9 universal), 20+ overview fields, 7 quick actions
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
  FileText,
  ArrowLeft,
  Building2,
  Percent,
  Tag,
  AlertTriangle,

} from 'lucide-react';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { cn } from '../utils/cn';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input, Textarea } from '../components/ui/Input';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { COMMISSION_APPROVAL_TABS, buildCommissionApprovalQuickActions } from '../features/commission-approvals/utils/workspaceConfig';
import { approveCommissionRecord } from '../lib/partnerLeadIntegration';
import type { CommissionRecord } from '../features/channel-partner/types';
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
  calculated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  paid: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  voided: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const label = s.charAt(0).toUpperCase() + s.slice(1);
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

export default function CommissionApprovalsWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  // ── Modal state ─────────────────────────────────────────
  const [approveAmount, setApproveAmount] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);

  // ── Data queries ─────────────────────────────────────────
  const recordQuery = useQuery({
    queryKey: ['commission_records', activeCompanyId, id],
    queryFn: () => getOne(COLLECTIONS.COMMISSION_RECORDS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const partnersQuery = useQuery({
    queryKey: ['channel_partners', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
  });

  const rulesQuery = useQuery({
    queryKey: ['commission_rules', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RULES),
    staleTime: 60_000,
  });

  const record = recordQuery.data as CommissionRecord | undefined;
  const allPartners = (partnersQuery.data as any[]) || [];
  const allRules = (rulesQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('partners');
  const canCreate = perms.canCreate('partners');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('commission-approvals', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const partner = useMemo(() => {
    if (!record) return null;
    return allPartners.find((p: any) => p.id === record.partnerId) || null;
  }, [record, allPartners]);

  const rule = useMemo(() => {
    if (!record) return null;
    return allRules.find((r: any) => r.id === record.ruleId) || null;
  }, [record, allRules]);

  const status = String(record?.status || 'pending').toLowerCase();
  const isPending = status === 'pending';
  const isApproved = status === 'approved' || status === 'paid';
  const isRejected = status === 'voided';

  const rawRecord = record as any;
  const partnerName = rawRecord?.partnerName ? String(rawRecord.partnerName) : (partner?.firmName || partner?.contactPerson || rawRecord?.partnerId || '—');
  const partnerTier = partner?.tier ? String(partner.tier) : null;
  const ruleName = record?.ruleName ? String(record.ruleName) : (rule?.name || '—');
  const leadId = record?.leadId ? String(record.leadId) : null;
  const commissionAmount = Number(record?.approvedAmount || record?.amount || 0);
  const dealValue = Number(record?.dealValue || 0);
  const systemSizeKW = Number(record?.systemSizeKW || 0);
  const ruleType = String(record?.ruleType || rule?.type || '');
  const ruleValue = Number(record?.ruleValue || rule?.value || 0);

  // ── Quick action handlers ────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!id) return;
    try {
      await approveCommissionRecord(id, true, {
        approvedAmount: approveAmount ? Number(approveAmount) : undefined,
      });
      qc.invalidateQueries({ queryKey: ['commission_records'] });
      toast.success('Commission approved');
      setShowApprove(false);
      setApproveAmount('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve');
    }
  }, [id, approveAmount, qc]);

  const handleReject = useCallback(async () => {
    if (!id) return;
    if (!rejectReason) {
      toast.error('Rejection reason is required');
      return;
    }
    try {
      await approveCommissionRecord(id, false, { rejectionReason: rejectReason });
      qc.invalidateQueries({ queryKey: ['commission_records'] });
      toast.success('Commission rejected');
      setShowReject(false);
      setRejectReason('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject');
    }
  }, [id, rejectReason, qc]);

  const handlers = useMemo(() => ({
    onApprove: () => {
      setApproveAmount(String(record?.amount || ''));
      setShowApprove(true);
    },
    onReject: () => {
      setRejectReason('');
      setShowReject(true);
    },
    onViewPartner: () => {
      if (record?.partnerId) navigate(`/partners/${encodeURIComponent(record.partnerId)}`);
    },
    onViewRule: () => {
      if (record?.ruleId) navigate(`/partners/commission-rules/${encodeURIComponent(record.ruleId)}`);
    },
    onViewRecord: () => {
      if (record?.leadId) navigate(`/leads/workspace/${encodeURIComponent(record.leadId)}`);
    },
    onExportRecord: () => {
      if (!record) return;
      const headers = ['ID', 'Partner', 'Rule', 'Lead', 'Amount', 'Status', 'Generated', 'Approved At'];
      const row = [record.id, partnerName, ruleName, leadId || '', commissionAmount, status, fmtDateSafe(record.generatedDate || record.createdAt), fmtDateSafe(record.approvedAt)];
      const csv = [headers.join(','), row.map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(',')].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
      a.download = `commission-approval-${(record.id || 'unknown').slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    onCreateTask: () => navigate(`/tasks?create=1&entityType=commission_records&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id, record, partnerName, ruleName, leadId, commissionAmount, status]);

  const quickActions = useMemo(
    () => buildCommissionApprovalQuickActions({ canEdit, canCreate }, status, handlers),
    [canEdit, canCreate, status, handlers],
  );

  // ── Loading state ────────────────────────────────────────
  if (recordQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Approval..." icon={<DollarSign className="h-5 w-5" />} />
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
  if (!record || recordQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <DollarSign className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Commission Approval not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {recordQuery.isError ? 'Failed to load approval details.' : 'This record does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/partners/commission-approvals')}>
          Back to Approvals
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Section 1 — Approval Information */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <OverviewField label="Approval ID" value={id || '—'} icon={Hash} />
        <OverviewField label="Status">
          <StatusBadge status={status} />
        </OverviewField>
        <OverviewField label="Partner" icon={User}>
          <span>{partnerName}</span>
          {partnerTier && (
            <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 capitalize">
              {partnerTier}
            </span>
          )}
        </OverviewField>
        <OverviewField label="Lead" icon={FileText}>
          {leadId ? (
            <button
              type="button"
              onClick={() => navigate(`/leads/workspace/${encodeURIComponent(leadId)}`)}
              className="font-mono text-xs text-[var(--color-primary)] hover:underline"
            >
              {leadId}
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
      </div>

      {/* Section 2 — Commission Information */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Commission Details</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Rule Name" value={ruleName} icon={Tag} />
          <OverviewField label="Rule Type" value={ruleType ? ruleType.replace(/_/g, ' ') : '—'} icon={Percent} />
          <OverviewField label="Rule Value" icon={Percent}>
            {ruleType === 'percentage' ? `${ruleValue}%` : ruleValue > 0 ? fmtCurrency(ruleValue) : '—'}
          </OverviewField>
          <OverviewField label="System Size" icon={Tag}>
            {systemSizeKW > 0 ? `${systemSizeKW} kW` : '—'}
          </OverviewField>
        </div>
      </div>

      {/* Section 3 — Financial */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Commission Amount" icon={DollarSign}>
          <span className="font-bold text-lg text-[var(--color-primary)]">{fmtCurrency(commissionAmount)}</span>
        </OverviewField>
        <OverviewField label="Approved Amount" icon={DollarSign}>
          {record?.approvedAmount ? (
            <span className="font-semibold text-emerald-600">{fmtCurrency(record.approvedAmount)}</span>
          ) : isApproved ? fmtCurrency(commissionAmount) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Deal Value" value={dealValue > 0 ? fmtCurrency(dealValue) : '—'} icon={DollarSign} />
        <OverviewField label="Calculation Model" icon={FileText}>
          {record?.calculationBreakdown ? 'Detailed' : 'Standard'}
        </OverviewField>
      </div>

      {/* Section 4 — Approval Lifecycle */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Approval Lifecycle</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Generated Date" value={fmtDateSafe(record.generatedDate || record.createdAt)} icon={Calendar} />
          <OverviewField label="Approved At" value={record?.approvedAt ? fmtDateSafe(record.approvedAt) : '—'} icon={Calendar} />
          <OverviewField label="Approved By" icon={User}>
            {record?.approvedBy ? String(record.approvedBy) : '—'}
          </OverviewField>
          <OverviewField label="Rejection Reason" icon={AlertTriangle}>
            {record?.rejectionReason ? String(record.rejectionReason) : '—'}
          </OverviewField>
        </div>
      </div>

      {/* Section 5 — Settlement Status */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Paid At" value={record?.paidAt ? fmtDateSafe(record.paidAt) : '—'} icon={Calendar} />
        <OverviewField label="Paid By" value={record?.paidBy ? String(record.paidBy) : '—'} icon={User} />
        <OverviewField label="Payment Reference" icon={Hash}>
          {record?.paymentReference ? String(record.paymentReference) : '—'}
        </OverviewField>
        <OverviewField label="Wallet Transaction" icon={Hash}>
          {record?.walletTransactionId ? (
            <span className="font-mono text-xs text-[var(--color-primary)]">
              {String(record.walletTransactionId).slice(0, 12)}...
            </span>
          ) : '—'}
        </OverviewField>
      </div>

      {/* Section 6 — Metadata */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Created By" value={String(record?.createdBy || '—')} icon={User} />
        <OverviewField label="Created At" value={fmtDateSafe(record?.createdAt)} icon={Calendar} />
        <OverviewField label="Company" icon={Building2}>
          {record?.companyId ? String(record.companyId) : '—'}
        </OverviewField>
        <OverviewField label="Updated At" value={fmtDateSafe(record?.updatedAt || record?.createdAt)} icon={Clock} />
      </div>

      {/* Section 7 — Links & References */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Links & References</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {record?.partnerId && (
            <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/partners/${encodeURIComponent(record.partnerId || '')}`)}>
              View Partner
            </Button>
          )}
          {leadId && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/leads/workspace/${encodeURIComponent(leadId)}`)}>
              View Lead
            </Button>
          )}
          {record?.ruleId && (
            <Button variant="outline" size="sm" icon={<Percent className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/partners/commission-rules/${encodeURIComponent(record.ruleId || '')}`)}>
              View Rule
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
        title={`Approval ${(id || '').slice(0, 10)}...`}
        icon={<DollarSign className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/partners/commission-approvals')}>Approvals</Button>}
      />

      <WorkspaceShell
        header={{
          name: `Commission ${partnerName}`,
          status: status.charAt(0).toUpperCase() + status.slice(1),
          entityId: id || '',
          createdAt: record?.createdAt ? String(record.createdAt) : undefined,
          assignedTo: record?.approvedBy ? { name: record.approvedBy } : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: COMMISSION_APPROVAL_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'commission_records',
            companyId: activeCompanyId || '',
            record: record as unknown as Record<string, unknown>,
            permissions: { canView: true, canCreate, canEdit, canDelete: false },
          },
          overview,
        }}
      />

      {/* ── Approve Modal ───────────────────────────────────── */}
      <Modal
        open={showApprove}
        onClose={() => { setShowApprove(false); setApproveAmount(''); }}
        title="Approve Commission"
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 p-4 text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-300">Confirm Commission Approval</p>
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              Partner: {partnerName}<br />
              Rule: {ruleName}<br />
              Current Amount: {fmtCurrency(commissionAmount)}
            </p>
          </div>
          <Input
            label="Approved Amount (₹)"
            type="number"
            value={approveAmount}
            onChange={(e) => setApproveAmount(e.target.value)}
            placeholder={`Default: ${commissionAmount}`}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowApprove(false); setApproveAmount(''); }}>
              Cancel
            </Button>
            <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} onClick={handleApprove}>
              Approve Commission
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Reject Modal ────────────────────────────────────── */}
      <Modal
        open={showReject}
        onClose={() => { setShowReject(false); setRejectReason(''); }}
        title="Reject Commission"
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-4 text-sm">
            <p className="font-semibold text-red-700 dark:text-red-300">Confirm Rejection</p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              Partner: {partnerName}<br />
              This action cannot be undone.
            </p>
          </div>
          <Textarea
            label="Rejection Reason *"
            required
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this commission being rejected?"
            rows={3}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowReject(false); setRejectReason(''); }}>
              Cancel
            </Button>
            <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={handleReject} disabled={!rejectReason}>
              Reject Commission
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
