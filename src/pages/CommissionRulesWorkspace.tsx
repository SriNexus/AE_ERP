/**
 * CommissionRulesWorkspace — Full-page workspace for a single Commission Rule record
 *
 * Phase 2C — Commission Rules Workspace
 * Spec: 10 tabs (Overview + 9 universal), 20+ overview fields, 7 quick actions
 *
 * Tabs:
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Hash,
  Percent,
  DollarSign,
  Calendar,
  Clock,
  User,
  Tag,

  Layers,
  Target,
  ArrowLeft,
  Copy,
  Sliders,
} from 'lucide-react';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { cn } from '../utils/cn';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { COMMISSION_RULE_TABS, buildCommissionRuleQuickActions } from '../features/commission-rules/utils/workspaceConfig';
import { ChannelPartnerDomainService } from '../services/ChannelPartnerDomainService';
import type { CommissionRule } from '../features/channel-partner/types';

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

function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      isActive
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    )}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

const TYPE_BADGES: Record<string, string> = {
  percentage: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  fixed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  per_kw: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  per_deal: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  slab: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

const SCOPE_BADGES: Record<string, string> = {
  all: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  partner: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  partner_tier: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  product_category: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  location: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

function TypeBadge({ type }: { type?: string }) {
  if (!type) return null;
  const t = type.toLowerCase();
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      TYPE_BADGES[t] || 'bg-gray-100 text-gray-600',
    )}>
      {t.replace(/_/g, ' ')}
    </span>
  );
}

function ScopeBadge({ scope }: { scope?: string }) {
  if (!scope) return null;
  const s = scope.toLowerCase();
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      SCOPE_BADGES[s] || 'bg-gray-100 text-gray-600',
    )}>
      {s === 'all' ? 'All Partners' : s.replace(/_/g, ' ')}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function CommissionRulesWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const ruleQuery = useQuery({
    queryKey: ['commission_rules', activeCompanyId, id],
    queryFn: () => getOne(COLLECTIONS.COMMISSION_RULES, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const commissionsQuery = useQuery({
    queryKey: ['commission_records', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30_000,
  });

  const partnersQuery = useQuery({
    queryKey: ['channel_partners', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
  });

  const rule = ruleQuery.data as CommissionRule | undefined;
  const allCommissions = (commissionsQuery.data as any[]) || [];
  const allPartners = (partnersQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('partners');
  const canCreate = perms.canCreate('partners');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('commission-rules', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const relatedCommissions = useMemo(() => {
    if (!rule) return [];
    return allCommissions.filter((r: any) => r.ruleId === rule.id && !r.isDeleted);
  }, [rule, allCommissions]);

  const activePartners = useMemo(() => {
    if (!rule) return [];
    if (rule.applicableTo === 'all') return allPartners.filter((p: any) => !p.isDeleted);
    if (rule.applicableTo === 'partner_tier' && rule.partnerTier) {
      return allPartners.filter((p: any) => p.tier === rule.partnerTier && !p.isDeleted);
    }
    if (rule.applicableTo === 'partner' && rule.applicableIds) {
      return allPartners.filter((p: any) => rule.applicableIds?.includes(p.id) && !p.isDeleted);
    }
    return [];
  }, [rule, allPartners]);

  const ruleName = String(rule?.name || 'Commission Rule');
  const type = String(rule?.type || '');
  const isActive = Boolean(rule?.isActive);
  const value = Number(rule?.value || 0);
  const minAmount = rule?.minAmount ? Number(rule.minAmount) : null;
  const maxAmount = rule?.maxAmount ? Number(rule.maxAmount) : null;
  const applicableTo = String(rule?.applicableTo || 'all');
  const partnerTier = rule?.partnerTier ? String(rule.partnerTier) : null;
  const priority = Number(rule?.priority || 0);
  const effectiveFrom = rule?.effectiveFrom;
  const effectiveTo = rule?.effectiveTo;
  const slabs = rule?.slabs || [];
  const minSystemSizeKW = rule?.minSystemSizeKW ? Number(rule.minSystemSizeKW) : null;
  const maxSystemSizeKW = rule?.maxSystemSizeKW ? Number(rule.maxSystemSizeKW) : null;
  const productCategoryId = rule?.productCategoryId ? String(rule.productCategoryId) : null;
  const locationStates = rule?.locationStates || [];

  // ── Quick action handlers ────────────────────────────────
  const handleToggleActive = useCallback(() => {
    if (!id || !rule) return;
    ChannelPartnerDomainService.updateCommissionRule(id, {
      isActive: !rule.isActive,
      updatedBy: 'workspace',
    }).then(() => {
      qc.invalidateQueries({ queryKey: ['commission_rules'] });
    }).catch(() => {});
  }, [id, rule, qc]);

  const handleDuplicate = useCallback(() => {
    if (!rule) return;
    const newName = `${rule.name} (Copy)`;
    ChannelPartnerDomainService.createCommissionRule({
      name: newName,
      description: rule.description,
      type: rule.type,
      value: rule.value,
      minAmount: rule.minAmount,
      maxAmount: rule.maxAmount,
      applicableTo: rule.applicableTo,
      applicableIds: rule.applicableIds,
      partnerTier: rule.partnerTier,
      minSystemSizeKW: rule.minSystemSizeKW,
      maxSystemSizeKW: rule.maxSystemSizeKW,
      productCategoryId: rule.productCategoryId,
      locationPinCodes: rule.locationPinCodes,
      locationStates: rule.locationStates,
      slabs: rule.slabs,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      priority: rule.priority,
      isActive: false,
      companyId: activeCompanyId,
      createdBy: 'workspace',
    }).then((newId) => {
      qc.invalidateQueries({ queryKey: ['commission_rules'] });
      navigate(`/partners/commission-rules/${encodeURIComponent(newId)}`);
    }).catch(() => {});
  }, [rule, activeCompanyId, qc, navigate]);

  const handlers = useMemo(() => ({
    onEdit: () => navigate(`/partners/commission-rules?open=${encodeURIComponent(id || '')}`),
    onDuplicate: handleDuplicate,
    onActivate: handleToggleActive,
    onDeactivate: handleToggleActive,
    onViewCommissions: () => navigate(`/partners/commission-approvals?ruleId=${encodeURIComponent(id || '')}`),
    onExportRule: () => {
      if (!rule) return;
      const headers = ['Name', 'Type', 'Value', 'Scope', 'Status', 'Priority', 'Effective From', 'Effective To'];
      const row = [rule.name, rule.type, rule.value, rule.applicableTo, rule.isActive ? 'Active' : 'Inactive', rule.priority, rule.effectiveFrom || '', rule.effectiveTo || ''];
      const csv = [headers.join(','), row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
      a.download = `commission-rule-${rule.name.replace(/[^a-zA-Z0-9]/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    onCreateTask: () => navigate(`/tasks?create=1&entityType=commission_rules&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id, rule, handleDuplicate, handleToggleActive]);

  const quickActions = useMemo(
    () => buildCommissionRuleQuickActions({ canEdit, canCreate }, isActive, handlers),
    [canEdit, canCreate, isActive, handlers],
  );

  // ── Loading state ────────────────────────────────────────
  if (ruleQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Rule..." icon={<FileText className="h-5 w-5" />} />
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
  if (!rule || ruleQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <FileText className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Commission Rule not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {ruleQuery.isError ? 'Failed to load rule details.' : 'This rule does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/partners/commission-rules')}>
          Back to Commission Rules
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Section 1 — Rule Information */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <OverviewField label="Rule ID" value={id || '—'} icon={Hash} />
        <OverviewField label="Rule Name" value={ruleName} icon={Tag} />
        <OverviewField label="Status">
          <ActiveBadge isActive={isActive} />
        </OverviewField>
        <OverviewField label="Priority" icon={Layers}>
          <span className="font-semibold">{priority}</span>
        </OverviewField>
      </div>

      {/* Description */}
      {rule?.description && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Description</p>
          <p className="mt-1 text-sm text-[var(--color-text)]">{String(rule.description)}</p>
        </div>
      )}

      {/* Section 2 — Commission Configuration */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Commission Configuration</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Type">
            <TypeBadge type={type} />
          </OverviewField>
          <OverviewField label="Scope">
            <ScopeBadge scope={applicableTo} />
          </OverviewField>
          <OverviewField label="Value" icon={Percent}>
            <span className="font-semibold">
              {type === 'percentage' ? `${value}%` :
               type === 'slab' ? `${slabs.length} slabs` :
               `₹${value.toLocaleString('en-IN')}`}
            </span>
          </OverviewField>
          <OverviewField label="Partner Tier" icon={User}>
            {partnerTier ? (
              <span className="capitalize">{partnerTier}</span>
            ) : applicableTo === 'partner_tier' ? 'Any' : '—'}
          </OverviewField>
        </div>
      </div>

      {/* Section 3 — Amount Limits */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Min Amount" icon={DollarSign}>
          {minAmount !== null ? fmtCurrency(minAmount) : '—'}
        </OverviewField>
        <OverviewField label="Max Amount" icon={DollarSign}>
          {maxAmount !== null ? fmtCurrency(maxAmount) : '—'}
        </OverviewField>
        <OverviewField label="Min System Size" icon={Sliders}>
          {minSystemSizeKW !== null ? `${minSystemSizeKW} kW` : '—'}
        </OverviewField>
        <OverviewField label="Max System Size" icon={Sliders}>
          {maxSystemSizeKW !== null ? `${maxSystemSizeKW} kW` : '—'}
        </OverviewField>
      </div>

      {/* Section 4 — Applicability Details */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Applicability Details</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Product Category" icon={Tag}>
            {productCategoryId || '—'}
          </OverviewField>
          <OverviewField label="Location States" icon={Target}>
            {locationStates.length > 0 ? locationStates.join(', ') : '—'}
          </OverviewField>
          <OverviewField label="Affected Partners" icon={User}>
            <span className="font-semibold">{activePartners.length}</span>
          </OverviewField>
          <OverviewField label="Usage Count" icon={Hash}>
            <span className="font-semibold">{relatedCommissions.length}</span>
          </OverviewField>
        </div>
      </div>

      {/* Section 5 — Slabs (if slab type) */}
      {type === 'slab' && slabs.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Slab Configuration</p>
          <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-bg-sunken)]">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">From (kW)</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">To (kW)</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Value</th>
                </tr>
              </thead>
              <tbody>
                {slabs.map((slab: any, idx: number) => (
                  <tr key={idx} className="border-t border-[var(--color-border-subtle)]">
                    <td className="px-4 py-3">{slab.fromKW ?? '—'}</td>
                    <td className="px-4 py-3">{slab.toKW ?? '—'}</td>
                    <td className="px-4 py-3 capitalize">{slab.type?.replace(/_/g, ' ') || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {slab.type === 'percentage' ? `${slab.value}%` : `₹${Number(slab.value || 0).toLocaleString('en-IN')}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 6 — Validity */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Validity Period</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Effective From" value={effectiveFrom ? fmtDateSafe(effectiveFrom) : '—'} icon={Calendar} />
          <OverviewField label="Effective To" value={effectiveTo ? fmtDateSafe(effectiveTo) : '—'} icon={Calendar} />
        </div>
      </div>

      {/* Section 7 — Lifecycle */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Lifecycle</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewField label="Created By" value={String(rule?.createdBy || '—')} icon={User} />
          <OverviewField label="Created At" value={fmtDateSafe(rule?.createdAt)} icon={Calendar} />
          <OverviewField label="Updated At" value={fmtDateSafe(rule?.updatedAt || rule?.createdAt)} icon={Clock} />
          <OverviewField label="Company" icon={Hash}>
            {rule?.companyId ? String(rule.companyId) : '—'}
          </OverviewField>
        </div>
      </div>

      {/* Section 8 — Links & References */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Links & References</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button variant="outline" size="sm" icon={<DollarSign className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/partners/commission-approvals?ruleId=${encodeURIComponent(id || '')}`)}>
            Commission Records ({relatedCommissions.length})
          </Button>
          <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}
            onClick={() => navigate(`/partners`)}>
            View Partners ({activePartners.length})
          </Button>
          {productCategoryId && (
            <Button variant="outline" size="sm" icon={<Tag className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/products?categoryId=${encodeURIComponent(productCategoryId)}`)}>
              Product Category
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
        title={ruleName}
        icon={<FileText className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/partners/commission-rules')}>Rules</Button>}
      />

      <WorkspaceShell
        header={{
          name: ruleName,
          status: isActive ? 'Active' : 'Inactive',
          entityId: id || '',
          createdAt: rule?.createdAt ? String(rule.createdAt) : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: COMMISSION_RULE_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'commission_rules',
            companyId: activeCompanyId || '',
            record: rule as unknown as Record<string, unknown>,
            permissions: { canView: true, canCreate, canEdit, canDelete: false },
          },
          overview,
        }}
      />
    </div>
  );
}
