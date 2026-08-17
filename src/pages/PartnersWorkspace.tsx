/**
 * PartnersWorkspace — Full-page workspace for a single Channel Partner record
 *
 * Phase 2C — Partners Workspace
 * Spec: 11 tabs (Overview + 9 universal + 1 module: commissions)
 *       25+ overview fields, 7+ quick actions
 *
 * Tabs:
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 *   Commissions
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  User,
  Mail,
  Phone,
  Hash,
  Calendar,
  Clock,
  DollarSign,
  Shield,
  Award,
  MapPin,
  FileText,

  Target,
  Percent,
  CreditCard,
  ArrowLeft,
  Handshake,
  Globe,
  BadgeCheck,
  AlertTriangle,
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
import { PARTNER_TABS, buildPartnerQuickActions } from '../features/partners/utils/workspaceConfig';
import { PartnerCommissionsTab } from '../features/partners/components/PartnerCommissionsTab';
import { useApprovePartner, useSuspendPartner, useReactivatePartner } from '../features/channel-partner/hooks/usePartners';

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

// ── Badge helpers ──────────────────────────────────────────

const PARTNER_STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  suspended: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const TIER_STYLES: Record<string, string> = {
  bronze: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  silver: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300',
  gold: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  platinum: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
};

const KYC_STATUS_STYLES: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const style = PARTNER_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', style)}>
      {label}
    </span>
  );
}

function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  const style = TIER_STYLES[tier] || 'bg-gray-100 text-gray-600';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', style)}>
      <Award className="h-3 w-3 mr-1" />
      {label}
    </span>
  );
}

function KYCBadge({ status }: { status?: string }) {
  if (!status) return null;
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const style = KYC_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', style)}>
      {status === 'verified' ? <BadgeCheck className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
      {label}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function PartnersWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const partnerQuery = useQuery({
    queryKey: ['channel_partners', activeCompanyId, id],
    queryFn: () => getOne(COLLECTIONS.CHANNEL_PARTNERS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const leadsQuery = useQuery({
    queryKey: ['leads', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
  });

  const commissionsQuery = useQuery({
    queryKey: ['commission_records', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30_000,
  });

  const partner = partnerQuery.data as any;
  const allLeads = (leadsQuery.data as any[]) || [];
  const allCommissions = (commissionsQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('partners');
  const canCreate = perms.canCreate('partners');

  // ── Hooks ────────────────────────────────────────────────
  const approveMutation = useApprovePartner();
  const suspendMutation = useSuspendPartner();
  const reactivateMutation = useReactivatePartner();

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('partners', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const partnerLeads = useMemo(() => {
    if (!partner) return [];
    return allLeads.filter((l: any) => l.partnerId === partner.id && !l.isDeleted);
  }, [partner, allLeads]);

  const partnerCommissions = useMemo(() => {
    if (!partner) return [];
    return allCommissions.filter((r: any) => r.partnerId === partner.id && !r.isDeleted);
  }, [partner, allCommissions]);

  const firmName = String(partner?.firmName || partner?.contactPerson || 'Partner');
  const status = String(partner?.status || 'pending_approval');
  const tier = String(partner?.tier || 'bronze');
  const kycStatus = String(partner?.kycStatus || 'not_started');
  const walletBalance = Number(partner?.walletBalance || 0);
  const pendingBalance = Number(partner?.pendingBalance || 0);
  const totalCommissionEarned = Number(partner?.totalCommissionEarned || 0);
  const totalCommissionPaid = Number(partner?.totalCommissionPaid || 0);
  const totalLeadsCreated = Number(partner?.totalLeadsCreated || 0);
  const totalLeadsConverted = Number(partner?.totalLeadsConverted || 0);
  const conversionRate = Number(partner?.conversionRate || 0);
  const avgCommissionPerLead = Number(partner?.averageCommissionPerLead || 0);
  const defaultCommissionType = String(partner?.defaultCommissionType || '');
  const defaultCommissionValue = Number(partner?.defaultCommissionValue || 0);
  const address = partner?.address as any;
  const assignedSalesPerson = String(partner?.assignedSalesPerson || '');
  const approvedBy = String(partner?.approvedBy || '');
  const approvedAt = partner?.approvedAt;

  // ── Quick action handlers ────────────────────────────────
  const handleApprove = useCallback(() => {
    if (!id) return;
    approveMutation.mutate(id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['channel_partners'] });
      },
    });
  }, [id, approveMutation, qc]);

  const handleSuspend = useCallback(() => {
    if (!id) return;
    const reason = prompt('Reason for suspension (optional):');
    suspendMutation.mutate({ partnerId: id, reason: reason || undefined }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['channel_partners'] });
      },
    });
  }, [id, suspendMutation, qc]);

  const handleReactivate = useCallback(() => {
    if (!id) return;
    reactivateMutation.mutate(id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['channel_partners'] });
      },
    });
  }, [id, reactivateMutation, qc]);

  const handlers = useMemo(() => ({
    onEdit: () => navigate(`/partners?open=${encodeURIComponent(id || '')}`),
    onViewLeads: () => navigate(`/leads?partnerId=${encodeURIComponent(id || '')}`),
    onViewSettlements: () => navigate(`/partners/settlements?partnerId=${encodeURIComponent(id || '')}`),
    onViewCommissions: () => navigate(`/partners/commission-approvals?partnerId=${encodeURIComponent(id || '')}`),
    onApprove: handleApprove,
    onSuspend: handleSuspend,
    onReactivate: handleReactivate,
    onCreateTask: () => navigate(`/tasks?create=1&entityType=channel_partners&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id, handleApprove, handleSuspend, handleReactivate]);

  const quickActions = useMemo(
    () => buildPartnerQuickActions({ canEdit, canCreate }, status, handlers),
    [canEdit, canCreate, status, handlers],
  );

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = useMemo(() => ({
    'partner-commissions': <PartnerCommissionsTab partnerId={id || ''} />,
  }), [id]);

  // ── Loading state ────────────────────────────────────────
  if (partnerQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Partner..." icon={<Handshake className="h-5 w-5" />} />
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
  if (!partner || partnerQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <Handshake className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Partner not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {partnerQuery.isError ? 'Failed to load partner details.' : 'This partner does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/partners')}>
          Back to Partners
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* ... Selected Fields */}
      {/* Section 1 — Identity & Contact */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <OverviewField label="Partner ID" value={id || '—'} icon={Hash} />
        <OverviewField label="Firm Name" value={firmName} icon={Building2} />
        <OverviewField label="Contact Person" value={String(partner?.contactPerson || '—')} icon={User} />
        <OverviewField label="Email" value={String(partner?.email || '—')} icon={Mail} />
        <OverviewField label="Phone" value={String(partner?.phone || '—')} icon={Phone} />
        <OverviewField label="Alternate Phone" value={String(partner?.alternatePhone || '—')} icon={Phone} />
      </div>

      {/* Section 2 — Status & Tier */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Status">
          <StatusBadge status={status} />
        </OverviewField>
        <OverviewField label="Tier">
          <TierBadge tier={tier} />
        </OverviewField>
        <OverviewField label="KYC Status">
          <KYCBadge status={kycStatus} />
        </OverviewField>
        <OverviewField label="GST Number" value={String(partner?.gstNumber || '—')} icon={FileText} />
      </div>

      {/* Section 3 — Financial */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Wallet Balance" icon={DollarSign}>
          <span className={cn('font-semibold', walletBalance > 0 ? 'text-emerald-600' : '')}>
            {fmtCurrencySafe(walletBalance)}
          </span>
        </OverviewField>
        <OverviewField label="Pending Balance" icon={Clock}>
          <span className={cn('font-semibold', pendingBalance > 0 ? 'text-amber-600' : '')}>
            {fmtCurrencySafe(pendingBalance)}
          </span>
        </OverviewField>
        <OverviewField label="Total Commission Earned" icon={CreditCard}>
          <span className="font-semibold">{fmtCurrencySafe(totalCommissionEarned)}</span>
        </OverviewField>
        <OverviewField label="Total Commission Paid" icon={CreditCard}>
          <span className="font-semibold">{fmtCurrencySafe(totalCommissionPaid)}</span>
        </OverviewField>
      </div>

      {/* Section 4 — KPI Metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Total Leads Created" icon={Target}>
          <span className="font-bold text-lg">{totalLeadsCreated}</span>
        </OverviewField>
        <OverviewField label="Total Leads Converted" icon={Target}>
          <span className="font-bold text-lg">{totalLeadsConverted}</span>
        </OverviewField>
        <OverviewField label="Conversion Rate" icon={Percent}>
          <span className="font-bold text-lg">{conversionRate}%</span>
        </OverviewField>
        <OverviewField label="Avg Commission/Lead" icon={DollarSign}>
          <span className="font-bold text-lg">{fmtCurrencySafe(avgCommissionPerLead)}</span>
        </OverviewField>
      </div>

      {/* Section 5 — Address */}
      <div className="grid grid-cols-1 gap-3">
        <OverviewField label="Address" icon={MapPin}>
          {address ? (
            <span>
              {[address.line1, address.line2].filter(Boolean).join(', ')}
              {address.city || address.state ? <><br />{[address.city, address.state, address.pincode].filter(Boolean).join(', ')}</> : ''}
              {address.country && address.country !== 'India' ? <><br />{address.country}</> : ''}
            </span>
          ) : '—'}
        </OverviewField>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="City" value={address?.city || '—'} icon={MapPin} />
        <OverviewField label="State" value={address?.state || '—'} icon={Globe} />
        <OverviewField label="Pincode" value={address?.pincode || '—'} icon={MapPin} />
        <OverviewField label="PAN Number" value={String(partner?.panNumber || '—')} icon={FileText} />
      </div>

      {/* Section 6 — Commission Config */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Default Commission Type" value={defaultCommissionType ? defaultCommissionType.replace(/_/g, ' ') : '—'} icon={Percent} />
        <OverviewField label="Default Commission Value" icon={Percent}>
          {defaultCommissionValue > 0
            ? (defaultCommissionType === 'percentage' ? `${defaultCommissionValue}%` : fmtCurrencySafe(defaultCommissionValue))
            : '—'}
        </OverviewField>
        <OverviewField label="Commission Rule ID" icon={Hash}>
          {partner?.commissionRuleId ? (
            <span className="font-mono text-xs">{String(partner.commissionRuleId)}</span>
          ) : '—'}
        </OverviewField>
        <OverviewField label="Tags" icon={Hash}>
          {partner?.tags?.length ? String(partner.tags.join(', ')) : '—'}
        </OverviewField>
      </div>

      {/* Section 7 — Metadata */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Assigned Sales Person" icon={User}>
          {assignedSalesPerson ? (
            <span className="text-[var(--color-primary-text)]">{assignedSalesPerson}</span>
          ) : '—'}
        </OverviewField>
        <OverviewField label="Approved By" icon={Shield}>
          {approvedBy || '—'}
        </OverviewField>
        <OverviewField label="Approved At" value={approvedAt ? fmtDateSafe(approvedAt) : '—'} icon={Calendar} />
        <OverviewField label="Created By" value={String(partner?.createdBy || '—')} icon={User} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Created At" value={fmtDateSafe(partner?.createdAt)} icon={Calendar} />
        <OverviewField label="Last Updated" value={fmtDateSafe(partner?.updatedAt || partner?.createdAt)} icon={Clock} />
        <OverviewField label="UserId" icon={Hash}>
          {partner?.userId ? <span className="font-mono text-xs">{String(partner.userId)}</span> : '—'}
        </OverviewField>
        <OverviewField label="Company" icon={Building2}>
          {partner?.company ? String(partner.company) : partner?.companyId ? String(partner.companyId) : '—'}
        </OverviewField>
      </div>

      {/* Section 8 — Notes */}
      {partner?.notes && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</p>
          <p className="mt-2 text-sm text-[var(--color-text)]">{String(partner.notes)}</p>
        </div>
      )}

      {/* Section 9 — Links & References */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Links & References</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button variant="outline" size="sm" icon={<Target className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/leads?partnerId=${encodeURIComponent(id || '')}`)}>
            Leads ({partnerLeads.length})
          </Button>
          <Button variant="outline" size="sm" icon={<DollarSign className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/partners/commission-approvals?partnerId=${encodeURIComponent(id || '')}`)}>
            Commission Records ({partnerCommissions.length})
          </Button>
          <Button variant="outline" size="sm" icon={<CreditCard className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/partners/settlements?partnerId=${encodeURIComponent(id || '')}`)}>
            View Settlements
          </Button>
          <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/partners/commission-rules`)}>
            Commission Rules
          </Button>
        </div>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={firmName}
        icon={<Handshake className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/partners')}>Partners</Button>}
      />

      <WorkspaceShell
        header={{
          name: firmName,
          status,
          entityId: id || '',
          // Partner is NOT a Case participant — no caseId badge
          createdAt: partner?.createdAt ? String(partner.createdAt) : undefined,
          assignedTo: assignedSalesPerson ? { name: assignedSalesPerson } : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: PARTNER_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'channel_partners',
            companyId: activeCompanyId || '',
            record: partner as Record<string, unknown>,
            permissions: { canView: true, canCreate, canEdit, canDelete: false },
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
